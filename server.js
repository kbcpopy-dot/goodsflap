import express from 'express';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {createClient} from '@supabase/supabase-js';
import {products,validateItem,totals} from './catalog.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const useSupabase=!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
const data=process.env.DATA_DIR||path.join(root,'data');
const supabase=useSupabase?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null;
let db;
if(!useSupabase){
 mkdirSync(data,{recursive:true});
 db=new DatabaseSync(path.join(data,'studio.db'));
 db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,session TEXT,format TEXT,width INTEGER,height INTEGER); CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,session TEXT,body TEXT,status TEXT,paymentKey TEXT,createdAt TEXT);`);
}

const sessionKey=sid=>useSupabase?createHash('sha256').update(sid).digest('hex'):sid;
const storageError=error=>{if(error)throw Error('파일 저장소 처리 중 오류가 발생했습니다.');};
const databaseError=error=>{if(error)throw Error('주문 데이터 처리 중 오류가 발생했습니다.');};
async function insertAsset(asset,original,normalized){
 if(!useSupabase){writeFileSync(path.join(data,asset.id+'.original'),original);writeFileSync(path.join(data,asset.id+'.png'),normalized);db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run(asset.id,asset.session,asset.format,asset.width,asset.height);return;}
 storageError((await supabase.storage.from('customer-originals').upload(`${asset.id}.${asset.format}`,original,{contentType:`image/${asset.format}`,upsert:false})).error);
 storageError((await supabase.storage.from('design-previews').upload(`${asset.id}.png`,normalized,{contentType:'image/png',upsert:false})).error);
 databaseError((await supabase.from('assets').insert({id:asset.id,session_hash:asset.session,format:asset.format,width:asset.width,height:asset.height,original_path:`${asset.id}.${asset.format}`,normalized_path:`${asset.id}.png`})).error);
}
async function findAsset(id,sid){if(!useSupabase)return db.prepare('SELECT * FROM assets WHERE id=? AND session=?').get(id,sid);const {data:row,error}=await supabase.from('assets').select('*').eq('id',id).eq('session_hash',sid).maybeSingle();databaseError(error);return row;}
async function findAnyAsset(id){if(!useSupabase)return db.prepare('SELECT * FROM assets WHERE id=?').get(id);const {data:row,error}=await supabase.from('assets').select('*').eq('id',id).maybeSingle();databaseError(error);return row;}
async function readAsset(asset,kind){if(!useSupabase)return readFileSync(path.join(data,asset.id+(kind==='original'?'.original':'.png')));const bucket=kind==='original'?'customer-originals':'design-previews';const object=kind==='original'?asset.original_path:asset.normalized_path;const {data:file,error}=await supabase.storage.from(bucket).download(object);storageError(error);return Buffer.from(await file.arrayBuffer());}
async function insertOrder(row){if(!useSupabase){db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)').run(row.id,row.session,JSON.stringify(row.body),row.status,null,row.createdAt);return;}databaseError((await supabase.from('orders').insert({id:row.id,session_hash:row.session,body:row.body,status:row.status,created_at:row.createdAt})).error);}
const unpack=row=>({id:row.id,...(typeof row.body==='string'?JSON.parse(row.body):row.body),status:row.status,createdAt:row.createdAt||row.created_at});
async function findOrder(id,sid){if(!useSupabase)return db.prepare('SELECT * FROM orders WHERE id=? AND session=?').get(id,sid);const {data:row,error}=await supabase.from('orders').select('*').eq('id',id).eq('session_hash',sid).maybeSingle();databaseError(error);return row;}
async function findAnyOrder(id){if(!useSupabase)return db.prepare('SELECT * FROM orders WHERE id=?').get(id);const {data:row,error}=await supabase.from('orders').select('*').eq('id',id).maybeSingle();databaseError(error);return row;}
async function listOrders(sid,all=false){if(!useSupabase)return db.prepare(all?'SELECT * FROM orders ORDER BY createdAt DESC':'SELECT * FROM orders WHERE session=? ORDER BY createdAt DESC').all(...(all?[]:[sid])).map(unpack);let query=supabase.from('orders').select('*').order('created_at',{ascending:false});if(!all)query=query.eq('session_hash',sid);const {data:rows,error}=await query;databaseError(error);return rows.map(unpack);}
async function updateOrder(id,status,paymentKey){if(!useSupabase){if(paymentKey)db.prepare('UPDATE orders SET status=?,paymentKey=? WHERE id=?').run(status,paymentKey,id);else db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,id);return;}const values={status};if(paymentKey)values.payment_key=paymentKey;databaseError((await supabase.from('orders').update(values).eq('id',id)).error);}

const app=express();app.disable('x-powered-by');
const origin=process.env.PUBLIC_URL||'http://localhost:4310';
const admin=process.env.ADMIN_TOKEN||randomBytes(24).toString('hex');
if(!process.env.ADMIN_TOKEN)console.log('로컬 관리자 키:',admin);
const enabled=!!(process.env.TOSS_CLIENT_KEY&&process.env.TOSS_SECRET_KEY);
app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','same-origin');res.set('Cache-Control','no-store');if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==origin)return res.status(403).json({error:'허용되지 않은 요청 출처입니다.'});let sid=req.headers.cookie?.match(/(?:^|; )artell_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(!sid){sid=randomBytes(32).toString('hex');res.cookie('artell_session',sid,{httpOnly:true,sameSite:'lax',secure:origin.startsWith('https:'),maxAge:30*86400000});}req.sid=sessionKey(sid);next();});
app.use(express.json({limit:'16mb'}));
function requireAdmin(req,res,next){const actual=Buffer.from(req.headers['x-admin-token']||''),expected=Buffer.from(admin);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return res.status(401).json({error:'관리자 키를 확인해 주세요.'});next();}
app.get('/api/catalog',(_,res)=>res.json({products,paymentEnabled:enabled,clientKey:enabled?process.env.TOSS_CLIENT_KEY:null}));
app.post('/api/assets',async(req,res)=>{const match=req.body.data?.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);if(!match)throw Error('PNG, JPG, WebP 이미지를 선택해 주세요.');const bytes=Buffer.from(match[2],'base64');if(bytes.length>10*1024*1024)throw Error('이미지는 10MB 이하여야 합니다.');const meta=await sharp(bytes,{limitInputPixels:40000000}).metadata();if(!['png','jpeg','webp'].includes(meta.format)||meta.pages>1)throw Error('정지 이미지만 사용할 수 있습니다.');const id=randomUUID();const normalized=await sharp(bytes).rotate().png().toBuffer({resolveWithObject:true});await insertAsset({id,session:req.sid,format:meta.format,width:normalized.info.width,height:normalized.info.height},bytes,normalized.data);res.json({id,width:normalized.info.width,height:normalized.info.height,url:'/api/assets/'+id});});
app.get('/api/assets/:id',async(req,res)=>{const asset=await findAsset(req.params.id,req.sid);if(!asset)return res.sendStatus(404);res.type('png').send(await readAsset(asset,'normalized'));});
app.post('/api/orders',async(req,res)=>{const {items,recipient,mode}=req.body;if(!Array.isArray(items)||items.length<1||items.length>20)throw Error('장바구니는 1~20개 디자인을 담을 수 있습니다.');if(!recipient||!['name','phone','address'].every(k=>typeof recipient[k]==='string'&&recipient[k].trim().length>=2&&recipient[k].length<=300))throw Error('수령인, 연락처, 주소를 입력해 주세요.');if(!req.body.consent)throw Error('이미지 사용 권한과 제작 시안 확인이 필요합니다.');if(!['demo','payment'].includes(mode)||mode==='payment'&&!enabled)throw Error('결제 설정을 확인해 주세요.');const clean=[];for(const item of items){if(!await findAsset(item.assetId,req.sid))throw Error('이미지를 다시 업로드해 주세요.');clean.push(validateItem({productId:item.productId,option:item.option,quantity:item.quantity,assetId:item.assetId,transform:item.transform}));}const id='AT'+randomBytes(12).toString('hex');const body={items:clean,recipient:{name:recipient.name.trim(),phone:recipient.phone.trim(),address:recipient.address.trim()},...totals(clean),mode};const status=mode==='demo'?'demo':'pending';const createdAt=new Date().toISOString();await insertOrder({id,session:req.sid,body,status,createdAt});res.json({id,...body});});
app.get('/api/orders',async(req,res)=>res.json(await listOrders(req.sid)));
app.post('/api/payments/confirm',async(req,res)=>{const {orderId,paymentKey,amount}=req.body;const row=await findOrder(orderId,req.sid);if(!row||!enabled)throw Error('결제 주문을 확인할 수 없습니다.');const order=unpack(row);if(order.amount!==Number(amount)||order.mode!=='payment'||typeof paymentKey!=='string'||paymentKey.length>300)throw Error('결제 정보가 일치하지 않습니다.');if(['paid','production','shipped'].includes(row.status))return res.json({id:orderId,status:row.status});const r=await fetch('https://api.tosspayments.com/v1/payments/confirm',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(process.env.TOSS_SECRET_KEY+':').toString('base64'),'Content-Type':'application/json','Idempotency-Key':orderId},body:JSON.stringify({orderId,paymentKey,amount:order.amount}),signal:AbortSignal.timeout(20000)});const result=await r.json();if(!r.ok)return res.status(400).json({error:'결제 승인이 완료되지 않았습니다. 주문 조회에서 확인 후 다시 시도해 주세요.'});if(result.status!=='DONE'||result.orderId!==orderId||result.totalAmount!==order.amount)throw Error('결제 승인 정보 검증에 실패했습니다.');await updateOrder(orderId,'paid',paymentKey);res.json({id:orderId,status:'paid'});});
app.get('/api/admin/orders',requireAdmin,async(_,res)=>res.json(await listOrders('',true)));
app.patch('/api/admin/orders/:id',requireAdmin,async(req,res)=>{const row=await findAnyOrder(req.params.id);if(!row)return res.sendStatus(404);const transitions={demo:['production'],paid:['production'],production:['shipped']};if(!transitions[row.status]?.includes(req.body.status))throw Error('허용되지 않은 주문 상태 변경입니다.');await updateOrder(row.id,req.body.status);res.json({ok:true});});
app.get('/api/admin/orders/:id/files/:index/:kind',requireAdmin,async(req,res)=>{const row=await findAnyOrder(req.params.id);if(!row)return res.sendStatus(404);const item=unpack(row).items[Number(req.params.index)];if(!item)return res.sendStatus(404);const asset=await findAnyAsset(item.assetId);if(!asset)return res.sendStatus(404);if(req.params.kind==='original'){res.attachment(`${row.id}-${req.params.index}.${asset.format}`).send(await readAsset(asset,'original'));return;}if(req.params.kind!=='print')return res.sendStatus(404);const [w,h]=item.mm.map(v=>Math.round(v/25.4*300));const t=item.transform;const b64=(await readAsset(asset,'normalized')).toString('base64');const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}"><g transform="translate(${w*(.5+t.x)} ${h*(.5+t.y)}) rotate(${t.rotation}) scale(${t.scale})"><image x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${b64}"/></g></svg>`;const png=await sharp(Buffer.from(svg)).png().withMetadata({density:300}).toBuffer();res.attachment(`${row.id}-${req.params.index}-300dpi-REVIEW.png`).send(png);});
app.use(express.static(path.join(root,'public')));
app.use((err,req,res,next)=>{console.error(err.message);res.status(400).json({error:err.message?.includes('SQLITE')?'저장 중 오류가 발생했습니다.':err.message||'요청을 처리하지 못했습니다.'});});

export default app;
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))app.listen(Number(process.env.PORT||4310),'127.0.0.1',()=>console.log('굿즈플랩 스튜디오: '+origin));
