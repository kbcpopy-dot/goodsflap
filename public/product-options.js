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
