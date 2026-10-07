'use strict';
(async()=>{
  try{
    const response=await fetch('/api/bootstrap',{cache:'no-store'});
    if(!response.ok)throw new Error('数据请求失败：'+response.status);
    const bundle=await response.json();
    if(!Array.isArray(bundle.atlas?.buildings)||!Array.isArray(bundle.supplement?.records))throw new Error('数据格式无效。');
    window.ATLAS_DATA=bundle.atlas;window.ATLAS_SIMULATION=bundle.supplement;
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/app.js';script.onload=resolve;script.onerror=()=>reject(new Error('交互程序未加载。'));document.head.append(script);});
  }catch(error){
    console.error(error);
    const main=document.querySelector('main');
    main.innerHTML='<div class="empty-state"><strong>资料暂时无法加载</strong>请稍后刷新页面。<br><button id="retry-load">重新加载</button></div>';
    document.querySelector('#retry-load').addEventListener('click',()=>location.reload());
  }
})();
