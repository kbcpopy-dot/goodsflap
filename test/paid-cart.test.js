import test from 'node:test';
import assert from 'node:assert/strict';
import {remainingCartItems} from '../paid-cart.js';
test('결제된 항목만 제거하고 후속 수정·미결제·새 상품은 보존한다',()=>{
 const item={productId:'mug',option:'a',assetId:'asset',quantity:10,transform:{x:0,y:0,scale:1,rotation:0}};
 const current={items:[item,{...item,assetId:'new'}],updatedAt:'2026-09-29T01:00:00Z'};
 const order={mode:'payment',status:'paid',createdAt:'2026-09-29T02:00:00Z',items:[item]};
 assert.deepEqual(remainingCartItems(current,[order]),[current.items[1]]);
 assert.deepEqual(remainingCartItems(current,[{...order,status:'pending'}]),current.items);
 assert.deepEqual(remainingCartItems({...current,updatedAt:'2026-09-29T03:00:00Z'},[order]),current.items);
 assert.deepEqual(remainingCartItems(current,[{...order,items:[{...item,quantity:9}]}]),current.items);
});
