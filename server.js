import express from 'express';
import {DatabaseSync} from 'node:sqlite';
import {createHash, randomBytes, randomUUID, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {createClient} from '@supabase/supabase-js';
import {products as defaultProducts, validateItem, totals} from './catalog.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const useSupabaseAuth = useSupabase && Boolean(publishableKey);
const data = process.env.DATA_DIR || path.join(root, 'data');
const supabase = useSupabase ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false}}) : null;
const createAuthClient = () => useSupabaseAuth ? createClient(process.env.SUPABASE_URL, publishableKey, {auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit'}}) : null;
const scryptAsync = promisify(scrypt);
const memberSessionDays = 30;
const authAttempts = new Map();
let db;

const serverError = message => Object.assign(new Error(message), {status: 500, publicMessage: '요청을 처리하지 못했습니다.'});
const clientError = (message, status = 400) => Object.assign(new Error(message), {status, publicMessage: message});
const sessionKey = sid => useSupabase ? createHash('sha256').update(sid).digest('hex') : sid;
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const isoNow = () => new Date().toISOString();
const storageError = error => { if (error) { console.error('storage:', error.message); throw serverError('파일 저장소 처리에 실패했습니다.'); } };
const databaseError = error => { if (error) { console.error('database:', error.message); throw serverError('데이터 저장에 실패했습니다.'); } };
const safeText = (value, label, min, max) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min || text.length > max) throw clientError(`${label}을(를) 확인해 주세요.`);
  return text;
};
const normalizeEmail = value => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw clientError('이메일 주소를 확인해 주세요.');
  return email;
};
const passwordIsValid = value => typeof value === 'string' && value.length >= 8 && value.length <= 128 && !/\s/.test(value);
const normalizePhone = value => {
  const phone = safeText(value, '연락처', 7, 30), digits = phone.replace(/\D/g, '');
  if (/^01[016789]\d{7,8}$/.test(digits)) return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return phone;
};
const publicMember = member => member ? ({id: member.id, name: member.name, email: member.email, phone: member.phone ? normalizePhone(member.phone) : '', role: member.role, status: member.status, createdAt: member.createdAt || member.created_at}) : null;
const mapMember = row => row && ({id: row.id, name: row.name, email: row.email, phone: row.phone ? normalizePhone(row.phone) : '', role: row.role, status: row.status, passwordHash: row.passwordHash ?? row.password_hash ?? null, createdAt: row.createdAt || row.created_at, updatedAt: row.updatedAt || row.updated_at});

