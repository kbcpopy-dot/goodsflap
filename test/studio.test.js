import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {validateItem,totals} from '../catalog.js';
test('서버가 상품 가격을 확정하고 잘못된 옵션과 변환을 거부한다',()=>{
 const item={productId:'mug',option:'화이트 · 330ml',quantity:2,transform:{x:0,y:0,scale:1,rotation:0},unitPrice:1};
 assert.equal(validateItem(item).unitPrice,15000);
 assert.equal(totals([validateItem(item)]).amount,33000);
 assert.throws(()=>validateItem({...item,quantity:-1}));assert.throws(()=>validateItem({...item,option:'invalid'}));assert.throws(()=>validateItem({...item,transform:{...item.transform,x:2}}));
});
test('업로드→주문→관리자 출력, 접근 권한과 상태 전환',async()=>{
 const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:mkdtempSync(join(tmpdir(),'artell-test-')),PORT:'3017',PUBLIC_URL:'http://localhost:3017',ADMIN_TOKEN:'test-admin-only',TOSS_CLIENT_KEY:'',TOSS_SECRET_KEY:''},stdio:['ignore','pipe','pipe']});
 try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('서버 시작 시간 초과')),15000);child.stdout.on('data',chunk=>{if(chunk.toString().includes('http://localhost:3017')){clearTimeout(timer);resolve();}});child.on('error',reject);});
 const base='http://localhost:3017';const initial=await fetch(base+'/api/catalog');const cookie=initial.headers.get('set-cookie').split(';')[0];assert.equal((await initial.json()).products.length,5);
 const image=await sharp({create:{width:600,height:500,channels:4,background:'#c68d65'}}).png().toBuffer();
 const post=(url,body,extra={})=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...extra},body:JSON.stringify(body)});
 let r=await post('/api/assets',{data:'data:image/png;base64,'+image.toString('base64')});assert.equal(r.status,200);const asset=await r.json();
 assert.equal((await fetch(base+'/api/assets/'+asset.id)).status,404);
 assert.equal((await fetch(base+'/api/assets/'+asset.id,{headers:{Cookie:cookie}})).status,200);
 const item={productId:'mug',option:'화이트 · 330ml',quantity:2,assetId:asset.id,transform:{x:.1,y:0,scale:.8,rotation:25},unitPrice:1};
 r=await post('/api/orders',{items:[item],recipient:{name:'테스트',phone:'01000000000',address:'테스트용 주소'},consent:true,mode:'demo'});assert.equal(r.status,200);const order=await r.json();assert.equal(order.amount,33000);
 assert.equal((await fetch(base+'/api/admin/orders')).status,401);
 const headers={'X-Admin-Token':'test-admin-only'};
 r=await fetch(`${base}/api/admin/orders/${order.id}/files/0/print`,{headers});assert.equal(r.status,200);const print=await r.arrayBuffer();const meta=await sharp(Buffer.from(print)).metadata();assert.equal(meta.width,1063);assert.equal(meta.height,945);assert.equal(meta.density,300);
 r=await fetch(`${base}/api/admin/orders/${order.id}/files/0/original`,{headers});assert.deepEqual(Buffer.from(await r.arrayBuffer()),image);
 r=await fetch(base+'/api/orders');assert.equal((await r.json()).length,0);
 r=await fetch(base+'/api/admin/orders/'+order.id,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({status:'paid'})});assert.equal(r.status,400);
 r=await fetch(base+'/api/admin/orders/'+order.id,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({status:'production'})});assert.equal(r.status,200);
 assert.equal((await post('/api/orders',{items:[{...item,quantity:0}],recipient:{name:'테스트',phone:'01000000000',address:'테스트용 주소'},consent:true,mode:'demo'})).status,400);
 }finally{child.kill();}
});
