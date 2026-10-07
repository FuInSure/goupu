import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'output/qa/layout');await mkdir(output,{recursive:true});
const browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9225','--user-data-dir='+path.join(root,'output/qa/browser-profile'),'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let socket,id=0;const pending=new Map(),results=[],errors=[];
async function send(method,params={}){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function click(selector){await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el.click)el.click();else el.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);}
async function capture(name){await evaluate(`document.querySelector('#toast').hidden=true`);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(output,name+'.png'),Buffer.from(r.data,'base64'));}
async function measure(name,width,height,fit=true){
 const data=await evaluate(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};const charts=['#shape-chart','#scale-chart'].map(selector=>{const svg=document.querySelector(selector+' svg');if(!svg)return null;const r=svg.getBoundingClientRect(),v=svg.viewBox.baseVal,cell=svg.querySelector('.matrix-cell rect,.bridge-matrix-cell rect'),cellRatio=cell?Number(cell.getAttribute('width'))/Number(cell.getAttribute('height')):null,plotRatio=svg.dataset.plotRatio?Number(svg.dataset.plotRatio):null;return{selector,width:r.width,height:r.height,viewWidth:v.width,viewHeight:v.height,cellRatio,plotRatio,naturalRatio:(cellRatio===null||Math.abs(cellRatio-1)<.02)&&(plotRatio===null||plotRatio<=1.801),unscaled:Math.abs(r.width-v.width)<2&&Math.abs(r.height-v.height)<2}});const p=rect('.purpose-panel'),m=rect('.material-panel'),s=rect('.shape-panel'),c=rect('.scale-panel'),main=rect('.main-stage');return{charts,timePanelRemoved:!document.querySelector('.timeline-panel')&&!document.querySelector('#clear-event'),panelCount:document.querySelectorAll('.side-column>.panel').length,gaps:{leftVertical:m.top-p.bottom,rightVertical:c.top-s.bottom,leftToMain:main.left-p.right,mainToRight:s.left-main.right},scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,innerHeight:innerHeight,footer:rect('.footer'),stage:rect('#network-view'),material:{height:document.querySelector('#material-chart').clientHeight,scrollHeight:document.querySelector('#material-chart').scrollHeight}}})()`);
 const passed=data.timePanelRemoved&&data.panelCount===4&&data.scrollWidth<=width+1&&(!fit||data.scrollHeight<=height+1&&data.footer.bottom<=height+1&&data.gaps.leftVertical>=15&&data.gaps.rightVertical>=15&&data.gaps.leftToMain>=11&&data.gaps.mainToRight>=11&&data.charts.filter(Boolean).every(c=>c.unscaled&&c.naturalRatio));
 results.push({name,width,height,passed,...data});console.log(passed?'PASS':'FAIL',name,JSON.stringify(data));if(!passed)throw new Error('Layout overflow or panel spacing: '+name);
}

try{
 let target;for(let i=0;i<40;i++){try{target=(await(await fetch('http://127.0.0.1:9225/json/list')).json()).find(t=>t.type==='page');if(target)break;}catch{}await pause(100);}
 if(!target)throw new Error('Browser unavailable');socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:4173/'});await pause(500);
 for(const [width,height] of [[1920,1080],[1600,900],[1440,900],[1366,768],[1280,720],[1366,650],[1366,620],[1366,600],[1100,700]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause(100);await measure('default-'+width+'x'+height,width,height);await capture('default-'+width+'x'+height);
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
 await pause(100);
 await click('[data-kind="桥梁"]');await measure('filtered-bridges',1366,768);await capture('filtered-bridges');await click('#reset-button');
 await click('.building-node[data-building="p-25"]');await measure('selected-building',1366,768);await capture('selected-building');await click('#selection-detail');
 const drawer=await evaluate(`(()=>{const d=document.querySelector('#detail-drawer');return{height:d.clientHeight,content:d.scrollHeight,overflow:getComputedStyle(d).overflowY}})()`);if(drawer.overflow!=='auto'||drawer.content<=drawer.height)throw new Error('Detail content is not internally scrollable');await click('#detail-close');
 await click('[data-view="flow"]');await measure('combination-flow',1366,768);await capture('combination-flow');
 await click('[data-view="catalog"]');await measure('catalog',1366,768);const catalog=await evaluate(`(()=>{const d=document.querySelector('.catalog-scroll');d.scrollTop=d.scrollHeight;return{height:d.clientHeight,content:d.scrollHeight,scrollTop:d.scrollTop,pageScroll:scrollY}})()`);if(catalog.scrollTop<=0||catalog.pageScroll!==0)throw new Error('Catalog scroll escapes its panel');await capture('catalog');
 await click('[data-view="network"]');
 for(const [width,height] of [[820,1180],[390,844]]){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await pause(150);await measure('narrow-'+width,width,height,false);await capture('narrow-'+width);}
 if(errors.length)throw new Error('Runtime errors');await writeFile(path.join(output,'results.json'),JSON.stringify({results,drawer,catalog,errors},null,2));
}finally{if(socket?.readyState===1){try{await send('Browser.close');}catch{}socket.close();}browser.kill();}
