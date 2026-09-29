export async function paymentReceipt(order, secret, fetcher=fetch) {
 if (!secret) throw Error('결제 영수증 연결 설정을 확인해 주세요.');
 const response=await fetcher('https://api.tosspayments.com/v1/payments/orders/'+encodeURIComponent(order.id),{headers:{Authorization:'Basic '+Buffer.from(secret+':').toString('base64')},signal:AbortSignal.timeout(10000)});
 if(!response.ok) throw Error('결제 영수증을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
 const payment=await response.json();
 if(payment.orderId!==order.id || payment.totalAmount!==order.amount) throw Error('결제 정보가 주문과 일치하지 않습니다.');
 const raw=payment.receipt?.url || payment.cashReceipt?.receiptUrl;
 if(!raw) throw Error('아직 발급된 결제 영수증이 없습니다.');
 const url=new URL(raw);
 if(url.protocol!=='https:' || !(url.hostname==='tosspayments.com'||url.hostname.endsWith('.tosspayments.com')||url.hostname==='toss.im'||url.hostname.endsWith('.toss.im')) || url.username || url.password) throw Error('영수증 주소를 확인할 수 없습니다.');
 return url.href;
}
