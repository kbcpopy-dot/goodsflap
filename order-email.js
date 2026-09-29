import nodemailer from 'nodemailer';
import {randomUUID} from 'node:crypto';
export const defaultOrderRecipients=['buf28@naver.com','annova@naver.com'];
export function orderEmail(order,config){
 const state=order.mode==='demo'?'시연 주문 · 실제 결제 없음':['paid','production','shipped'].includes(order.status)?'결제 완료':'주문 접수 · 결제 대기';
 const lines=order.items.map(item=>`${item.name} / ${item.option} / ${item.quantity}개 / ${(item.unitPrice*item.quantity).toLocaleString('ko-KR')}원`);
 return {from:config.from,to:config.to,subject:`[굿즈플랩] ${state} (${order.id})`,text:[state,`주문번호: ${order.id}`,`주문자: ${order.recipient.name}`,`접수 시각: ${new Date(order.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}`,'',...lines,'',`총 금액: ${order.amount.toLocaleString('ko-KR')}원 (배송비 포함)`,'결제 및 제작 상태는 관리자 화면에서 확인해 주세요.',`${config.url}/#admin`].join('\n')};
}
export function createOrderMailer({db,supabase,env=process.env,fetcher=fetch,smtpFactory=options=>nodemailer.createTransport(options)}){
 const useSmtp=Boolean(env.SMTP_USER&&env.SMTP_PASS);
 const config={from:useSmtp?`Goodsflap <${env.SMTP_USER}>`:env.ORDER_EMAIL_FROM||'',to:(env.ORDER_EMAIL_TO||defaultOrderRecipients.join(',')).split(',').map(v=>v.trim()).filter(Boolean),url:(env.PUBLIC_URL||'https://www.artell.co.kr').replace(/\/$/,'')};
 const configured=Boolean((useSmtp||env.RESEND_API_KEY)&&config.from&&config.to.length);
 const check=result=>{if(result.error)throw Error('notification storage unavailable');return result.data;};
 const get=async id=>db?db.prepare('SELECT * FROM order_email_notifications WHERE order_id=?').get(id):check(await supabase.from('order_email_notifications').select('*').eq('order_id',id).maybeSingle());
 const update=async(id,token,values)=>{if(db){const keys=Object.keys(values);db.prepare(`UPDATE order_email_notifications SET ${keys.map(k=>k+'=?').join(',')} WHERE order_id=? AND claim_token=?`).run(...keys.map(k=>values[k]),id,token);}else check(await supabase.from('order_email_notifications').update(values).eq('order_id',id).eq('claim_token',token));};
 async function ensure(order){const payload=JSON.stringify(orderEmail(order,config));if(db)db.prepare("INSERT OR IGNORE INTO order_email_notifications(order_id,payload,state) VALUES(?,?,'pending')").run(order.id,payload);else check(await supabase.from('order_email_notifications').upsert({order_id:order.id,payload:JSON.parse(payload),state:'pending'},{onConflict:'order_id',ignoreDuplicates:true}));}
 async function send(order){
  await ensure(order);let row=await get(order.id);if(row.state==='sent'||!configured)return {state:row.state,configured};
  if(row.provider_id==='smtp-attempt')return {state:'review',configured};
  // Never replay an uncertain delivery after the provider's 24-hour deduplication window.
  if(row.first_attempt_at&&Date.now()-Date.parse(row.first_attempt_at)>23*3600000)return {state:'review',configured};
  const token=randomUUID(),now=new Date().toISOString(),cutoff=new Date(Date.now()-60000).toISOString();
  if(db){const result=db.prepare("UPDATE order_email_notifications SET state='sending',claim_token=?,last_attempt_at=?,first_attempt_at=COALESCE(first_attempt_at,?) WHERE order_id=? AND (state IN ('pending','failed') OR (state='sending' AND last_attempt_at<?))").run(token,now,now,order.id,cutoff);if(!result.changes)return {state:'sending',configured};}
  else {const rows=check(await supabase.from('order_email_notifications').update({state:'sending',claim_token:token,last_attempt_at:now,first_attempt_at:row.first_attempt_at||now}).eq('order_id',order.id).or(`state.in.(pending,failed),and(state.eq.sending,last_attempt_at.lt.${cutoff})`).select('order_id'));if(!rows.length)return {state:'sending',configured};}
  row=await get(order.id);let payload=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
  // Jobs created before setup use the verified sender and recipients at first attempt.
  if(!payload.from){payload={...payload,from:config.from,to:config.to};await update(order.id,token,{payload:db?JSON.stringify(payload):payload});}
  try{
   if(useSmtp){
    // SMTP has no server-side idempotency: uncertain/partial sends require manual review.
    await update(order.id,token,{provider_id:'smtp-attempt'});
    const transport=smtpFactory({service:'gmail',auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},connectionTimeout:8000,greetingTimeout:8000,socketTimeout:10000});
    try{const result=await transport.sendMail({...payload,from:config.from,messageId:`<goodsflap-${order.id}@gmail.com>`});
     const accepted=(result.accepted||[]).map(v=>String(v).toLowerCase());if(!payload.to.every(address=>accepted.includes(address.toLowerCase()))||result.rejected?.length)throw Error('SMTP partial acceptance');
     await update(order.id,token,{state:'sent',provider_id:result.messageId||'smtp-sent',sent_at:new Date().toISOString(),error:null});return {state:'sent',configured};
    }finally{transport.close();}
   }
   const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'goodsflap-order-'+order.id},body:JSON.stringify(payload),signal:AbortSignal.timeout(6000)});
   const result=await response.json();if(!response.ok||!result.id)throw Error('발송 서비스 오류 ('+response.status+')');
   await update(order.id,token,{state:'sent',provider_id:result.id,sent_at:new Date().toISOString(),error:null});return {state:'sent',configured};
  }catch(error){await update(order.id,token,{state:'failed',error:useSmtp?'Gmail 발송 결과 확인 필요 — 보낸메일함 확인 후 처리':error.message.startsWith('발송 서비스 오류')?error.message:'발송 응답 확인 실패 — 재시도 시 중복 방지 적용'});return {state:useSmtp?'review':'failed',configured};}
 }
 return {configured,recipients:config.to,send,async safeSend(order){try{return await send(order);}catch{console.warn('order email: 발송 기록을 확인하지 못했습니다. 관리자에서 다시 확인해 주세요.');return {state:'unavailable',configured};}},async list(){const rows=db?db.prepare('SELECT order_id,state,sent_at,error,first_attempt_at,provider_id FROM order_email_notifications').all():check(await supabase.from('order_email_notifications').select('order_id,state,sent_at,error,first_attempt_at,provider_id'));return rows.map(row=>({...row,state:row.state!=='sent'&&(row.provider_id==='smtp-attempt'||row.first_attempt_at&&Date.now()-Date.parse(row.first_attempt_at)>23*3600000)?'review':row.state}));}};
}
