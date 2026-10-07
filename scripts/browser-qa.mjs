import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const deployedURL=process.env.ATLAS_QA_URL;
const previewURL=deployedURL||'http://127.0.0.1:4173/';
const revisitURL=deployedURL||'file:///'+path.join(root,'site/dist/index.html').replaceAll('\\','/');
const output=path.join(root,'output/qa');await mkdir(output,{recursive:true});
const browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--disable-features=msEdgeSidebarV2','--no-first-run','--no-default-browser-check','--remote-debugging-port=9225',`--user-data-dir=${path.join(output,'browser-profile-'+Date.now())}`,...(process.env.ATLAS_QA_PROXY?['--proxy-server='+process.env.ATLAS_QA_PROXY]:[]),'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,requestId=0;const pending=new Map(),errors=[],results=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function send(method,params={}){const id=++requestId;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.text+' '+JSON.stringify(response.exceptionDetails.exception));return response.result.value;}
async function check(label,expression){const result=await evaluate(expression);results.push({label,passed:!!result,result});if(!result)throw new Error('FAIL '+label+': '+JSON.stringify(result));console.log('PASS',label);}
async function checkCleanCopy(label){await check(label,`(()=>{const text=[document.body.innerText,...[...document.querySelectorAll('[title],[aria-label],svg title')].map(n=>[n.getAttribute('title'),n.getAttribute('aria-label'),n.matches('svg title')?n.textContent:''].join(' '))].join(' ');return !/模拟|补全/.test(text)&&document.querySelectorAll('.sim-badge').length===0})()`);}
async function click(selector){await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing element '+${JSON.stringify(selector)});if(typeof el.click==='function')el.click();else el.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);}
async function input(value){await evaluate(`(()=>{const input=document.querySelector('#search-input');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function realClick(selector){
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);
  const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing click target');const r=el.getBoundingClientRect();for(let i=1;i<20;i++)for(let j=1;j<20;j++){const x=r.left+r.width*i/20,y=r.top+r.height*j/20;const hit=document.elementFromPoint(x,y);if(hit&&(hit===el||el.contains(hit)))return{x,y};}throw new Error('Target is not hit-testable: '+${JSON.stringify(selector)});})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
async function screenshot(name){await evaluate(`document.querySelector('#toast').hidden=true`);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(output,name+'.png'),Buffer.from(shot.data,'base64'));}
async function waitForAtlas(){await evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function ready(){if(typeof getAtlasSnapshot==='function')resolve();else if(performance.now()-start>15000)reject(new Error('Atlas startup timed out'));else setTimeout(ready,50)}ready()})`);}
try{
  let target;
  for(let i=0;i<40;i++){
    try{const tabs=await (await fetch('http://127.0.0.1:9225/json/list')).json();target=tabs.find(t=>t.type==='page');if(target)break;}catch{}
    await pause(250);
  }
  if(!target)throw new Error('Edge debugging endpoint did not become ready');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1050,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:previewURL});await pause(900);await waitForAtlas();
  await check('05 time panel and its filter are removed',`!document.querySelector('.timeline-panel') && !document.querySelector('#clear-event') && !('event' in getAtlasSnapshot().filters)`);
  await check('140 objects loaded',`window.getAtlasSnapshot?.().total===140 && window.getAtlasSnapshot().visible===140`);
  await check('single unified view has all data and no mode controls',`getAtlasSnapshot().dataMode==='统一视图' && getAtlasSnapshot().simulatedFields===1333 && getAtlasSnapshot().relations===1051 && !document.querySelector('.data-mode-bar') && !document.querySelector('#mode-demo') && !document.querySelector('#mode-evidence')`);
  await check('full charts retain their objects without category badges',`document.querySelector('#shape-count').textContent==='95 个样本' && document.querySelector('#scale-count').textContent==='95 个样本' && document.querySelectorAll('.network-edge[data-simulated="true"]').length>400 && document.querySelectorAll('.scatter-point[data-simulated="true"]').length>0 && document.querySelectorAll('.sim-badge').length===0`);
  for(const [coverage,label,total,counts,percentages] of [
    ['all','全部资料',140,[39,7,49,45],[27.9,5,35,32.1]],
    ['shape','有形制资料',55,[2,0,47,6],[3.6,0,85.5,10.9]],
    ['scale','有开间资料',23,[0,0,23,0],[0,0,100,0]],
    ['catalog','文保名录样本',90,[39,7,0,44],[43.3,7.8,0,48.9]]
  ]){
    await evaluate(`(()=>{const s=document.querySelector('#coverage-filter');s.value=${JSON.stringify(coverage)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await check('coverage '+coverage+' has its own type counts and percentages',`(()=>{const nodes=[...document.querySelectorAll('#purpose-chart [data-chart-kind]')];return getAtlasSnapshot().visible===${total}&&document.querySelector('#purpose-scope').textContent===${JSON.stringify(label)}&&JSON.stringify(nodes.map(n=>Number(n.dataset.count)))===${JSON.stringify(JSON.stringify(counts))}&&JSON.stringify(nodes.map(n=>Number(n.dataset.percent)))===${JSON.stringify(JSON.stringify(percentages))}&&nodes.every(n=>Number(n.dataset.count)===Number(n.dataset.scopeCount)&&Number.parseFloat(n.querySelector('.bar-fill').style.width)===Number(n.dataset.percent)&&Number.parseFloat(n.querySelector('.bar-baseline').style.width)===Number(n.dataset.percent))&&document.querySelector('.purpose-summary strong').textContent==='${total} / ${total}'})()`);
    await screenshot('coverage-'+coverage);
  }
  await evaluate(`(()=>{const s=document.querySelector('#coverage-filter');s.value='shape';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await realClick('#purpose-chart [data-chart-kind="桥梁"]');await check('coverage and type intersect and keep scope reference',`getAtlasSnapshot().visible===6 && document.querySelector('#purpose-chart [data-chart-kind="桥梁"]').dataset.percent==='100.0' && document.querySelector('.purpose-summary strong').textContent==='6 / 55'`);
  await realClick('[data-clear="coverage"]');await check('clearing coverage retains selected type and updates composition',`getAtlasSnapshot().visible===45 && getAtlasSnapshot().filters.kind==='桥梁' && document.querySelector('#purpose-scope').textContent==='全部资料'`);await click('#reset-button');
  await checkCleanCopy('overview and chart tooltips have no simulation labels');
  await evaluate(`(()=>{const n=document.querySelector('.feature-node[data-feature*="模拟"]');n.dispatchEvent(new MouseEvent('mouseenter',{clientX:500,clientY:400}));})()`);await checkCleanCopy('feature hover has clean display copy');await evaluate(`document.querySelector('.feature-node[data-feature*="模拟"]').dispatchEvent(new MouseEvent('mouseleave'))`);
  await click('#sources-button');await checkCleanCopy('source dialog has no simulation declarations');await click('#source-dialog [data-close-dialog]');
  await screenshot('simulation-overview');
  await check('graph contains real building and feature nodes',`document.querySelectorAll('.building-node').length===140 && document.querySelectorAll('.feature-node').length>30 && document.querySelectorAll('.network-edge').length===getAtlasSnapshot().relations`);
  await screenshot('desktop');
  const dragPoints=await evaluate(`(()=>{const m=document.querySelector('#network').getScreenCTM();return Array.from({length:13},(_,i)=>{const angle=i/12*Math.PI/3,p=new DOMPoint(400+270*Math.cos(angle),400+270*Math.sin(angle)).matrixTransform(m);return{x:p.x,y:p.y}})})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...dragPoints[0]});await send('Input.dispatchMouseEvent',{type:'mousePressed',...dragPoints[0],button:'left',clickCount:1});
  for(const point of dragPoints.slice(1))await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...dragPoints.at(-1),button:'left',clickCount:1});await pause(200);
  await check('real drag rotates the dial without drifting or selecting',`Math.abs(getAtlasSnapshot().rotation-60)<2 && getAtlasSnapshot().pan.x===0 && getAtlasSnapshot().pan.y===0 && getAtlasSnapshot().selected===null`);
  await click('#names-button');await realClick('.building-node[data-building="p-25"] .building-label');
  await check('real label click opens persistent building exploration',`getAtlasSnapshot().selected==='p-25' && !document.querySelector('#graph-selection').hidden && document.querySelector('#graph-selection').textContent.includes('太和殿') && document.querySelector('#detail-drawer').hidden`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:30,y:30});
  await check('building focus survives moving the pointer away',`getAtlasSnapshot().selected==='p-25' && [...document.querySelectorAll('.network-edge')].filter(p=>Number(p.getAttribute('opacity'))>.8).length>0`);
  await screenshot('dial-selection');await click('#selection-detail');await check('dial exploration opens sourced detail',`!document.querySelector('#detail-drawer').hidden && document.querySelector('#detail-content').textContent.includes('太和殿')`);await click('#detail-close');
  await realClick('.building-node[data-building="p-25"] .building-label');await click('#selection-filter');await check('selected architecture links all charts',`getAtlasSnapshot().visible===1 && getAtlasSnapshot().filters.building==='p-25' && document.querySelector('#scale-count').textContent==='1 个样本'`);
  await click('[data-selection-feature="屋顶形制|庑殿顶"]');await check('building traits find other matching architecture',`getAtlasSnapshot().filters.building===null && getAtlasSnapshot().visible===11`);
  await click('#reset-button');await click('#zoom-reset');
  const wheelPoint=await evaluate(`(()=>{const r=document.querySelector('#network').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',...wheelPoint,deltaX:0,deltaY:-100});await pause(100);
  await check('ordinary wheel zooms without requiring Ctrl',`getAtlasSnapshot().zoom>1`);await click('#zoom-reset');
  await check('reset restores rotation and zoom',`getAtlasSnapshot().rotation===0 && getAtlasSnapshot().zoom===1`);
  await click('#names-button');
  await click('[data-kind="桥梁"]');await check('bridge filter links charts and catalog',`getAtlasSnapshot().visible===45 && document.querySelectorAll('#catalog-body tr').length===45 && document.querySelector('#shape-count').textContent==='45 个样本'`);
  await screenshot('bridges');
  await click('#reset-button');await input('太和殿');await check('exact name search',`getAtlasSnapshot().visible===1 && document.querySelector('#visible-count').textContent==='1'`);
  await click('[data-view="catalog"]');await click('#catalog-body [data-record]');
  await check('detail source and missing fields visible',`!document.querySelector('#detail-drawer').hidden && document.querySelector('#detail-content').textContent.includes('2377') && document.querySelector('#detail-content').textContent.includes('暂无核实资料') && document.querySelector('#detail-content a').href.includes('dpm.org.cn')`);
  await screenshot('detail');await click('#add-compare');await click('#detail-close');
  await input('乾清宫');await click('#catalog-body [data-record]');await click('#add-compare');await click('#detail-close');await click('#compare-open');
  await check('two-building comparison renders',`document.querySelector('#compare-dialog').open && document.querySelector('#compare-content').textContent.includes('太和殿') && document.querySelector('#compare-content').textContent.includes('乾清宫') && document.querySelector('#compare-content').textContent.includes('重檐庑殿顶')`);
  await screenshot('comparison');await click('#compare-dialog [data-close-dialog]');await click('#compare-clear');await click('#reset-button');
  await click('#sources-button');await check('source coverage and scope are explained',`document.querySelector('#source-dialog').open && document.querySelector('#source-content').textContent.includes('不按0绘图') && document.querySelector('#source-content').textContent.includes('辅助转载来源')`);await click('#source-dialog [data-close-dialog]');
  await click('[data-view="flow"]');await check('flow bands are data-driven',`document.querySelectorAll('.flow-band').length>10 && !document.querySelector('#flow-view').hidden`);await screenshot('flow');
  await click('[data-flow-node="0"][data-value="民居"]');await check('flow selection filters same dataset',`getAtlasSnapshot().visible===39`);
  await click('#reset-button');await click('[data-flow-node="1"][data-value="年代有争议"]');await check('disputed period is distinct from continuous timespan',`getAtlasSnapshot().visible===1 && document.querySelector('#catalog-body').textContent.includes('断虹桥')`);
  await click('#reset-button');await click('[data-flow-node="2"][data-value="石拱桥"]');await check('merged bridge form remains selectable',`getAtlasSnapshot().visible===17 && !document.querySelector('[data-flow-node="2"][data-value="形制待补充"]')`);
  await click('#reset-button');await click('[data-view="network"]');
  await click('.feature-node[data-feature="屋顶形制|歇山顶"]');await check('feature node filters buildings',`getAtlasSnapshot().visible===43`);await click('#reset-button');
  await click('.matrix-cell[data-roof="庑殿顶"][data-bays="11"]');await check('matrix cell filters correct architecture',`getAtlasSnapshot().visible===1 && document.querySelector('#catalog-body').textContent.includes('太和殿')`);await click('#reset-button');
  await click('.scatter-point[data-bays="9"][data-depth="5"]');await check('overlapping scatter point preserves all objects',`getAtlasSnapshot().visible===4`);await click('#reset-button');
  await input('不存在的建筑XYZ');await click('[data-view="catalog"]');await check('empty state and reset work',`getAtlasSnapshot().visible===0 && !!document.querySelector('#empty-reset')`);await click('#empty-reset');await click('[data-view="network"]');
  await click('#zoom-in');await click('#zoom-in');await click('#zoom-in');await check('zoom reveals all names consistently',`document.querySelectorAll('.building-label').length===140`);await click('#zoom-reset');
  await input('断虹桥');
  await evaluate(`(()=>{const original=URL.createObjectURL;window.restoreExportURL=original;URL.createObjectURL=blob=>{window.lastExportBlob=blob;return original(blob)};window.restoreAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){};document.querySelector('#export-button').click();})()`);
  await check('export preserves current filter and source facts',`(async()=>{const data=JSON.parse(await lastExportBlob.text());return data.buildings.length===1&&data.buildings[0].name==='断虹桥'&&data.buildings[0].widthQualifier==='最宽处'&&data.filters.search==='断虹桥'&&data.buildings[0].events.length===0})()`);
  await evaluate(`URL.createObjectURL=restoreExportURL;HTMLAnchorElement.prototype.click=restoreAnchorClick`);await click('#reset-button');
  for(const [name,width,height] of [['short',1366,768],['tablet',820,1180],['mobile',390,844]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await pause(150);
    await check(name+' has no horizontal overflow',`document.documentElement.scrollWidth<=${width}`);await screenshot(name);
  }
  await click('#mobile-sources');await check('mobile keeps data source controls',`document.querySelector('#source-dialog').open`);await click('#source-dialog [data-close-dialog]');
  await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1200,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:revisitURL});await pause(600);await waitForAtlas();
  await check(deployedURL?'deployed revisit loads all data':'direct file opening works without a server',`getAtlasSnapshot().total===140 && document.querySelectorAll('.network-edge').length===getAtlasSnapshot().relations`);
  await screenshot('overview');
  await check('direct file opening also loads simulation layer',`getAtlasSnapshot().dataMode==='统一视图' && getAtlasSnapshot().simulatedFields===1333`);
  await click('[data-kind="桥梁"]');await check('bridge simulation uses bridge dimensions',`document.querySelector('#scale-title').textContent==='桥长与桥宽' && document.querySelector('#scale-count').textContent==='45 个样本' && document.querySelectorAll('.scatter-point[data-bridge="true"]').length>20 && document.querySelector('.shape-panel h2').textContent==='桥型关联'`);await screenshot('simulation-bridges');
  await click('.bridge-matrix-cell[data-support="石材"][data-form="石拱桥"]');await check('bridge matrix filters simulated forms and materials',`getAtlasSnapshot().visible>0 && getAtlasSnapshot().visible<45 && getAtlasSnapshot().filters.matrix.bridge===true && document.querySelector('#catalog-body').textContent.includes('桥')`);await click('#reset-button');
  await input('石家大院');await click('[data-view="catalog"]');await click('#catalog-body [data-record]');
  await check('detail displays values without badges and retains recorded gaps',`document.querySelector('#detail-content .simulation-detail-note')===null && document.querySelectorAll('#detail-content .sim-badge').length===0 && document.querySelector('#detail-content').textContent.includes('待补充资料')`);await checkCleanCopy('detail and catalog have no remaining simulation labels');await screenshot('simulation-detail');await click('#detail-close');
  await evaluate(`(()=>{const original=URL.createObjectURL;window.restoreExportURL=original;URL.createObjectURL=blob=>{window.lastExportBlob=blob;return original(blob)};window.restoreAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){};document.querySelector('#export-button').click();})()`);
  await check('synthetic export includes provenance and original nulls',`(async()=>{const data=JSON.parse(await lastExportBlob.text());const r=data.buildings[0];return data.meta.dataMode==='统一视图'&&r.name==='石家大院'&&r.simulatedFields.includes('roof')&&r.originalMissingValues.roof===null&&r.gaps.length>0&&r.source===ATLAS_DATA.buildings.find(v=>v.id===r.id).source&&JSON.stringify(r.events)===JSON.stringify(ATLAS_DATA.buildings.find(v=>v.id===r.id).events)})()`);
  await evaluate(`URL.createObjectURL=restoreExportURL;HTMLAnchorElement.prototype.click=restoreAnchorClick`);
  await check('underlying original fields remain unchanged after merging',`ATLAS_DATA.buildings.find(r=>r.name==='石家大院').roof===null && getAtlasSnapshot().simulatedFields===1333`);
  await click('#reset-button');await click('[data-view="network"]');
  for(const [name,width,height] of [['simulation-short',1366,768],['simulation-mobile',390,844]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await pause(100);await check(name+' has no horizontal overflow',`document.documentElement.scrollWidth<=${width}`);await screenshot(name);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1400,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:revisitURL});await pause(400);await waitForAtlas();
  await realClick('[data-view="flow"]');await check('navigation buttons expose active view',`getAtlasSnapshot().view==='flow' && document.querySelector('[data-view="flow"]').getAttribute('aria-pressed')==='true'`);
  await input('太和');
  await realClick('[data-view="flow"]');await check('repeating current view gives visible feedback',`document.querySelector('#toast').textContent==='当前已在特征组合'`);
  await realClick('#reset-button');await check('reset gives feedback even without filters',`getAtlasSnapshot().visible===140 && document.querySelector('#toast').textContent.includes('筛选已重置')`);
  await realClick('#list-button');await check('full catalog button opens complete names',`getAtlasSnapshot().view==='catalog' && document.querySelectorAll('#catalog-body tr').length===140`);
  await evaluate(`(()=>{const s=document.querySelector('#coverage-filter');s.value='catalog';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await check('catalog-only selector excludes palace guide records',`getAtlasSnapshot().visible===90 && !document.querySelector('#catalog-body [data-record^="p-"]')`);
  await realClick('[data-clear="coverage"]');await check('filter chip removal restores results',`getAtlasSnapshot().visible===140 && document.querySelector('#coverage-filter').value==='all'`);
  await evaluate(`(()=>{const s=document.querySelector('#coverage-filter');s.value='scale';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await check('measurement selector links objects with paired source records',`getAtlasSnapshot().visible===23`);await click('#reset-button');
  await realClick('[data-view="network"]');await realClick('#rotate-right');await check('right rotation button changes orientation',`getAtlasSnapshot().rotation===25`);await realClick('#rotate-left');await check('left rotation button reverses orientation',`getAtlasSnapshot().rotation===0`);
  await realClick('#zoom-in');await check('button click includes a visible press state',`document.querySelector('#zoom-in').classList.contains('pressed-feedback') && getAtlasSnapshot().zoom===1.25`);
  for(let i=0;i<12;i++)await click('#zoom-in');await check('zoom upper bound visibly disables its button',`getAtlasSnapshot().zoom===3 && document.querySelector('#zoom-in').disabled && document.querySelector('#zoom-in').title.includes('300%')`);
  for(let i=0;i<12;i++)await click('#zoom-out');await check('zoom lower bound visibly disables its button',`getAtlasSnapshot().zoom===.65 && document.querySelector('#zoom-out').disabled && document.querySelector('#zoom-out').title.includes('65%')`);
  await realClick('#zoom-reset');await check('dial reset restores state and explains result',`getAtlasSnapshot().zoom===1 && getAtlasSnapshot().rotation===0 && document.querySelector('#toast').textContent.includes('圆盘已复位')`);
  await realClick('#names-button');await check('name button indicates enabled state',`document.querySelector('#names-button').getAttribute('aria-pressed')==='true' && document.querySelectorAll('.building-label').length===140`);await realClick('#names-button');await check('name button indicates disabled state',`document.querySelector('#names-button').getAttribute('aria-pressed')==='false' && document.querySelectorAll('.building-label').length===0`);
  await realClick('#purpose-chart [data-chart-kind="桥梁"]');await check('chart category button has selection feedback',`getAtlasSnapshot().visible===45 && document.querySelector('#purpose-chart [data-chart-kind="桥梁"]').getAttribute('aria-pressed')==='true'`);
  await click('.building-node[data-building="p-25"]');await check('faded building click explains why it is unavailable',`getAtlasSnapshot().selected===null && document.querySelector('#toast').textContent.includes('不匹配当前筛选')`);
  await realClick('#material-chart [data-material="木板（桥面）"]');await check('bridge material button filters without replacing search',`getAtlasSnapshot().visible===17 && document.querySelector('#search-input').value==='' && getAtlasSnapshot().filters.material.value==='木板（桥面）' && document.querySelector('#material-chart button').getAttribute('aria-pressed')==='true'`);
  await realClick('#material-chart [data-material="木板（桥面）"]');await check('repeating bridge material button removes filter',`getAtlasSnapshot().visible===45 && getAtlasSnapshot().filters.material===null`);
  await realClick('.bridge-matrix-cell[data-support="石材"][data-form="石拱桥"]');await check('bridge matrix exposes selected state',`document.querySelector('.bridge-matrix-cell[aria-pressed="true"]').dataset.form==='石拱桥' && getAtlasSnapshot().visible===17`);await click('#reset-button');
  await realClick('#material-chart [data-material="琉璃瓦（屋面）"]');await check('roof material button toggles feature selection',`getAtlasSnapshot().visible===49`);await realClick('#material-chart [data-material="琉璃瓦（屋面）"]');await check('roof material second click removes selection',`getAtlasSnapshot().visible===140`);
  await realClick('[data-view="catalog"]');await input('太和殿');await realClick('#catalog-body [data-record]');await realClick('#find-similar');await check('similarity button expands usable results',`document.querySelector('#find-similar').getAttribute('aria-expanded')==='true' && document.querySelectorAll('#similar-list button').length>0`);
  const similarName=await evaluate(`document.querySelector('#similar-list button').textContent`);await realClick('#similar-list button');await check('similar architecture button opens its details',`!document.querySelector('#detail-drawer').hidden && ${JSON.stringify(similarName)}.includes(document.querySelector('#detail-content h2').textContent)`);await realClick('#detail-close');
  await input('太和殿');await realClick('#catalog-body [data-record]');await realClick('#add-compare');await check('first comparison selection explains remaining step',`getAtlasSnapshot().compare.length===1 && document.querySelector('#compare-open').disabled && document.querySelector('#compare-open').textContent==='再选一座'`);
  await realClick('#add-compare');await check('comparison selection removal has visible feedback',`getAtlasSnapshot().compare.length===0 && document.querySelector('#compare-tray').hidden && document.querySelector('#add-compare').textContent==='加入比较'`);await realClick('#add-compare');await click('#detail-close');
  await input('乾清宫');await realClick('#catalog-body [data-record]');await realClick('#add-compare');await click('#detail-close');await input('保和殿');await realClick('#catalog-body [data-record]');await realClick('#add-compare');await check('comparison limit gives a clear response',`getAtlasSnapshot().compare.length===2 && document.querySelector('#toast').textContent.includes('已选两座建筑')`);await click('#detail-close');
  await realClick('#compare-open');await check('comparison button opens result panel',`document.querySelector('#compare-dialog').open`);await realClick('#compare-dialog [data-close-dialog]');await check('comparison close button returns to exploration',`!document.querySelector('#compare-dialog').open`);await realClick('#compare-clear');await check('clear comparison button removes tray',`getAtlasSnapshot().compare.length===0 && document.querySelector('#compare-tray').hidden`);await click('#reset-button');
  await realClick('#sources-button');await check('source button opens explanation',`document.querySelector('#source-dialog').open`);await realClick('#source-dialog [data-close-dialog]');await check('source close button returns to page',`!document.querySelector('#source-dialog').open`);
  const downloadPath=path.join(output,'button-downloads',String(Date.now()));await mkdir(downloadPath,{recursive:true});
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath,eventsEnabled:true});await realClick('#export-button');
  let downloaded=[];for(let i=0;i<30;i++){downloaded=(await readdir(downloadPath)).filter(name=>name.endsWith('.json'));if(downloaded.length)break;await pause(100);}
  if(!downloaded.length)throw new Error('Export button did not create a downloadable file');
  const exported=JSON.parse(await readFile(path.join(downloadPath,downloaded[0]),'utf8'));await check('desktop export produces a real downloadable JSON',`${exported.buildings.length}===140 && document.querySelector('#toast').textContent.includes('已导出')`);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await realClick('#mobile-sources');await check('mobile source button responds to real click',`document.querySelector('#source-dialog').open`);await realClick('#source-dialog [data-close-dialog]');await realClick('#mobile-export');await check('mobile export button gives confirmation',`!document.querySelector('#toast').hidden && document.querySelector('#toast').textContent.includes('已导出')`);
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});await click('#reset-button');await click('[data-view="network"]');
  await click('[data-kind="桥梁"]');await checkCleanCopy('bridge charts and matrix labels are clean');await click('#reset-button');
  const cleanIds=await evaluate(`['石家大院','太和殿'].map(name=>ATLAS_DATA.buildings.find(r=>r.name===name).id)`);
  for(const id of cleanIds){await click('.building-node[data-building="'+id+'"]');await checkCleanCopy('selection card has clean copy for '+id);await click('#selection-detail');await click('#find-similar');await checkCleanCopy('detail and similarity list have clean copy for '+id);await click('#add-compare');await click('#detail-close');}
  await click('#compare-open');await checkCleanCopy('comparison has no simulation labels');await click('#compare-dialog [data-close-dialog]');await click('#compare-clear');
  await click('[data-view="flow"]');await checkCleanCopy('flow labels have clean copy');await click('[data-view="network"]');await click('#sources-button');await checkCleanCopy('full-view source dialog has clean copy');await click('#source-dialog [data-close-dialog]');await click('#zoom-reset');await screenshot('clean-overview');
  await check('no uncaught runtime errors',`${errors.length}===0`);
  console.log('SNAPSHOT',await evaluate('getAtlasSnapshot()'));
  await writeFile(path.join(output,'results.json'),JSON.stringify({url:previewURL,results,errors},null,2));
}finally{
  if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
  browser.kill();
}
