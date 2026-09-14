export const products = [
 {id:'mug',name:'세라믹 머그컵',tag:'작은 휴식에 담긴 취향',price:15000,options:['화이트 · 330ml'],mm:[90,80],color:'#e8e9df'},
 {id:'tee',name:'라운드 티셔츠',tag:'나를 표현하는 가장 편한 방법',price:25000,options:['화이트 · S','화이트 · M','화이트 · L','화이트 · XL'],mm:[210,260],color:'#e8ded5'},
 {id:'bag',name:'캔버스 에코백',tag:'좋아하는 것을 담아, 어디든',price:18000,options:['내추럴 · 35 × 40cm'],mm:[200,240],color:'#e8dfcc'},
 {id:'frame',name:'그림 액자',tag:'일상의 한 장면을 갤러리로',price:29000,options:['우드 · A4','화이트 · A4'],mm:[210,297],color:'#dedfcf'},
 {id:'keyring',name:'아크릴 키링',tag:'손끝에 매달린 작은 작품',price:8000,options:['투명 사각 · 50 × 50mm'],mm:[45,45],color:'#e4deeb'}
];
export function validateItem(item){
 const p=products.find(p=>p.id===item.productId);
 if(!p || !p.options.includes(item.option)) throw Error('상품 옵션이 올바르지 않습니다.');
 if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>100) throw Error('수량은 1~100개입니다.');
 const t=item.transform;
 if(!t || !['x','y','scale','rotation'].every(k=>Number.isFinite(t[k])) || Math.abs(t.x)>.5 || Math.abs(t.y)>.5 || t.scale<.1 || t.scale>2 || Math.abs(t.rotation)>180) throw Error('디자인 배치 값이 올바르지 않습니다.');
 return {...item,name:p.name,unitPrice:p.price,mm:p.mm,schemaVersion:1};
}
export function totals(items){const subtotal=items.reduce((s,i)=>s+i.unitPrice*i.quantity,0);return {subtotal,shipping:subtotal>=50000?0:3000,amount:subtotal+(subtotal>=50000?0:3000)};}
