export function remainingCartItems(current, allOrders){
 const orders=allOrders.filter(o=>o.mode==='payment'&&['paid','production','shipped'].includes(o.status)&&Date.parse(o.createdAt)>=Date.parse(current.updatedAt));
 const items=current.items.filter(item=>!orders.some(o=>o.items.some(p=>p.productId===item.productId&&p.option===item.option&&p.assetId===item.assetId&&p.quantity===item.quantity&&['x','y','scale','rotation'].every(k=>Number(p.transform?.[k])===Number(item.transform?.[k])))));
 return items;
}
