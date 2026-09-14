import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {validateItem, totals} from '../catalog.js';

test('서버가 상품 가격을 확정하고 잘못된 옵션과 변환을 거부한다',()=>{
 const item={productId:'mug',option:'화이트 · 330ml',quantity:2,transform:{x:0,y:0,scale:1,rotation:0},unitPrice:1};
 assert.equal(validateItem(item).unitPrice,15000);
 assert.equal(totals([validateItem(item)]).amount,33000);
 assert.throws(()=>validateItem({...item,quantity:-1}));assert.throws(()=>validateItem({...item,option:'invalid'}));assert.throws(()=>validateItem({...item,transform:{...item.transform,x:2}}));
});

test('회원 로그인으로 주문을 연결하고, 관리자 계정에서 주문·상품을 관리한다',async()=>{
 const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:mkdtempSync(join(tmpdir(),'goodsflap-member-test-')),PORT:'3017',PUBLIC_URL:'http://localhost:3017',ADMIN_TOKEN:'test-admin-only',TOSS_CLIENT_KEY:'',TOSS_SECRET_KEY:''},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('서버 시작 시간 초과')),15000);child.stdout.on('data',chunk=>{if(chunk.toString().includes('http://localhost:3017')){clearTimeout(timer);resolve();}});child.on('error',reject);});
  const base='http://localhost:3017';
  const cookieFrom=(response,name)=>{const values=response.headers.getSetCookie?.()||[response.headers.get('set-cookie')];const value=values.find(item=>item?.startsWith(name+'='));return value?.split(';')[0];};
  const request=(url,{method='GET',body,cookie,headers={}}={})=>fetch(base+url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  const initial=await request('/api/catalog');const anonCookie=cookieFrom(initial,'artell_session');assert.ok(anonCookie);
  const catalog=await initial.json();assert.equal(catalog.products.length,12);
  for(const id of ['postcard','sticker','cushion','glow-light','colorwave-light','humidifier','diffuser'])assert.ok(catalog.products.some(product=>product.id===id),`${id} 상품이 카탈로그에 있어야 합니다.`);
  const image=await sharp({create:{width:600,height:500,channels:4,background:'#c68d65'}}).png().toBuffer();
  let response=await request('/api/assets',{method:'POST',cookie:anonCookie,body:{data:'data:image/png;base64,'+image.toString('base64')}});assert.equal(response.status,401);
  response=await request('/api/auth/signup',{method:'POST',cookie:anonCookie,body:{name:'테스트 회원',email:'member@example.com',phone:'01000000000',password:'safe-password-123'}});assert.equal(response.status,201);const signed=await response.json();assert.equal(signed.member.role,'customer');
  const memberCookie=cookieFrom(response,'goodsflap_member');assert.ok(memberCookie);const authCookie=anonCookie+'; '+memberCookie;
  response=await request('/api/auth/me',{cookie:authCookie});assert.equal(response.status,200);assert.equal((await response.json()).member.email,'member@example.com');
  response=await request('/api/assets',{method:'POST',cookie:authCookie,body:{data:'data:image/png;base64,'+image.toString('base64')}});assert.equal(response.status,200);const asset=await response.json();
  assert.equal((await request('/api/assets/'+asset.id,{cookie:anonCookie})).status,401);assert.equal((await request('/api/assets/'+asset.id,{cookie:authCookie})).status,200);
  const item={productId:'mug',option:'화이트 · 330ml',quantity:2,assetId:asset.id,transform:{x:.1,y:0,scale:.8,rotation:25},unitPrice:1};
  response=await request('/api/orders',{method:'POST',cookie:authCookie,body:{items:[item],recipient:{name:'테스트',phone:'01000000000',address:'테스트용 주소'},consent:true,mode:'demo'}});assert.equal(response.status,200);const order=await response.json();assert.equal(order.amount,33000);
  response=await request('/api/orders',{cookie:authCookie});assert.equal(response.status,200);assert.equal((await response.json()).length,1);assert.equal((await request('/api/orders',{cookie:anonCookie})).status,401);
  assert.equal((await request('/api/admin/orders',{cookie:authCookie})).status,403);
  assert.equal((await request('/api/admin/orders',{headers:{'X-Admin-Token':'test-admin-only'}})).status,403);
  response=await request('/api/admin/bootstrap',{method:'POST',cookie:authCookie,headers:{'X-Admin-Token':'test-admin-only'},body:{}});assert.equal(response.status,200);assert.equal((await response.json()).member.role,'admin');
  response=await request('/api/admin/orders',{cookie:authCookie});assert.equal(response.status,200);assert.equal((await response.json()).length,1);
  response=await request('/api/admin/members',{cookie:authCookie});assert.equal(response.status,200);assert.equal((await response.json())[0].orderCount,1);
  const mug=catalog.products.find(product=>product.id==='mug');response=await request('/api/admin/products/mug',{method:'PATCH',cookie:authCookie,body:{...mug,category:'paper',tag:'관리자가 바꾼 상품 설명',color:'#123456',visible:true,sortOrder:3,price:16000}});assert.equal(response.status,200);assert.equal((await response.json()).product.price,16000);
  response=await request('/api/catalog');const changedMug=(await response.json()).products.find(product=>product.id==='mug');assert.equal(changedMug.price,16000);assert.equal(changedMug.category,'paper');assert.equal(changedMug.tag,'관리자가 바꾼 상품 설명');assert.equal(changedMug.color,'#123456');
  response=await request(`/api/admin/orders/${order.id}/files/0/print`,{cookie:authCookie});assert.equal(response.status,200);const print=await response.arrayBuffer();const meta=await sharp(Buffer.from(print)).metadata();assert.equal(meta.width,1063);assert.equal(meta.height,945);assert.equal(meta.density,300);
  response=await request(`/api/admin/orders/${order.id}/files/0/original`,{cookie:authCookie});assert.deepEqual(Buffer.from(await response.arrayBuffer()),image);
  response=await request('/api/admin/orders/'+order.id,{method:'PATCH',cookie:authCookie,body:{status:'paid'}});assert.equal(response.status,400);
  response=await request('/api/admin/orders/'+order.id,{method:'PATCH',cookie:authCookie,body:{status:'production'}});assert.equal(response.status,200);
  response=await request('/api/orders',{method:'POST',cookie:authCookie,body:{items:[{...item,quantity:0}],recipient:{name:'테스트',phone:'01000000000',address:'테스트용 주소'},consent:true,mode:'demo'}});assert.equal(response.status,400);
  response=await request('/api/auth/logout',{method:'POST',cookie:authCookie,body:{}});assert.equal(response.status,200);
  response=await request('/api/auth/signup',{method:'POST',cookie:anonCookie,body:{name:'다른 회원',email:'other@example.com',phone:'01011112222',password:'safe-password-456'}});assert.equal(response.status,201);
  const otherMemberCookie=cookieFrom(response,'goodsflap_member'),otherAuthCookie=anonCookie+'; '+otherMemberCookie;
  assert.equal((await request('/api/admin/bootstrap',{method:'POST',cookie:otherAuthCookie,headers:{'X-Admin-Token':'test-admin-only'},body:{}})).status,403);
  assert.equal((await request('/api/assets/'+asset.id,{cookie:otherAuthCookie})).status,404);
  response=await request('/api/orders',{method:'POST',cookie:otherAuthCookie,body:{items:[item],recipient:{name:'다른 회원',phone:'01011112222',address:'테스트용 주소'},consent:true,mode:'demo'}});assert.equal(response.status,400);
  response=await request('/api/auth/login',{method:'POST',body:{email:'member@example.com',password:'safe-password-123'}});assert.equal(response.status,200);
  const renewedMemberCookie=cookieFrom(response,'goodsflap_member');
  assert.equal((await request('/api/assets/'+asset.id,{cookie:renewedMemberCookie})).status,200);
 }finally{child.kill();}
});
