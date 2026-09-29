// Finished-product simulations use the same clipped print artwork as the editor.
export function supportsFinishedPreview(product){return ['mug','bag'].includes(product.id);}
export function isAllRoundMug(product){return product.id==='mug'&&/올라운드|올 라운드|all.?round/i.test(product.selectedOption||'');}
export function drawFinishedPreview(canvas,product,texture,angle=0){
 canvas.width=1000;canvas.height=1000;const c=canvas.getContext('2d');c.scale(2,2);
 const bg=c.createLinearGradient(0,0,500,500);bg.addColorStop(0,'#faf8f3');bg.addColorStop(1,'#e7e1d9');c.fillStyle=bg;c.fillRect(0,0,500,500);
 c.save();c.translate(250,421);c.scale(1,.14);const shadow=c.createRadialGradient(0,0,10,0,0,170);shadow.addColorStop(0,'#29231d40');shadow.addColorStop(1,'#29231d00');c.fillStyle=shadow;c.beginPath();c.arc(0,0,170,0,Math.PI*2);c.fill();c.restore();
 if(product.id==='mug'){
  // A curved ceramic body and handle, with the artwork projected onto its surface.
  const wrap=isAllRoundMug(product),turn=angle/360,handleX=235+128*Math.cos(turn*Math.PI*2),handleWidth=53*Math.abs(Math.cos(turn*Math.PI*2));
  c.lineWidth=27;c.strokeStyle='#c4c2bd';c.beginPath();c.ellipse(handleX,264,Math.max(1,handleWidth),66,0,0,Math.PI*2);c.stroke();
  c.lineWidth=19;c.strokeStyle='#fdfcf9';c.beginPath();c.ellipse(handleX-2,261,Math.max(1,handleWidth),65,0,0,Math.PI*2);c.stroke();
  const body=new Path2D();body.moveTo(120,155);body.bezierCurveTo(120,133,350,133,350,155);body.lineTo(345,366);body.bezierCurveTo(337,411,137,411,125,366);body.closePath();
  c.save();c.clip(body);c.fillStyle='#fffefa';c.fillRect(110,130,250,290);
  if(wrap){
   // Inverse cylinder projection: one visible hemisphere samples half the wrap.
   // Preserve artwork margins and leave a small unprinted seam near the handle.
   for(let dx=0;dx<230;dx+=.5){const normalized=(dx+.25)/115-1,theta=Math.asin(Math.max(-1,Math.min(1,normalized))),u=((.5+theta/(2*Math.PI)+turn)%1+1)%1;
    if(u<.04||u>.96)continue;
    const sx=(u-.04)/.92*(texture.width-1),bend=12*(1-Math.cos(theta));
    c.drawImage(texture,sx,0,1,texture.height,120+dx,185-bend,.8,190);
   }
  }else{
  const left=133,width=204,top=188,height=174;
  for(let sx=0;sx<texture.width;sx+=2){const a=sx/texture.width,b=Math.min(1,(sx+2)/texture.width);const x=left+width*(.5+Math.sin((a-.5)*2.25)/(2*Math.sin(1.125)));const nx=left+width*(.5+Math.sin((b-.5)*2.25)/(2*Math.sin(1.125)));const bend=10*Math.pow(2*a-1,2);c.drawImage(texture,sx,0,Math.min(2,texture.width-sx),texture.height,x,top-bend,nx-x+.4,height);}
  }
  const glaze=c.createLinearGradient(120,0,350,0);glaze.addColorStop(0,'#30271e45');glaze.addColorStop(.16,'#ffffff10');glaze.addColorStop(.38,'#ffffff38');glaze.addColorStop(.7,'#ffffff00');glaze.addColorStop(1,'#29231c50');c.fillStyle=glaze;c.fillRect(110,130,250,290);c.restore();
  c.strokeStyle='#bcbab3';c.lineWidth=1.5;c.stroke(body);
  c.fillStyle='#fdfcf8';c.beginPath();c.ellipse(235,155,115,23,0,0,Math.PI*2);c.fill();c.stroke();
  const inside=c.createLinearGradient(0,141,0,174);inside.addColorStop(0,'#999991');inside.addColorStop(1,'#f0eee6');c.fillStyle=inside;c.beginPath();c.ellipse(235,155,104,16,0,0,Math.PI*2);c.fill();
 }else{
  c.lineCap='round';for(const offset of [-38,38]){c.strokeStyle='#b7a783';c.lineWidth=17;c.beginPath();c.moveTo(220+offset,205);c.bezierCurveTo(190+offset,40,310+offset,40,280+offset,205);c.stroke();c.strokeStyle='#e7dbbd';c.lineWidth=12;c.stroke();}
  const bag=new Path2D();bag.moveTo(120,185);bag.quadraticCurveTo(250,195,380,185);bag.lineTo(370,416);bag.quadraticCurveTo(250,434,130,416);bag.closePath();
  c.save();c.clip(bag);c.fillStyle='#eee3c9';c.fillRect(110,180,280,260);
  c.drawImage(texture,171,240,158,145);
  c.globalCompositeOperation='multiply';const folds=c.createLinearGradient(120,0,380,0);folds.addColorStop(0,'#aa9876');folds.addColorStop(.12,'#fffdf7');folds.addColorStop(.25,'#ded5c3');folds.addColorStop(.48,'#fffefa');folds.addColorStop(.8,'#e9e0cf');folds.addColorStop(1,'#ac9b7e');c.fillStyle=folds;c.fillRect(110,180,280,260);
  c.globalAlpha=.12;c.strokeStyle='#756447';c.lineWidth=.45;for(let y=188;y<430;y+=2){c.beginPath();c.moveTo(120,y);c.lineTo(380,y);c.stroke();}for(let x=120;x<380;x+=2){c.beginPath();c.moveTo(x,185);c.lineTo(x,430);c.stroke();}c.restore();
  c.strokeStyle='#b8a886';c.lineWidth=1.5;c.stroke(bag);c.setLineDash([3,3]);c.beginPath();c.moveTo(133,202);c.quadraticCurveTo(250,211,367,202);c.moveTo(139,211);c.lineTo(146,410);c.moveTo(361,211);c.lineTo(355,410);c.stroke();c.setLineDash([]);
 }
}
