import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'output/qa/rotation');await mkdir(output,{recursive:true});
const baseline=process.argv.includes('--baseline');
const browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-debugging-port=9226','--user-data-dir='+path.join(output,'browser-profile-'+Date.now()),'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let socket,id=0;const pending=new Map(),errors=[],results=[];
async function send(method,params={}){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout: '+method));},20000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});socket.send(JSON.stringify({id:n,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('click',{bubbles:true}))`);}
async function measure(mode,zoom,selected=false){
  await click('#zoom-reset');await pause(200);
  for(let n=1;n<zoom;n+=.25)await click('#zoom-in');
  if(selected)await click('.building-node[data-building="p-25"]');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});await pause(200);
  if(!baseline)await evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function ready(){if(document.querySelector('#network').classList.contains('edges-cached'))resolve();else if(performance.now()-start>3000)reject(new Error('Connection cache unavailable'));else setTimeout(ready,20)}ready()})`);
  const points=await evaluate(`(()=>{const m=document.querySelector('#network').getScreenCTM();return Array.from({length:91},(_,i)=>{const a=i/90*Math.PI*1.25,p=new DOMPoint(400+100*Math.cos(a),400+100*Math.sin(a)).matrixTransform(m);return{x:p.x,y:p.y}})})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...points[0]});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...points[0],button:'left',clickCount:1});
  await evaluate(`(()=>{window.rotationStats={edges:0,center:0,root:0,frames:[]};window.rotationObserver=new MutationObserver(ms=>{for(const m of ms){if(m.target.matches?.('.network-edge'))rotationStats.edges++;if(m.target.closest?.('#graph-center'))rotationStats.center++;if(m.target.id==='graph-root')rotationStats.root++;}});rotationObserver.observe(document.querySelector('#network-view'),{subtree:true,attributes:true,childList:true});window.rotationMeasuring=true;let last=performance.now();function tick(t){if(!rotationMeasuring)return;rotationStats.frames.push(t-last);last=t;requestAnimationFrame(tick)}requestAnimationFrame(tick)})()`);
  const started=performance.now();
  let cacheActiveDuringDrag=false;
  for(const [n,point] of points.slice(1).entries()){
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point,buttons:1,button:'left'});await pause(8);
    if(n===45)cacheActiveDuringDrag=await evaluate(`getComputedStyle(document.querySelector('.edge-raster')).visibility==='visible'&&getComputedStyle(document.querySelector('.network-edge')).display==='none'&&[...document.querySelectorAll('.building-label')].every(n=>getComputedStyle(n).visibility==='visible')`);
  }
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...points.at(-1),button:'left',clickCount:1});await pause(200);
  const data=await evaluate(`(()=>{rotationMeasuring=false;rotationObserver.disconnect();const frames=rotationStats.frames.slice(2,-2).sort((a,b)=>a-b),snap=getAtlasSnapshot();const labels=[...document.querySelectorAll('[data-angle]')].every(l=>l.getAttribute('text-anchor')===(Math.cos((Number(l.dataset.angle)+snap.rotation)*Math.PI/180)<0?'end':'start'));return{...rotationStats,frames:undefined,frameCount:frames.length,p95:frames[Math.floor(frames.length*.95)],longFrames:frames.filter(t=>t>34).length,rotation:snap.rotation,zoom:snap.zoom,selected:snap.selected,labelOrientationCorrect:labels,dragClassCleared:!document.querySelector('#network').classList.contains('dragging'),relations:document.querySelectorAll('.network-edge').length,expectedRelations:snap.relations}})()`);
  const result={mode,zoom,selected,cacheActiveDuringDrag,duration:performance.now()-started,...data};results.push(result);console.log(JSON.stringify(result));
  if(Math.abs(data.rotation)<100||!data.labelOrientationCorrect||!data.dragClassCleared||data.zoom!==zoom||data.relations!==data.expectedRelations||selected&&data.selected!=='p-25')throw new Error('Drag behavior regression');
  if(!baseline&&(data.edges>data.expectedRelations*6||data.center>10||!cacheActiveDuringDrag))throw new Error('Drag caching/repeated rewrite regression');
  if(!baseline){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(output,`${mode}-${zoom}-${selected}.png`),Buffer.from(r.data,'base64'));}
  if(selected)await click('#selection-clear');
}
try{
  let target;for(let n=0;n<40;n++){try{target=(await(await fetch('http://127.0.0.1:9226/json/list')).json()).find(t=>t.type==='page');if(target)break;}catch{}await pause(100);}
  if(!target)throw new Error('Browser unavailable');socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Browser socket unavailable')),5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Browser connection failed'))},{once:true});});
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:4173/'});await pause(800);
  await measure('unified',2);await measure('unified',3);await measure('unified',3,true);
  await click('#zoom-reset');await pause(200);
  await evaluate(`document.querySelector('#network').addEventListener('pointerdown',e=>window.burstPointerId=e.pointerId,{once:true})`);
  const startPoint=await evaluate(`new DOMPoint(650,400).matrixTransform(document.querySelector('#network').getScreenCTM()).toJSON()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:startPoint.x,y:startPoint.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:startPoint.x,y:startPoint.y,button:'left',clickCount:1});
  const burst=await evaluate(`(async()=>{const svg=document.querySelector('#network'),m=svg.getScreenCTM(),mutations=[];const obs=new MutationObserver(ms=>mutations.push(...ms));obs.observe(svg,{subtree:true,attributes:true});for(let i=1;i<=120;i++){const a=i/120*Math.PI/2,q=new DOMPoint(400+250*Math.cos(a),400+250*Math.sin(a)).matrixTransform(m);window.dispatchEvent(new PointerEvent('pointermove',{clientX:q.x,clientY:q.y,pointerId:burstPointerId,buttons:1}));}await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:burstPointerId}));await new Promise(requestAnimationFrame);obs.disconnect();return{rootWrites:mutations.filter(x=>x.target.id==='graph-root').length,rotation:getAtlasSnapshot().rotation,dragClassCleared:!svg.classList.contains('dragging')}})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:startPoint.x,y:startPoint.y,button:'left',clickCount:1});
  results.push({mode:'coalesced-burst',...burst});console.log(JSON.stringify(burst));
  if(burst.rootWrites>2||Math.abs(burst.rotation-90)>1||!burst.dragClassCleared)throw new Error('Burst coalescing/cancel regression');
  await click('#zoom-reset');for(let n=0;n<4;n++)await click('#zoom-in');await pause(300);
  await evaluate(`document.querySelector('#network').classList.add('dragging')`);
  const cacheImage=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(output,'cached-connections.png'),Buffer.from(cacheImage.data,'base64'));
  await evaluate(`document.querySelector('#network').classList.remove('dragging')`);
  const vectorImage=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(output,'vector-connections.png'),Buffer.from(vectorImage.data,'base64'));
  if(errors.length)throw new Error('Browser runtime errors: '+JSON.stringify(errors));
  await writeFile(path.join(output,baseline?'baseline.json':'results.json'),JSON.stringify({results,errors},null,2));
}catch(error){console.error('Diagnostics',await evaluate(`({cacheClass:document.querySelector('#network').getAttribute('class'),sprite:!!document.querySelector('.edge-raster'),render:getAtlasRenderSnapshot(),snapshot:getAtlasSnapshot()})`).catch(()=>null),errors);throw error;}
finally{if(socket?.readyState===1){try{await send('Browser.close');}catch{}socket.close();}browser.kill();}
