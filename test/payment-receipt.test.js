import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentReceipt} from '../payment-receipt.js';
const order={id:'AT-test',amount:30000};
const payment={orderId:order.id,totalAmount:order.amount,receipt:{url:'https://dashboard.tosspayments.com/sales-slip?test=1'}};
const reply=value=>async()=>({ok:true,json:async()=>value});
test('공식 영수증 조회 및 주문·금액·외부 주소 검증',async()=>{
 assert.equal(await paymentReceipt(order,'test-secret',reply(payment)),payment.receipt.url);
 await assert.rejects(paymentReceipt(order,'test-secret',reply({...payment,orderId:'another'})));
 await assert.rejects(paymentReceipt(order,'test-secret',reply({...payment,totalAmount:1})));
 await assert.rejects(paymentReceipt(order,'test-secret',reply({...payment,receipt:{url:'https://tosspayments.com.evil.example/receipt'}})));
 await assert.rejects(paymentReceipt(order,'test-secret',reply({...payment,receipt:null})));
 await assert.rejects(paymentReceipt(order,'test-secret',async()=>({ok:false})));
});