if (!useSupabase) {
  mkdirSync(data, {recursive: true});
  db = new DatabaseSync(path.join(data, 'studio.db'));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, session TEXT, format TEXT, width INTEGER, height INTEGER);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, session TEXT, body TEXT, status TEXT, paymentKey TEXT, createdAt TEXT);
    CREATE TABLE IF NOT EXISTS members(
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT, passwordHash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS member_sessions(
      id TEXT PRIMARY KEY, memberId TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE,
      expiresAt TEXT NOT NULL, revokedAt TEXT, createdAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL,
      FOREIGN KEY(memberId) REFERENCES members(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS catalog_products(
      id TEXT PRIMARY KEY, body TEXT NOT NULL, visible INTEGER NOT NULL DEFAULT 1,
      sortOrder INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_designs(
      id TEXT PRIMARY KEY, memberId TEXT NOT NULL, assetId TEXT NOT NULL, body TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      FOREIGN KEY(memberId) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY(assetId) REFERENCES assets(id) ON DELETE RESTRICT
    );
  `);
  const ensureColumn = (table, column, definition) => {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(entry => entry.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  ensureColumn('assets', 'memberId', 'TEXT');
  ensureColumn('orders', 'memberId', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS orders_member_created_idx ON orders(memberId, createdAt DESC); CREATE INDEX IF NOT EXISTS saved_designs_member_updated_idx ON saved_designs(memberId, updatedAt DESC); CREATE INDEX IF NOT EXISTS member_sessions_token_idx ON member_sessions(tokenHash);');
}

async function insertAsset(asset, original, normalized) {
  if (!useSupabase) {
    writeFileSync(path.join(data, asset.id + '.original'), original);
    writeFileSync(path.join(data, asset.id + '.png'), normalized);
    db.prepare('INSERT INTO assets(id,session,format,width,height,memberId) VALUES(?,?,?,?,?,?)').run(asset.id, asset.session, asset.format, asset.width, asset.height, asset.memberId || null);
    return;
  }
  const originalPath = `${asset.id}.${asset.format}`, previewPath = `${asset.id}.png`;
  storageError((await supabase.storage.from('customer-originals').upload(originalPath, original, {contentType: `image/${asset.format}`, upsert: false})).error);
  const previewUpload = await supabase.storage.from('design-previews').upload(previewPath, normalized, {contentType: 'image/png', upsert: false});
  if (previewUpload.error) { await supabase.storage.from('customer-originals').remove([originalPath]); storageError(previewUpload.error); }
  const insert = await supabase.from('assets').insert({id: asset.id, session_hash: asset.session, member_id: asset.memberId || null, format: asset.format, width: asset.width, height: asset.height, original_path: originalPath, normalized_path: previewPath});
  if (insert.error) { await Promise.all([supabase.storage.from('customer-originals').remove([originalPath]), supabase.storage.from('design-previews').remove([previewPath])]); databaseError(insert.error); }
}
async function findAsset(id, sid, memberId) {
  if (!useSupabase) {
    if (memberId) return db.prepare('SELECT * FROM assets WHERE id=? AND (memberId=? OR (memberId IS NULL AND session=?))').get(id, memberId, sid);
    return db.prepare('SELECT * FROM assets WHERE id=? AND session=?').get(id, sid);
  }
  const {data: row, error} = await supabase.from('assets').select('*').eq('id', id).maybeSingle(); databaseError(error);
  if (!row) return null;
  if (memberId) return row.member_id === memberId || (!row.member_id && row.session_hash === sid) ? row : null;
  return row.session_hash === sid ? row : null;
}
async function findAnyAsset(id) {
  if (!useSupabase) return db.prepare('SELECT * FROM assets WHERE id=?').get(id);
  const {data: row, error} = await supabase.from('assets').select('*').eq('id', id).maybeSingle(); databaseError(error); return row;
}
async function readAsset(asset, kind) {
  if (!useSupabase) return readFileSync(path.join(data, asset.id + (kind === 'original' ? '.original' : '.png')));
  const bucket = kind === 'original' ? 'customer-originals' : 'design-previews';
  const object = kind === 'original' ? asset.original_path : asset.normalized_path;
  const {data: file, error} = await supabase.storage.from(bucket).download(object); storageError(error); return Buffer.from(await file.arrayBuffer());
}
const catalogMediaIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const catalogMediaUrlPattern = /^\/api\/catalog-media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const staticCatalogMediaPattern = /^\/media\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/i;
async function saveCatalogMedia(id, image) {
  if (!useSupabase) { const directory = path.join(data, 'catalog-media'); mkdirSync(directory, {recursive: true}); writeFileSync(path.join(directory, id + '.png'), image); return; }
  storageError((await supabase.storage.from('catalog-media').upload(id + '.png', image, {contentType: 'image/png', upsert: false})).error);
}
async function readCatalogMedia(id) {
  if (!catalogMediaIdPattern.test(id)) return null;
  if (!useSupabase) { const file = path.join(data, 'catalog-media', id + '.png'); return existsSync(file) ? readFileSync(file) : null; }
  const {data: file, error} = await supabase.storage.from('catalog-media').download(id + '.png');
  if (error?.statusCode === 404 || error?.statusCode === '404') return null;
  storageError(error); return Buffer.from(await file.arrayBuffer());
}
async function insertOrder(row) {
  if (!useSupabase) { db.prepare('INSERT INTO orders(id,session,memberId,body,status,paymentKey,createdAt) VALUES(?,?,?,?,?,?,?)').run(row.id, row.session, row.memberId || null, JSON.stringify(row.body), row.status, null, row.createdAt); return; }
  databaseError((await supabase.from('orders').insert({id: row.id, session_hash: row.session, member_id: row.memberId || null, body: row.body, status: row.status, created_at: row.createdAt})).error);
}
const unpack = row => ({id: row.id, ...(typeof row.body === 'string' ? JSON.parse(row.body) : row.body), status: row.status, memberId: row.memberId || row.member_id || null, createdAt: row.createdAt || row.created_at});
async function findOrder(id, sid, memberId) {
  if (!useSupabase) return memberId ? db.prepare('SELECT * FROM orders WHERE id=? AND (memberId=? OR (memberId IS NULL AND session=?))').get(id, memberId, sid) : db.prepare('SELECT * FROM orders WHERE id=? AND session=?').get(id, sid);
  if (memberId) {
    const own = await supabase.from('orders').select('*').eq('id', id).eq('member_id', memberId).maybeSingle(); databaseError(own.error); if (own.data) return own.data;
    const legacy = await supabase.from('orders').select('*').eq('id', id).eq('session_hash', sid).is('member_id', null).maybeSingle(); databaseError(legacy.error); return legacy.data;
  }
  const {data: row, error} = await supabase.from('orders').select('*').eq('id', id).eq('session_hash', sid).maybeSingle(); databaseError(error); return row;
}
async function findAnyOrder(id) {
  if (!useSupabase) return db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  const {data: row, error} = await supabase.from('orders').select('*').eq('id', id).maybeSingle(); databaseError(error); return row;
}
async function listOrders(sid, memberId, all = false) {
  if (!useSupabase) {
    const sql = all ? 'SELECT * FROM orders ORDER BY createdAt DESC' : memberId ? 'SELECT * FROM orders WHERE memberId=? ORDER BY createdAt DESC' : 'SELECT * FROM orders WHERE session=? ORDER BY createdAt DESC';
    return db.prepare(sql).all(...(all ? [] : [memberId || sid])).map(unpack);
  }
  let query = supabase.from('orders').select('*').order('created_at', {ascending: false});
  if (!all) query = memberId ? query.eq('member_id', memberId) : query.eq('session_hash', sid);
  const {data: rows, error} = await query; databaseError(error); return rows.map(unpack);
}
async function updateOrder(id, status, paymentKey) {
  if (!useSupabase) { if (paymentKey) db.prepare('UPDATE orders SET status=?,paymentKey=? WHERE id=?').run(status, paymentKey, id); else db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, id); return; }
  const values = {status}; if (paymentKey) values.payment_key = paymentKey; databaseError((await supabase.from('orders').update(values).eq('id', id)).error);
}
async function replaceOrderItems(id, sid, memberId, items) {
  const row = await findOrder(id, sid, memberId);
  if (!row) throw clientError('주문을 찾을 수 없습니다.', 404);
  if (!['demo', 'pending'].includes(row.status)) throw clientError('결제가 완료되었거나 제작이 시작된 주문은 수정할 수 없습니다.', 409);
  if (!Array.isArray(items) || items.length > 20) throw clientError('주문 항목을 확인해 주세요.');
  if (!items.length) {
    if (!useSupabase) db.prepare('DELETE FROM orders WHERE id=?').run(row.id);
    else databaseError((await supabase.from('orders').delete().eq('id', row.id)).error);
    return {deleted: true};
  }
  const catalog = await listCatalogProducts(true), clean = [];
  for (const item of items) {
    if (!item || typeof item.assetId !== 'string' || !await findAsset(item.assetId, sid, memberId)) throw clientError('주문에 사용한 이미지를 확인할 수 없습니다.', 404);
    try { clean.push(validateItem({productId: item.productId, option: item.option, quantity: item.quantity, assetId: item.assetId, transform: item.transform}, catalog)); }
    catch { throw clientError('상품 옵션, 수량 또는 디자인 배치를 확인해 주세요.'); }
  }
  const current = typeof row.body === 'string' ? JSON.parse(row.body) : row.body, body = {...current, items: clean, ...totals(clean)};
  if (!useSupabase) db.prepare('UPDATE orders SET body=? WHERE id=?').run(JSON.stringify(body), row.id);
  else databaseError((await supabase.from('orders').update({body}).eq('id', row.id)).error);
  return {...unpack(row), ...body};
}
async function prepareOrderPayment(id, sid, memberId) {
  const row = await findOrder(id, sid, memberId);
  if (!row) throw clientError('결제 주문을 찾을 수 없습니다.', 404);
  const order = unpack(row);
  if (['paid', 'production', 'shipped'].includes(row.status)) throw clientError('이미 결제가 완료된 주문입니다.');
  if (row.status === 'pending' && order.mode === 'payment') return order;
  if (row.status !== 'demo' || order.mode !== 'demo') throw clientError('현재 주문은 결제를 다시 준비할 수 없습니다.');
  const body = typeof row.body === 'string' ? JSON.parse(row.body) : {...row.body};
  body.mode = 'payment';
  if (!useSupabase) db.prepare('UPDATE orders SET body=?,status=? WHERE id=?').run(JSON.stringify(body), 'pending', id);
  else databaseError((await supabase.from('orders').update({body, status: 'pending'}).eq('id', id)).error);
  return {...order, mode: 'payment', status: 'pending'};
}
async function claimOrders(memberId, sid) {
  if (!useSupabase) { db.prepare('UPDATE orders SET memberId=? WHERE memberId IS NULL AND session=?').run(memberId, sid); return; }
  databaseError((await supabase.from('orders').update({member_id: memberId}).is('member_id', null).eq('session_hash', sid)).error);
}
async function claimAssets(memberId, sid) {
  if (!useSupabase) { db.prepare('UPDATE assets SET memberId=? WHERE memberId IS NULL AND session=?').run(memberId, sid); return; }
  databaseError((await supabase.from('assets').update({member_id: memberId}).is('member_id', null).eq('session_hash', sid)).error);
}

const unpackSavedDesign = row => ({id: row.id, ...(typeof row.body === 'string' ? JSON.parse(row.body) : row.body), memberId: row.memberId || row.member_id, createdAt: row.createdAt || row.created_at, updatedAt: row.updatedAt || row.updated_at});
async function insertSavedDesign(row) {
  if (!useSupabase) { db.prepare('INSERT INTO saved_designs(id,memberId,assetId,body,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(row.id, row.memberId, row.assetId, JSON.stringify(row.body), row.createdAt, row.updatedAt); return; }
  databaseError((await supabase.from('saved_designs').insert({id: row.id, member_id: row.memberId, asset_id: row.assetId, body: row.body, created_at: row.createdAt, updated_at: row.updatedAt})).error);
}
async function listSavedDesigns(memberId) {
  if (!useSupabase) return db.prepare('SELECT * FROM saved_designs WHERE memberId=? ORDER BY updatedAt DESC').all(memberId).map(unpackSavedDesign);
  const {data: rows, error} = await supabase.from('saved_designs').select('*').eq('member_id', memberId).order('updated_at', {ascending: false}); databaseError(error); return rows.map(unpackSavedDesign);
}
async function saveMemberDesign(memberId, sid, input) {
  if (!input || typeof input !== 'object') throw clientError('저장할 디자인을 확인해 주세요.');
  const productId = typeof input.productId === 'string' ? input.productId.trim() : '';
  const option = typeof input.option === 'string' ? input.option.trim() : '';
  const assetId = typeof input.assetId === 'string' ? input.assetId.trim() : '';
  if (!productId || !option || !assetId) throw clientError('상품, 옵션, 이미지를 확인해 주세요.');
  if (!await findAsset(assetId, sid, memberId)) throw clientError('업로드한 이미지를 다시 선택해 주세요.', 404);
  const catalog = await listCatalogProducts(true); let item;
  try { item = validateItem({productId, option, quantity: 1, assetId, transform: input.transform}, catalog); }
  catch { throw clientError('상품 옵션 또는 디자인 배치를 확인해 주세요.'); }
  const now = isoNow(), body = {productId: item.productId, option: item.option, assetId: item.assetId, transform: item.transform, name: item.name, mm: item.mm, schemaVersion: item.schemaVersion};
  const row = {id: randomUUID(), memberId, assetId, body, createdAt: now, updatedAt: now}; await insertSavedDesign(row); return unpackSavedDesign(row);
}
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = Buffer.from(await scryptAsync(password, salt, 64)).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
async function passwordMatches(password, stored) {
  const [scheme, salt, expected] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const actual = Buffer.from(await scryptAsync(password, salt, 64)).toString('hex');
  const a = Buffer.from(actual, 'hex'), b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
async function findMemberById(id) {
  if (!id) return null;
  if (!useSupabase) return mapMember(db.prepare('SELECT * FROM members WHERE id=?').get(id));
  const {data: row, error} = await supabase.from('members').select('*').eq('id', id).maybeSingle(); databaseError(error); return mapMember(row);
}
async function findMemberByEmail(email) {
  if (!useSupabase) return mapMember(db.prepare('SELECT * FROM members WHERE email=? COLLATE NOCASE').get(email));
  const {data: row, error} = await supabase.from('members').select('*').eq('email', email).maybeSingle(); databaseError(error); return mapMember(row);
}
async function createMember(record) {
  const now = isoNow();
  if (!useSupabase) {
    try { db.prepare('INSERT INTO members(id,name,email,phone,passwordHash,role,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)').run(record.id, record.name, record.email, record.phone || null, record.passwordHash, record.role || 'customer', record.status || 'active', now, now); }
    catch (error) { if (String(error.message).includes('UNIQUE')) throw clientError('이미 가입된 이메일입니다. 로그인해 주세요.'); throw error; }
    return findMemberById(record.id);
  }
  const {error} = await supabase.from('members').insert({id: record.id, name: record.name, email: record.email, phone: record.phone || null, role: record.role || 'customer', status: record.status || 'active', created_at: now, updated_at: now});
  if (error) { if (error.code === '23505') throw clientError('이미 가입된 이메일입니다. 로그인해 주세요.'); databaseError(error); }
  return findMemberById(record.id);
}
async function updateMember(id, fields) {
  const now = isoNow();
  if (!useSupabase) {
    const pairs = [], values = [];
    for (const [key, value] of Object.entries(fields)) { pairs.push(`${key}=?`); values.push(value); }
    pairs.push('updatedAt=?'); values.push(now, id);
    db.prepare(`UPDATE members SET ${pairs.join(',')} WHERE id=?`).run(...values);
    return findMemberById(id);
  }
  databaseError((await supabase.from('members').update({...fields, updated_at: now}).eq('id', id)).error);
  return findMemberById(id);
}
async function createAuthenticatedMember({name, email, phone, password}) {
  if (!useSupabase) {
    if (await findMemberByEmail(email)) throw clientError('이미 가입된 이메일입니다. 로그인해 주세요.');
    return createMember({id: randomUUID(), name, email, phone, passwordHash: await hashPassword(password)});
  }
  if (!useSupabaseAuth) throw clientError('회원 인증 설정이 아직 완료되지 않았습니다. 운영 환경에 SUPABASE_PUBLISHABLE_KEY를 추가해 주세요.', 503);
  // The site currently creates members without an email-verification wait state.
  const {data: auth, error} = await supabase.auth.admin.createUser({email, password, email_confirm: true, user_metadata: {name}});
  if (error || !auth.user) { console.error('signup:', error?.message); throw clientError('이미 가입된 이메일이거나 가입 정보를 확인해 주세요.'); }
  try {
    const existing = await findMemberById(auth.user.id);
    return existing ? await updateMember(auth.user.id, {name, email, phone: phone || null}) : await createMember({id: auth.user.id, name, email, phone});
  } catch (error) { await supabase.auth.admin.deleteUser(auth.user.id); throw error; }
}
async function authenticateMember(email, password) {
  if (!useSupabase) {
    const member = await findMemberByEmail(email);
    if (!member || !await passwordMatches(password, member.passwordHash)) throw clientError('이메일 또는 비밀번호를 확인해 주세요.', 401);
    return member;
  }
  if (!useSupabaseAuth) throw clientError('회원 인증 설정이 아직 완료되지 않았습니다. 운영 환경에 SUPABASE_PUBLISHABLE_KEY를 추가해 주세요.', 503);
  const authClient = createAuthClient();
  const {data: auth, error} = await authClient.auth.signInWithPassword({email, password});
  if (error || !auth.user) { console.error('login:', error?.message); throw clientError('이메일 또는 비밀번호를 확인해 주세요.', 401); }
  let member = await findMemberById(auth.user.id);
  if (!member) member = await createMember({id: auth.user.id, name: String(auth.user.user_metadata?.name || auth.user.user_metadata?.display_name || email.split('@')[0]).slice(0, 80), email: auth.user.email || email, phone: ''});
  return member;
}
async function createMemberSession(member, res, secure) {
  const token = randomBytes(32).toString('base64url'), id = randomUUID(), now = isoNow();
  const expiresAt = new Date(Date.now() + memberSessionDays * 86400000).toISOString(), hash = tokenHash(token);
  if (!useSupabase) db.prepare('INSERT INTO member_sessions(id,memberId,tokenHash,expiresAt,revokedAt,createdAt,lastSeenAt) VALUES(?,?,?,?,?,?,?)').run(id, member.id, hash, expiresAt, null, now, now);
  else databaseError((await supabase.from('member_sessions').insert({id, member_id: member.id, token_hash: hash, expires_at: expiresAt, created_at: now, last_seen_at: now})).error);
  res.cookie('goodsflap_member', token, {httpOnly: true, sameSite: 'lax', secure, maxAge: memberSessionDays * 86400000, path: '/'});
}
async function revokeMemberSession(hash) {
  if (!hash) return;
  if (!useSupabase) { db.prepare('UPDATE member_sessions SET revokedAt=? WHERE tokenHash=?').run(isoNow(), hash); return; }
  databaseError((await supabase.from('member_sessions').update({revoked_at: isoNow()}).eq('token_hash', hash)).error);
}
async function memberFromToken(token) {
  if (!token) return null;
  const hash = tokenHash(token), now = isoNow(); let member;
  if (!useSupabase) {
    member = mapMember(db.prepare('SELECT m.* FROM member_sessions s JOIN members m ON m.id=s.memberId WHERE s.tokenHash=? AND s.revokedAt IS NULL AND s.expiresAt>?').get(hash, now));
    if (member) db.prepare('UPDATE member_sessions SET lastSeenAt=? WHERE tokenHash=?').run(now, hash);
  } else {
    const {data: session, error} = await supabase.from('member_sessions').select('member_id').eq('token_hash', hash).is('revoked_at', null).gt('expires_at', now).maybeSingle(); databaseError(error);
    if (session) { member = await findMemberById(session.member_id); databaseError((await supabase.from('member_sessions').update({last_seen_at: now}).eq('token_hash', hash)).error); }
  }
  return member ? {member, hash} : null;
}
async function listMembers() {
  if (!useSupabase) {
    const rows = db.prepare('SELECT * FROM members ORDER BY createdAt DESC').all();
    return rows.map(row => ({...publicMember(mapMember(row)), orderCount: Number(db.prepare('SELECT COUNT(*) AS count FROM orders WHERE memberId=?').get(row.id).count)}));
  }
  const {data: rows, error} = await supabase.from('members').select('*').order('created_at', {ascending: false}); databaseError(error);
  const {data: orders, error: orderError} = await supabase.from('orders').select('member_id'); databaseError(orderError);
  const counts = new Map(); for (const order of orders) if (order.member_id) counts.set(order.member_id, (counts.get(order.member_id) || 0) + 1);
  return rows.map(row => ({...publicMember(mapMember(row)), orderCount: counts.get(row.id) || 0}));
}
async function countAdmins() {
  if (!useSupabase) return Number(db.prepare("SELECT COUNT(*) AS count FROM members WHERE role='admin' AND status='active'").get().count);
  const {count, error} = await supabase.from('members').select('*', {count: 'exact', head: true}).eq('role', 'admin').eq('status', 'active'); databaseError(error); return count || 0;
}

const productCategories = new Set(['paper', 'keyring', 'table', 'wearable', 'frame', 'light', 'other']);
const defaultCategories = {postcard:'paper', sticker:'paper', keyring:'keyring', mug:'table', tee:'wearable', bag:'wearable', frame:'frame', cushion:'frame', 'glow-light':'light', 'colorwave-light':'light', humidifier:'light', diffuser:'light'};
function productMediaField(value, label, fallback = '') {
  const url = typeof value === 'string' ? value.trim() : fallback;
  if (!url) return '';
  if (!catalogMediaUrlPattern.test(url) && !staticCatalogMediaPattern.test(url)) throw clientError(`${label} 경로를 확인해 주세요.`);
  return url;
}
function productDesignArea(input, current = {}) {
  const keys = ['designX', 'designY', 'designWidth', 'designHeight'];
  const hasFields = keys.some(key => Object.hasOwn(input, key));
  const source = hasFields ? keys.map(key => input[key]) : (Array.isArray(input.designArea) ? input.designArea : current.designArea);
  if (!source) return undefined;
  if (!Array.isArray(source) || source.length !== 4 || source.some(value => !Number.isFinite(Number(value)))) throw clientError('디자인 영역 값을 확인해 주세요.');
  const [x, y, width, height] = source.map(value => Math.round(Number(value)));
  if (x < 0 || y < 0 || width < 10 || height < 10 || x + width > 500 || y + height > 500) throw clientError('디자인 영역은 제작 화면 안에 배치해 주세요.');
  return [x, y, width, height];
}
function decodeProduct(row) {
  const body = typeof row.body === 'string' ? JSON.parse(row.body) : row.body;
  return {...body, id: row.id, visible: row.visible ?? true, sortOrder: row.sortOrder ?? row.sort_order ?? 0};
}
async function catalogRows() {
  if (!useSupabase) return db.prepare('SELECT * FROM catalog_products ORDER BY sortOrder ASC, id ASC').all().map(decodeProduct);
  const {data: rows, error} = await supabase.from('catalog_products').select('*').order('sort_order', {ascending: true}).order('id', {ascending: true}); databaseError(error); return rows.map(decodeProduct);
}
async function listCatalogProducts(includeHidden = false) {
  const overrides = new Map((await catalogRows()).map(product => [product.id, product]));
  const result = defaultProducts.map((product, index) => {
    const override = overrides.get(product.id); if (override) overrides.delete(product.id);
    return {...product, ...(override || {}), id: product.id, visible: override?.visible ?? true, sortOrder: override?.sortOrder ?? index, category: override?.category || product.category || defaultCategories[product.id] || 'other'};
  });
  result.push(...overrides.values());
  return result.filter(product => includeHidden || product.visible !== false).sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, 'ko'));
}
function productInput(input, current = {}, create = false) {
  const requestedId = typeof input.id === 'string' ? input.id.trim().toLowerCase() : '';
  const id = create ? (requestedId || `goods-${randomBytes(5).toString('hex')}`) : current.id;
  if (!/^[a-z0-9][a-z0-9-]{2,49}$/.test(id)) throw clientError('상품 코드에는 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.');
  const name = safeText(input.name, '상품명', 2, 80), tag = safeText(input.tag, '상품 설명', 2, 240), price = Number(input.price), shippingFee = Number(input.shippingFee ?? current.shippingFee ?? 3000);
  if (!Number.isInteger(price) || price < 0 || price > 10000000) throw clientError('상품 가격을 확인해 주세요.');
  if (!Number.isInteger(shippingFee) || shippingFee < 0 || shippingFee > 10000000) throw clientError('상품 배송비를 확인해 주세요.');
  const sourceOptions = Array.isArray(input.options) ? input.options : String(input.options || '').split(',');
  const options = sourceOptions.map(option => String(option).trim()).filter(Boolean);
  if (!options.length || options.length > 12 || options.some(option => option.length > 80)) throw clientError('상품 옵션을 1~12개 입력해 주세요.');
  const mm = Array.isArray(input.mm) ? input.mm.map(Number) : [Number(input.printWidth), Number(input.printHeight)];
  if (mm.length !== 2 || mm.some(value => !Number.isInteger(value) || value < 10 || value > 2000)) throw clientError('인쇄 규격을 확인해 주세요.');
  const color = typeof input.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : (current.color || '#e8ded5');
  const category = typeof input.category === 'string' ? input.category : (current.category || 'other');
  if (!productCategories.has(category)) throw clientError('상품 카테고리를 확인해 주세요.');
  const thumbnailImage = productMediaField(input.thumbnailImage, '카드 이미지', current.thumbnailImage || current.image || '');
  const detailImage = productMediaField(input.detailImage, '상품정보 이미지', current.detailImage || current.thumbnailImage || current.image || '');
  const studioImage = productMediaField(input.studioImage, '디자인 목업 이미지', current.studioImage || '');
  const designArea = productDesignArea(input, current);
  const visible = input.visible !== false;
  const sortOrder = Number.isInteger(Number(input.sortOrder)) ? Math.max(0, Math.min(9999, Number(input.sortOrder))) : (Number.isInteger(current.sortOrder) ? current.sortOrder : 0);
  return {id, name, tag, price, shippingFee, options, mm, color, category, thumbnailImage, detailImage, studioImage, designArea, visible, sortOrder};
}
async function saveCatalogProduct(product) {
  const now = isoNow(), body = {id: product.id, name: product.name, tag: product.tag, price: product.price, shippingFee: product.shippingFee, options: product.options, mm: product.mm, color: product.color, category: product.category, thumbnailImage: product.thumbnailImage, detailImage: product.detailImage, studioImage: product.studioImage, designArea: product.designArea};
  if (!useSupabase) db.prepare('INSERT INTO catalog_products(id,body,visible,sortOrder,createdAt,updatedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,visible=excluded.visible,sortOrder=excluded.sortOrder,updatedAt=excluded.updatedAt').run(product.id, JSON.stringify(body), product.visible ? 1 : 0, product.sortOrder, now, now);
  else databaseError((await supabase.from('catalog_products').upsert({id: product.id, body, visible: product.visible, sort_order: product.sortOrder, updated_at: now}, {onConflict: 'id'})).error);
  return (await listCatalogProducts(true)).find(item => item.id === product.id);
}
function parseCookie(req, name, pattern) {
  const match = req.headers.cookie?.match(new RegExp(`(?:^|; )${name}=(${pattern})(?:;|$)`));
  return match?.[1] || null;
}
function authRateLimit(scope) {
  return (req, res, next) => {
    const key = `${scope}:${req.ip || req.socket.remoteAddress || 'unknown'}`, now = Date.now();
    const record = authAttempts.get(key) || {count: 0, startedAt: now};
    if (now - record.startedAt > 15 * 60 * 1000) { record.count = 0; record.startedAt = now; }
    record.count += 1; authAttempts.set(key, record);
    if (record.count > 12) return res.status(429).json({error: '잠시 후 다시 시도해 주세요.'});
    next();
  };
}

const app = express();
if (process.env.VERCEL) app.set('trust proxy', 1);
app.disable('x-powered-by');
const origin = process.env.PUBLIC_URL || 'http://localhost:4310';
const allowedRequestOrigins = new Set([origin.replace(/\/$/, '')]);
try {
  const configuredUrl = new URL(origin);
  if (configuredUrl.hostname === 'artell.co.kr' || configuredUrl.hostname === 'www.artell.co.kr') {
    allowedRequestOrigins.add(`${configuredUrl.protocol}//artell.co.kr`);
    allowedRequestOrigins.add(`${configuredUrl.protocol}//www.artell.co.kr`);
  }
} catch {}
const configuredAdminToken = process.env.ADMIN_TOKEN || '';
if (process.env.NODE_ENV === 'production' && !configuredAdminToken) throw new Error('ADMIN_TOKEN is required in production.');
const legacyAdminToken = configuredAdminToken || randomBytes(24).toString('hex');
if (!configuredAdminToken) console.log('로컬 초기 관리자 키:', legacyAdminToken);
const enabled = Boolean(process.env.TOSS_CLIENT_KEY && process.env.TOSS_SECRET_KEY);
app.use(async (req, res, next) => {
  try {
    res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); res.set('Cache-Control', 'no-store');
    const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/$/, '') : '';
    if (req.method !== 'GET' && requestOrigin && !allowedRequestOrigins.has(requestOrigin)) return res.status(403).json({error: '허용되지 않은 요청 출처입니다.'});
    const secure = (req.headers['x-forwarded-proto'] || req.protocol) === 'https';
    let sid = parseCookie(req, 'artell_session', '[a-f0-9]{64}');
    if (!sid) { sid = randomBytes(32).toString('hex'); res.cookie('artell_session', sid, {httpOnly: true, sameSite: 'lax', secure, maxAge: 30 * 86400000, path: '/'}); }
    req.sid = sessionKey(sid); req.isSecureCookie = secure;
    const memberToken = parseCookie(req, 'goodsflap_member', '[A-Za-z0-9_-]{30,100}');
    req.memberSession = await memberFromToken(memberToken); req.member = req.memberSession?.member || null;
    next();
  } catch (error) { next(error); }
});
app.use(express.json({limit: '16mb'}));
function validLegacyAdmin(value) {
  if (!legacyAdminToken) return false;
  const actual = Buffer.from(typeof value === 'string' ? value : ''), expected = Buffer.from(legacyAdminToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function requireMember(req, res, next) {
  if (!req.member) return res.status(401).json({error: '로그인 후 이용해 주세요.'});
  if (req.member.status !== 'active') return res.status(403).json({error: '현재 이용이 제한된 계정입니다.'});
  next();
}
function requireAdmin(req, res, next) {
  if (req.member?.role === 'admin' && req.member.status === 'active') return next();
  return res.status(403).json({error: '관리자 권한이 필요합니다.'});
}
function requireLegacyAdmin(req, res, next) {
  if (!validLegacyAdmin(req.headers['x-admin-token'])) return res.status(401).json({error: '초기 관리자 키를 확인해 주세요.'});
  next();
}

app.get('/api/catalog', async (_, res) => res.json({products: await listCatalogProducts(), paymentEnabled: enabled, paymentMode: enabled && process.env.TOSS_CLIENT_KEY.startsWith('test_') ? 'test' : 'live', clientKey: enabled ? process.env.TOSS_CLIENT_KEY : null}));
app.get('/api/auth/me', (req, res) => {
  if (!req.member || req.member.status !== 'active') return res.status(401).json({member: null});
  res.json({member: publicMember(req.member)});
});
app.post('/api/auth/signup', authRateLimit('signup'), async (req, res) => {
  const name = safeText(req.body.name, '이름', 2, 80), email = normalizeEmail(req.body.email);
  const phone = typeof req.body.phone === 'string' && req.body.phone.trim() ? normalizePhone(req.body.phone) : '';
  if (!passwordIsValid(req.body.password)) throw clientError('비밀번호는 공백 없이 8~128자로 입력해 주세요.');
  const member = await createAuthenticatedMember({name, email, phone, password: req.body.password});
  await createMemberSession(member, res, req.isSecureCookie); await Promise.all([claimAssets(member.id, req.sid), claimOrders(member.id, req.sid)]);
  res.status(201).json({member: publicMember(member)});
});
app.post('/api/auth/confirm', async (req, res) => {
  if (!useSupabaseAuth) throw clientError('회원 인증 설정이 아직 완료되지 않았습니다.', 503);
  const accessToken = typeof req.body.accessToken === 'string' ? req.body.accessToken : '';
  if (!accessToken || accessToken.length > 10000) throw clientError('이메일 인증 정보를 확인해 주세요.', 401);
  const authClient = createAuthClient(), {data: auth, error} = await authClient.auth.getUser(accessToken);
  if (error || !auth.user) throw clientError('이메일 인증 정보를 확인해 주세요.', 401);
  const member = await findMemberById(auth.user.id);
  if (!member || member.status !== 'active') throw clientError('현재 이용이 제한된 계정입니다.', 403);
  await createMemberSession(member, res, req.isSecureCookie); await Promise.all([claimAssets(member.id, req.sid), claimOrders(member.id, req.sid)]);
  res.json({member: publicMember(member)});
});
app.post('/api/auth/login', authRateLimit('login'), async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (typeof req.body.password !== 'string') throw clientError('비밀번호를 입력해 주세요.');
  const member = await authenticateMember(email, req.body.password);
  if (member.status !== 'active') throw clientError('현재 이용이 제한된 계정입니다.', 403);
  await createMemberSession(member, res, req.isSecureCookie); await Promise.all([claimAssets(member.id, req.sid), claimOrders(member.id, req.sid)]);
  res.json({member: publicMember(member)});
});
app.post('/api/auth/logout', async (req, res) => {
  await revokeMemberSession(req.memberSession?.hash);
  res.clearCookie('goodsflap_member', {httpOnly: true, sameSite: 'lax', secure: req.isSecureCookie, path: '/'});
  res.json({ok: true});
});
app.patch('/api/auth/profile', requireMember, async (req, res) => {
  const name = safeText(req.body.name, '이름', 2, 80);
  const phone = typeof req.body.phone === 'string' && req.body.phone.trim() ? normalizePhone(req.body.phone) : '';
  const member = await updateMember(req.member.id, {name, phone: phone || null});
  res.json({member: publicMember(member)});
});
app.post('/api/assets', requireMember, async (req, res) => {
  const match = req.body.data?.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw clientError('PNG, JPG, WebP 이미지를 선택해 주세요.');
  const bytes = Buffer.from(match[2], 'base64'); if (bytes.length > 10 * 1024 * 1024) throw clientError('이미지는 10MB 이하여야 합니다.');
  const meta = await sharp(bytes, {limitInputPixels: 40000000}).metadata();
  if (!['png', 'jpeg', 'webp'].includes(meta.format) || meta.pages > 1) throw clientError('정지 이미지만 사용할 수 있습니다.');
  const id = randomUUID(), normalized = await sharp(bytes).rotate().png().toBuffer({resolveWithObject: true});
  await insertAsset({id, session: req.sid, memberId: req.member.id, format: meta.format, width: normalized.info.width, height: normalized.info.height}, bytes, normalized.data);
  res.json({id, width: normalized.info.width, height: normalized.info.height, url: '/api/assets/' + id});
});
app.get('/api/assets/:id', requireMember, async (req, res) => {
  const asset = await findAsset(req.params.id, req.sid, req.member.id); if (!asset) return res.sendStatus(404); res.type('png').send(await readAsset(asset, 'normalized'));
});
app.post('/api/designs', requireMember, async (req, res) => res.status(201).json({design: await saveMemberDesign(req.member.id, req.sid, req.body)}));
app.get('/api/designs', requireMember, async (req, res) => res.json(await listSavedDesigns(req.member.id)));
app.get('/api/catalog-media/:id', async (req, res) => {
  const image = await readCatalogMedia(req.params.id); if (!image) return res.sendStatus(404); res.type('png').send(image);
});
app.post('/api/orders', requireMember, async (req, res) => {
  const {items, recipient, mode} = req.body;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) throw clientError('장바구니는 1~20개 디자인을 담을 수 있습니다.');
  if (!recipient || !['name', 'phone', 'address'].every(key => typeof recipient[key] === 'string' && recipient[key].trim().length >= 2 && recipient[key].length <= 300)) throw clientError('수령인, 연락처, 주소를 입력해 주세요.');
  if (!req.body.consent) throw clientError('이미지 사용 권한과 제작 시안 확인이 필요합니다.');
  if (!['demo', 'payment'].includes(mode) || (mode === 'payment' && !enabled)) throw clientError('결제 설정을 확인해 주세요.');
  const catalog = await listCatalogProducts(), clean = [];
  for (const item of items) { if (!await findAsset(item.assetId, req.sid, req.member.id)) throw clientError('이미지를 다시 업로드해 주세요.'); clean.push(validateItem({productId: item.productId, option: item.option, quantity: item.quantity, assetId: item.assetId, transform: item.transform}, catalog)); }
  const id = 'AT' + randomBytes(12).toString('hex'), body = {items: clean, recipient: {name: recipient.name.trim(), phone: normalizePhone(recipient.phone), address: recipient.address.trim()}, ...totals(clean), mode};
  const status = mode === 'demo' ? 'demo' : 'pending', createdAt = isoNow();
  await insertOrder({id, session: req.sid, memberId: req.member.id, body, status, createdAt}); res.json({id, ...body});
});
app.post('/api/orders/:id/payment', requireMember, async (req, res) => {
  if (!enabled) throw clientError('토스페이먼츠 결제 설정을 확인해 주세요.', 503);
  res.json(await prepareOrderPayment(req.params.id, req.sid, req.member.id));
});
app.patch('/api/orders/:id/items', requireMember, async (req, res) => res.json(await replaceOrderItems(req.params.id, req.sid, req.member.id, req.body.items)));
app.get('/api/orders', requireMember, async (req, res) => res.json(await listOrders(req.sid, req.member.id)));
app.post('/api/payments/confirm', requireMember, async (req, res) => {
  const {orderId, paymentKey, amount} = req.body, row = await findOrder(orderId, req.sid, req.member.id);
  if (!row || !enabled) throw clientError('결제 주문을 확인할 수 없습니다.');
  const order = unpack(row);
  if (order.amount !== Number(amount) || order.mode !== 'payment' || typeof paymentKey !== 'string' || paymentKey.length > 300) throw clientError('결제 정보가 일치하지 않습니다.');
  if (['paid', 'production', 'shipped'].includes(row.status)) return res.json({id: orderId, status: row.status});
  const response = await fetch('https://api.tosspayments.com/v1/payments/confirm', {method: 'POST', headers: {Authorization: 'Basic ' + Buffer.from(process.env.TOSS_SECRET_KEY + ':').toString('base64'), 'Content-Type': 'application/json', 'Idempotency-Key': orderId}, body: JSON.stringify({orderId, paymentKey, amount: order.amount}), signal: AbortSignal.timeout(20000)});
  const result = await response.json();
  if (!response.ok) return res.status(400).json({error: '결제 승인이 완료되지 않았습니다. 주문 조회에서 확인 후 다시 시도해 주세요.'});
  if (result.status !== 'DONE' || result.orderId !== orderId || result.totalAmount !== order.amount) throw serverError('결제 승인 정보 검증에 실패했습니다.');
  await updateOrder(orderId, 'paid', paymentKey); res.json({id: orderId, status: 'paid'});
});
app.post('/api/admin/bootstrap', requireMember, requireLegacyAdmin, async (req, res) => {
  if (await countAdmins() > 0) throw clientError('이미 관리자 계정이 연결되어 있습니다. 관리자 화면에서 권한을 관리해 주세요.', 403);
  const member = await updateMember(req.member.id, {role: 'admin'}); res.json({member: publicMember(member)});
});
app.get('/api/admin/summary', requireAdmin, async (_, res) => {
  const members = await listMembers(), orders = await listOrders('', '', true), catalog = await listCatalogProducts(true);
  res.json({members: members.length, orders: orders.length, pending: orders.filter(order => ['pending', 'paid', 'demo', 'production'].includes(order.status)).length, products: catalog.filter(product => product.visible !== false).length});
});
app.get('/api/admin/members', requireAdmin, async (_, res) => res.json(await listMembers()));
app.patch('/api/admin/members/:id', requireAdmin, async (req, res) => {
  const target = await findMemberById(req.params.id); if (!target) return res.sendStatus(404);
  const role = req.body.role === 'admin' ? 'admin' : 'customer', status = req.body.status === 'suspended' ? 'suspended' : 'active';
  if (target.role === 'admin' && (role !== 'admin' || status !== 'active') && await countAdmins() <= 1) throw clientError('활성 관리자 계정은 최소 1개 유지해야 합니다.');
  if (req.member?.id === target.id && (role !== 'admin' || status !== 'active')) throw clientError('현재 로그인한 관리자 계정은 이 화면에서 권한을 낮추거나 중지할 수 없습니다.');
  const member = await updateMember(target.id, {role, status});
  if (status === 'suspended') {
    if (!useSupabase) db.prepare('UPDATE member_sessions SET revokedAt=? WHERE memberId=?').run(isoNow(), member.id);
    else databaseError((await supabase.from('member_sessions').update({revoked_at: isoNow()}).eq('member_id', member.id)).error);
  }
  res.json({member: publicMember(member)});
});
app.get('/api/admin/products', requireAdmin, async (_, res) => res.json(await listCatalogProducts(true)));
app.post('/api/admin/catalog-media', requireAdmin, async (req, res) => {
  const match = req.body.data?.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw clientError('PNG, JPG, WebP 이미지를 선택해 주세요.');
  const bytes = Buffer.from(match[2], 'base64'); if (bytes.length > 10 * 1024 * 1024) throw clientError('이미지는 10MB 이하여야 합니다.');
  const meta = await sharp(bytes, {limitInputPixels: 40000000}).metadata();
  if (!['png', 'jpeg', 'webp'].includes(meta.format) || meta.pages > 1) throw clientError('정지 이미지만 사용할 수 있습니다.');
  const id = randomUUID(), normalized = await sharp(bytes).rotate().png().toBuffer({resolveWithObject: true});
  await saveCatalogMedia(id, normalized.data); res.status(201).json({id, url: '/api/catalog-media/' + id, width: normalized.info.width, height: normalized.info.height});
});
app.post('/api/admin/products', requireAdmin, async (req, res) => {
  const all = await listCatalogProducts(true), product = productInput(req.body, {}, true);
  if (all.some(item => item.id === product.id)) throw clientError('이미 사용 중인 상품 코드입니다.');
  product.sortOrder = Number.isInteger(Number(req.body.sortOrder)) ? product.sortOrder : all.length;
  res.status(201).json({product: await saveCatalogProduct(product)});
});
app.patch('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const current = (await listCatalogProducts(true)).find(product => product.id === req.params.id); if (!current) return res.sendStatus(404);
  const product = productInput({...req.body, id: current.id}, current, false); res.json({product: await saveCatalogProduct(product)});
});
app.get('/api/admin/orders', requireAdmin, async (_, res) => res.json(await listOrders('', '', true)));
app.patch('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  const row = await findAnyOrder(req.params.id); if (!row) return res.sendStatus(404);
  const transitions = {demo: ['production'], paid: ['production'], production: ['shipped']};
  if (!transitions[row.status]?.includes(req.body.status)) throw clientError('허용되지 않은 주문 상태 변경입니다.');
  await updateOrder(row.id, req.body.status); res.json({ok: true});
});
app.get('/api/admin/orders/:id/files/:index/:kind', requireAdmin, async (req, res) => {
  const row = await findAnyOrder(req.params.id); if (!row) return res.sendStatus(404);
  const item = unpack(row).items[Number(req.params.index)]; if (!item) return res.sendStatus(404);
  const asset = await findAnyAsset(item.assetId); if (!asset) return res.sendStatus(404);
  if (req.params.kind === 'original') { res.attachment(`${row.id}-${req.params.index}.${asset.format}`).send(await readAsset(asset, 'original')); return; }
  if (req.params.kind !== 'print') return res.sendStatus(404);
  const [widthMm, heightMm] = item.mm.map(value => Math.round(value / 25.4 * 300)), transform = item.transform;
  const imageBase64 = (await readAsset(asset, 'normalized')).toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${widthMm}" height="${heightMm}"><g transform="translate(${widthMm * (.5 + transform.x)} ${heightMm * (.5 + transform.y)}) rotate(${transform.rotation}) scale(${transform.scale})"><image x="${-widthMm / 2}" y="${-heightMm / 2}" width="${widthMm}" height="${heightMm}" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${imageBase64}"/></g></svg>`;
  const png = await sharp(Buffer.from(svg)).png().withMetadata({density: 300}).toBuffer(); res.attachment(`${row.id}-${req.params.index}-300dpi-REVIEW.png`).send(png);
});

app.use(express.static(path.join(root, 'public')));
app.use((error, req, res, next) => {
  const status = Number.isInteger(error.status) ? error.status : 400;
  console.error(error.message);
  res.status(status).json({error: error.publicMessage || (status >= 500 ? '요청을 처리하지 못했습니다.' : error.message || '요청을 처리하지 못했습니다.')});
});

export default app;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) app.listen(Number(process.env.PORT || 4310), '127.0.0.1', () => console.log('굿즈플랩 스튜디오: ' + origin));
