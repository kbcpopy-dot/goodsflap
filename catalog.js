export const products = [
 {id:'postcard',name:'AI 아트 엽서팩',tag:'5,000년 미술사 컬러링에서 태어난 엽서 12종 세트',price:10000,options:['A6 · 10 × 15cm'],mm:[100,150],color:'#f8cde0'},
 {id:'sticker',name:'굿즈플랩 스티커',tag:'노트와 폰을 작품처럼 바꾸는 컬러 스티커',price:4000,options:['90 × 150mm'],mm:[90,150],color:'#cbe7fb'},
 {id:'keyring',name:'크리스털 아크릴 키링',tag:'빛과 함께 움직이는 학생 작가의 작은 상징',price:8000,options:['55mm'],mm:[55,55],color:'#d8caff'},
 {id:'mug',name:'AI Creator 머그컵',tag:'매일의 첫 장면에 창작의 온기를 더하는 컵',price:15000,options:['화이트 · 330ml','화이트 · 450ml'],mm:[90,80],color:'#e8e9df'},
 {id:'tee',name:'Creator 그래픽 티셔츠',tag:'학생 작품을 입고 다니는 가장 솔직한 컬렉션',price:29000,options:['화이트 · S','화이트 · M'],mm:[210,260],color:'#e8ded5'},
 {id:'bag',name:'아트 에코백',tag:'가볍게 들고 오래 쓰는 캠퍼스 아트백',price:12000,options:['One size · 36 × 39cm'],mm:[200,240],color:'#e8dfcc'},
 {id:'frame',name:'컬러 포토프레임',tag:'작품과 사진을 함께 놓는 책상 위 갤러리',price:18000,options:['5 x 7 inch'],mm:[178,127],color:'#dedfcf',thumbnailImage:'/media/color-photo-frame-product.png',detailImage:'/media/color-photo-frame-product.png',studioImage:'/media/color-photo-frame-acrylic.png'},
 {id:'cushion',name:'클라우드 쿠션',tag:'작품 속 구름을 포근한 쉼으로 만든 쿠션',price:24000,options:['40 × 40cm','50 × 50cm'],mm:[400,400],color:'#d9c8ff'},
 {id:'glow-light',name:'글로우 무드등',tag:'학생 일러스트가 밤을 여는 은은한 무드 조명',price:34000,options:['Mini','Standard'],mm:[100,150],color:'#fff0a9'},
 {id:'colorwave-light',name:'컬러웨이브 라이트',tag:'작품의 색을 그대로 옮긴 24색 무드 라이트',price:38000,options:['24 colors'],mm:[100,160],color:'#bfe7fb'},
 {id:'humidifier',name:'미스트 가습기',tag:'작가의 페인팅이 감싸는 초음파 가습기',price:42000,options:['250ml'],mm:[110,140],color:'#c8efe8'},
 {id:'diffuser',name:'아로마 디퓨저',tag:'작품의 계절 향을 담은 우드베이스 디퓨저',price:26000,options:['100ml'],mm:[70,110],color:'#f5deb9'}
];

export function validateItem(item, catalog=products){
 const p=catalog.find(p=>p.id===item.productId);
 if(!p || !p.options.includes(item.option)) throw Error('상품 옵션이 올바르지 않습니다.');
 if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>100) throw Error('수량은 1~100개입니다.');
 const t=item.transform;
 if(!t || !['x','y','scale','rotation'].every(k=>Number.isFinite(t[k])) || Math.abs(t.x)>.5 || Math.abs(t.y)>.5 || t.scale<.1 || t.scale>2 || Math.abs(t.rotation)>180) throw Error('디자인 배치 값이 올바르지 않습니다.');
 return {...item,name:p.name,unitPrice:p.price,mm:p.mm,schemaVersion:1};
}

export function totals(items){
 const subtotal=items.reduce((s,i)=>s+i.unitPrice*i.quantity,0);
 return {subtotal,shipping:subtotal>=50000?0:3000,amount:subtotal+(subtotal>=50000?0:3000)};
}
