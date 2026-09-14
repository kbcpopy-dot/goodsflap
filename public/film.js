// Render the original 121 frames without the embedded browser's crashing media decoder.
export function mountFilm(){
 const host=document.querySelector('.guide-video');if(!host)return;
 host.querySelector('video')?.remove();
 const panel=document.createElement('div');panel.className='film-player';
 panel.innerHTML='<canvas width="640" height="358" role="img" aria-label="굿즈플랩 소개 영상"></canvas><div class="film-controls"><button type="button" aria-label="영상 재생">▶ 재생</button><input type="range" min="0" max="120" value="0" aria-label="영상 재생 위치"><output>0:00 / 0:05</output></div><p class="film-note">무음 미리보기 · <a href="/media/goodsflap-film.mp4" download>소리 포함 원본 다운로드</a></p>';
 host.prepend(panel);const canvas=panel.querySelector('canvas'),ctx=canvas.getContext('2d'),button=panel.querySelector('button'),seek=panel.querySelector('input'),out=panel.querySelector('output');
 const sprite=new Image();let frame=0,playing=false,start=0,raf=0,ready=false;
 function paint(){if(!ready)return;ctx.drawImage(sprite,(frame%11)*640,Math.floor(frame/11)*358,640,358,0,0,640,358);seek.value=frame;out.textContent=`0:0${Math.min(5,Math.floor(frame/24))} / 0:05`;canvas.dataset.frame=frame;}
 function pause(){playing=false;cancelAnimationFrame(raf);button.textContent=frame===120?'↻ 다시 재생':'▶ 재생';button.setAttribute('aria-label',frame===120?'영상 다시 재생':'영상 재생');}
 function tick(now){if(!panel.isConnected){pause();return;}frame=Math.min(120,Math.floor((now-start)/1000*24));paint();if(frame>=120){pause();out.textContent='0:05 / 0:05';return;}raf=requestAnimationFrame(tick);}
 button.disabled=true;sprite.onload=()=>{ready=true;button.disabled=false;paint();};sprite.onerror=()=>{panel.querySelector('.film-note').prepend('미리보기를 불러오지 못했습니다. ');};sprite.src='/media/goodsflap-frames.jpg';
 button.onclick=()=>{if(playing){pause();return;}if(frame>=120)frame=0;playing=true;start=performance.now()-frame/24*1000;button.textContent='Ⅱ 일시정지';button.setAttribute('aria-label','영상 일시정지');raf=requestAnimationFrame(tick);};
 seek.oninput=()=>{pause();frame=Number(seek.value);paint();};
}
