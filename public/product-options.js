export function optionPrice(product, option){
 if(!product)return 0;
 const size=product.apparel?.sizes.find(size=>product.apparel.colors.some(color=>option===color.name+' · '+size.name));
 return product.price+(size?.extra||0);
}
export function apparelOptions(apparel){return apparel.colors.flatMap(color=>apparel.sizes.map(size=>color.name+' · '+size.name));}
export function optionMockup(product,option){
 const color=product.apparel?.colors.find(color=>option?.startsWith(color.name+' · '));
 return color?.crop?{src:product.apparel.colorImage,crop:color.crop}:{src:product.studioImage,crop:null};
}

export function optionPrintSize(product,option){
 if(product.id==='mug'){
  if(option==='단면/양면 인쇄')return [75,75];
  if(option==='올라운드 인쇄')return [200,75];
 }
 return product.mm;
}
export function optionDesignArea(product,option){
 // Coordinates belong to this print-guide image, not arbitrary replacement mockups.
 if(product.id==='mug'&&product.studioImage==='/api/catalog-media/ea877755-78d3-4f24-b9b5-a8404298ba52'&&option==='단면/양면 인쇄')return [325,143,70,71];
 return product.designArea;
}
