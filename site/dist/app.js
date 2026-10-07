'use strict';
(() => {
  const dataset = window.ATLAS_DATA;
  if (!dataset || !Array.isArray(dataset.buildings)) {
    document.querySelector('main').innerHTML = '<p class="empty-state">建筑数据加载失败，请确认 data.js 与页面位于同一目录。</p>';
    return;
  }
  const baseRecords = dataset.buildings;
  const sourceById=new Map(baseRecords.map(record=>[record.id,record]));
  const simulationData=window.ATLAS_SIMULATION;
  const simulations=new Map((simulationData?.records||[]).map(r=>[r.id,r]));
  function mergeRecord(record) {
    const s=simulations.get(record.id);
    const values=s?Object.fromEntries(Object.entries(s.values).filter(([key])=>record[key]==null)):{};
    return {...record,...values,simulatedFields:Object.keys(values),simulationMethod:s?.method||null,originalMissingValues:Object.fromEntries(Object.keys(values).map(key=>[key,null]))};
  }
  const records = baseRecords.map(mergeRecord);
  const KINDS = ['民居', '官府', '皇宫', '桥梁'];
  const COLORS = {民居:'#74bfb0',官府:'#91adcf',皇宫:'#d6b67b',桥梁:'#cb947f'};
  const DIMENSIONS = ['文献时期','所在地','建筑形式','屋顶形制','屋面材料','承重材料','构造细节'];
  const DIM_COLORS = ['#91adcf','#729aa5','#74bfb0','#d6b67b','#cb947f','#ab9fcc','#ab9fcc'];
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const byId = new Map(records.map(r => [r.id,r]));
  const state = {kind:null, search:'', coverage:'all', feature:null, material:null, matrix:null,  scatter:null, flow:null, building:null, selected:null, hovered:null, view:'network', names:false, zoom:1, rotation:0, pan:{x:0,y:0}, compare:[]};
  let returnFocus = null, toastTimer, pointerStart = null, moved = false;
  let graphFrame=0, graphRoot=null, graphLabels=[], sectorLabels=[], displayedZoom=null;
  let graphHasNames=false, paintedFocus=null, centerMarkup=null;
  let edgeRasterTimer=0, edgeRasterVersion=0;
  let edgeRasterStatus='empty',edgeRasterImage=null;

  function features(record) {
    const entries = [];
    record.periods.forEach(p => entries.push(['文献时期',p,'period']));
    entries.push(['所在地',record.region,'region']);
    if (record.form) entries.push(['建筑形式',record.form,'form']);
    if (record.roof) entries.push(['屋顶形制',record.roof,'roof']);
    if (record.material) entries.push(['屋面材料',record.material,'material']);
    if (record.supportMaterial) entries.push(['承重材料',record.supportMaterial,'supportMaterial']);
    if (record.structure) entries.push(['构造细节',record.structure,'structure']);
    if (record.eaves) entries.push(['构造细节',record.eaves,'eaves']);
    return entries.map(([dimension,value,field]) => ({dimension,value,field,simulated:record.simulatedFields.includes(field),key:`${dimension}|${value}`}));
  }
  let recordFeatures,featureMap,featureList,relationCount;
  function rebuildFeatures() {
    recordFeatures=new Map(records.map(r=>[r.id,features(r)]));featureMap=new Map();
    records.forEach(record=>recordFeatures.get(record.id).forEach(f=>{
      if(!featureMap.has(f.key))featureMap.set(f.key,{...f,records:[],simulatedRecords:[]});
      const node=featureMap.get(f.key);node.records.push(record.id);if(f.simulated)node.simulatedRecords.push(record.id);
    }));
    featureList=[...featureMap.values()].sort((a,b)=>DIMENSIONS.indexOf(a.dimension)-DIMENSIONS.indexOf(b.dimension)||a.value.localeCompare(b.value,'zh-CN'));
    relationCount=records.reduce((n,r)=>n+recordFeatures.get(r.id).length,0);
  }
  rebuildFeatures();
  const isSimulated=(r,fields)=>fields.some(field=>r.simulatedFields.includes(field));
  function displayText(text) {return String(text??'').replace(/（模拟(?:估算)?）/g,'').replace(/模拟/g,'');}
  function fieldValue(r,field,v=r[field],unit='') {return value(v==null?v:displayText(v),unit);}
  const COVERAGE_LABELS={all:'全部资料',shape:'有形制资料',scale:'有开间资料',catalog:'文保名录样本'};
  function matchesCoverage(record,coverage=state.coverage) {
    const source=sourceById.get(record.id);
    if(coverage==='shape')return !!(source.roof||source.form||source.structure);
    if(coverage==='scale')return source.bays!=null&&source.depth!=null;
    if(coverage==='catalog')return !record.id.startsWith('p-');
    return true;
  }

  function matches(record) {
    if (state.building && record.id!==state.building) return false;
    if (state.kind && record.kind !== state.kind) return false;
    if(!matchesCoverage(record))return false;
    if (state.feature && !recordFeatures.get(record.id).some(f=>f.key === state.feature)) return false;
    if (state.material && record[state.material.field]!==state.material.value) return false;
    if (state.matrix && !(state.matrix.bridge?record.form?.replace('（名称明确）','')===state.matrix.form&&record.supportMaterial===state.matrix.material:record.roof === state.matrix.roof && record.bays === state.matrix.bays)) return false;
    if (state.scatter && !(state.scatter.bridge?record.length===state.scatter.bays&&record.width===state.scatter.depth:record.bays === state.scatter.bays && record.depth === state.scatter.depth)) return false;
    if (state.flow && !state.flow.every(f=>[r=>r.kind,flowPeriod,flowShape][f.column](record)===f.value)) return false;
    if (state.search) {
      const haystack=[record.name,record.kind,record.location,record.period,record.roof,record.material,record.surfaceMaterial,record.supportMaterial,record.structure,record.form].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(state.search.toLowerCase())) return false;
    }
    return true;
  }
  const current = () => records.filter(matches);
  function reset() {
    Object.assign(state,{kind:null,search:'',coverage:'all',feature:null,material:null,matrix:null,scatter:null,flow:null,building:null,selected:null,hovered:null});
    $('#search-input').value='';$('#coverage-filter').value='all';
    render();
  }
  function toast(message) {
    $('#toast').textContent=message;$('#toast').hidden=false;
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);
  }
  function toggleKind(kind) {if(kind===null&&state.kind===null){toast('当前已显示全部类型');return;}state.kind=state.kind===kind?null:kind;render();}
  function setFeature(key) {state.feature=state.feature===key?null:key;state.selected=null;state.hovered=null;render();}
  function chips() {
    const items=[];
    if (state.kind) items.push(['kind',state.kind]);
    if (state.building) items.push(['building','建筑：'+byId.get(state.building).name]);
    if (state.search) items.push(['search',`搜索：${state.search}`]);
    if (state.coverage!=='all') items.push(['coverage',COVERAGE_LABELS[state.coverage]]);
    if (state.feature) items.push(['feature',displayText(state.feature.replace('|','：'))]);
    if (state.material) items.push(['material','桥面材料：'+state.material.value]);
    if (state.matrix) items.push(['matrix',state.matrix.bridge?`${displayText(state.matrix.form)} · ${state.matrix.material}`:`${state.matrix.roof} · 面阔${state.matrix.bays}间`]);
    if (state.scatter) items.push(['scatter',state.scatter.bridge?`桥长${state.scatter.bays}米 · 桥宽${state.scatter.depth}米`:`面阔${state.scatter.bays}间 · 进深${state.scatter.depth}间`]);
    if (state.flow) items.push(['flow','组合：'+state.flow.map(f=>f.value).join(' → ')]);
    $('#active-filters').innerHTML=items.map(([key,label])=>`<button class="filter-chip" data-clear="${key}" aria-label="清除${escape(label)}筛选">${escape(label)}<span aria-hidden="true">×</span></button>`).join('');
    $('#active-filters').querySelectorAll('[data-clear]').forEach(button=>button.addEventListener('click',()=>{
      const key=button.dataset.clear;
      state[key]=key==='coverage'?'all':key==='search'?'':null;
      $('#search-input').value=state.search;$('#coverage-filter').value=state.coverage;render();
    }));
  }
  function renderCategories() {
    $('#category-filters').innerHTML=`<button data-kind="" class="${state.kind?'':'active'}" aria-pressed="${!state.kind}">全部</button>`+KINDS.map(kind=>`<button data-kind="${kind}" class="${state.kind===kind?'active':''}" aria-pressed="${state.kind===kind}" style="--color:${COLORS[kind]}"><i class="dot"></i>${kind}</button>`).join('');
    $('#category-filters').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>toggleKind(button.dataset.kind||null)));
  }

  // Stable positions preserve users' mental model during filtering.
  const positions=new Map(), sectors=[];
  let cursor=-Math.PI/2+0.045;
  const usable=Math.PI*2-.36;
  KINDS.forEach(kind=>{
    const group=records.filter(r=>r.kind===kind).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
    const size=group.length/records.length*usable;
    sectors.push({kind,start:cursor,end:cursor+size,middle:cursor+size/2,count:group.length});
    group.forEach((r,i)=>{
      const angle=cursor+(i+.5)/group.length*size;
      positions.set(r.id,{x:400+Math.cos(angle)*309,y:400+Math.sin(angle)*309,angle});
    });
    cursor+=size+.09;
  });
  const hubPositions=new Map();
  function layoutHubs() {
    hubPositions.clear();featureList.forEach((f,i)=>{
      const angle=-Math.PI/2+(i+.5)/featureList.length*Math.PI*2;
      const radius=featureList.length>60?190:158;
      hubPositions.set(f.key,{x:400+Math.cos(angle)*radius,y:400+Math.sin(angle)*radius,angle,radius});
    });
  }
  layoutHubs();
  const polar=(radius,angle)=>({x:400+radius*Math.cos(angle),y:400+radius*Math.sin(angle)});
  function arc(radius,start,end) {
    const a=polar(radius,start),b=polar(radius,end);
    return `M${a.x},${a.y} A${radius},${radius} 0 ${end-start>Math.PI?1:0} 1 ${b.x},${b.y}`;
  }
  function networkSVG(list) {
    const visible=new Set(list.map(r=>r.id));
    const focus=state.hovered || state.selected || state.feature;
    const focusRecord=focus && byId.get(focus);
    const focusFeature=focus && featureMap.get(focus);
    let html='<g id="graph-root">';
    html+='<circle cx="400" cy="400" r="365" fill="url(#halo)"/>';
    [100,145,220,268,309,337,362].forEach((r,i)=>html+=`<circle cx="400" cy="400" r="${r}" fill="none" stroke="${i===4?'#4b656955':'#37505a55'}" stroke-width="${i===4?1.2:.7}" ${i===2?'stroke-dasharray="2 8"':''}/>`);
    for(let i=0;i<120;i++){
      const angle=i/120*Math.PI*2,a=polar(342,angle),b=polar(i%5===0?351:346,angle);
      html+=`<path d="M${a.x},${a.y}L${b.x},${b.y}" stroke="#63818a66" stroke-width=".7"/>`;
    }
    sectors.forEach(s=>{
      const label=polar(375,s.middle),shown=list.filter(r=>r.kind===s.kind).length;
      html+=`<path d="${arc(327,s.start,s.end)}" fill="none" stroke="${COLORS[s.kind]}" stroke-width="2.5" opacity=".6"/>`;
      html+=`<g class="sector-button" role="button" tabindex="0" aria-label="筛选${s.kind}" data-sector="${s.kind}" data-label-x="${label.x}" data-label-y="${label.y}"><text x="${label.x}" y="${label.y-4}" text-anchor="middle" class="graph-sector" style="fill:${COLORS[s.kind]}">${s.kind}</text><text x="${label.x}" y="${label.y+15}" text-anchor="middle" class="graph-sector-count">${shown} / ${s.count}</text></g>`;
    });
    // Links encode explicit field membership. No inferred historical transmission edges.
    records.forEach(r=>{
      const a=positions.get(r.id);
      recordFeatures.get(r.id).forEach(f=>{
        const b=hubPositions.get(f.key);
        const related=focusRecord?focusRecord.id===r.id:focusFeature?focusFeature.key===f.key:true;
        let opacity=visible.has(r.id)?(focus?related?.72:.035:.15):.015;
        const stroke=related && focus?'1.4':'.65';
        html+=`<path class="network-edge" data-simulated="${f.simulated}" d="M${a.x.toFixed(2)},${a.y.toFixed(2)} C${(400+(a.x-400)*.27).toFixed(2)},${(400+(a.y-400)*.27).toFixed(2)} ${(400+(b.x-400)*.48).toFixed(2)},${(400+(b.y-400)*.48).toFixed(2)} ${b.x.toFixed(2)},${b.y.toFixed(2)}" fill="none" stroke="${COLORS[r.kind]}" stroke-width="${stroke}" opacity="${opacity}"/>`;
      });
    });
    featureList.forEach(f=>{
      const p=hubPositions.get(f.key),count=f.records.filter(id=>visible.has(id)).length;
      const selected=state.feature===f.key || focus===f.key;
      const color=DIM_COLORS[DIMENSIONS.indexOf(f.dimension)];
      const degree=p.angle*180/Math.PI,left=Math.cos(p.angle)<0;
      const angle=left?degree+180:degree;
      const label=polar(p.radius+12,p.angle);
      const shortLabel=f.dimension==='所在地'?f.value.replace(/(?:壮族|回族|维吾尔)?自治区|省|市/g,''):f.value.replace(/（名称明确）|（屋面）|（模拟）/g,'');
      html+=`<g class="node-group feature-node" tabindex="0" role="button" data-feature="${escape(f.key)}" aria-label="${escape(f.dimension+'：'+displayText(f.value)+'，'+count+'个匹配对象')}"><circle cx="${p.x}" cy="${p.y}" r="${selected?5.5:3.2}" fill="${color}" opacity="${count?1:.25}"/><circle class="node-hit" cx="${p.x}" cy="${p.y}" r="8"/><text class="hub-text" data-angle="${degree}" x="${label.x}" y="${label.y}" transform="rotate(${angle},${label.x},${label.y})" text-anchor="${left?'end':'start'}" dominant-baseline="middle" opacity="${count?.92:.25}">${escape(shortLabel)}</text><title>${escape(f.dimension+'：'+displayText(f.value)+' · '+count+'个对象')}</title></g>`;
    });
    records.forEach(r=>{
      const p=positions.get(r.id),active=visible.has(r.id),selected=focus===r.id||state.selected===r.id;
      const radius=selected?6:active?3.1:1.9;
      html+=`<g class="node-group building-node" role="button" tabindex="${active?0:-1}" data-building="${r.id}" aria-label="${escape(r.name+'，'+r.kind+(active?'':'，不匹配当前筛选'))}" opacity="${active?1:.17}"><circle cx="${p.x}" cy="${p.y}" r="${radius}" fill="${COLORS[r.kind]}" ${selected?'stroke="#f0e8d5" stroke-width="1.5"':''}/><circle class="node-hit" cx="${p.x}" cy="${p.y}" r="7"/><title>${escape(r.name+' · '+r.kind+' · '+r.period)}</title>`;
      if(state.names||state.zoom>=1.6){
        const label=polar(319,p.angle),degree=p.angle*180/Math.PI,left=Math.cos(p.angle)<0;
        html+=`<text class="building-label" data-angle="${degree}" x="${label.x}" y="${label.y}" transform="rotate(${left?degree+180:degree},${label.x},${label.y})" text-anchor="${left?'end':'start'}" dominant-baseline="middle">${escape(r.name)}</text>`;
      }
      html+='</g>';
    });
    html+='</g>';
    return html;
  }
  function drawNetwork(list=current()) {
    const svg=$('#network');
    clearEdgeRaster();
    svg.querySelector('#graph-root')?.remove();
    svg.insertAdjacentHTML('beforeend',networkSVG(list));
    graphRoot=svg.querySelector('#graph-root');
    graphHasNames=state.names||state.zoom>=1.6;
    graphLabels=[...graphRoot.querySelectorAll('[data-angle]')].map(node=>({node,degree:Number(node.dataset.angle),x:node.getAttribute('x'),y:node.getAttribute('y'),left:node.getAttribute('text-anchor')==='end'}));
    sectorLabels=[...graphRoot.querySelectorAll('[data-label-x]')].map(node=>({node,x:node.dataset.labelX,y:node.dataset.labelY}));
    paintedFocus=null;
    applyTransform();
    svg.querySelectorAll('[data-building]').forEach(node=>{
      const id=node.dataset.building;
      const activate=()=>{if(moved)return;if(!matches(byId.get(id))){toast('该建筑不匹配当前筛选，请先清除相关条件');return;}selectBuilding(id);};
      node.addEventListener('click',activate);
      node.addEventListener('mouseenter',event=>showGraphTooltip(event,id));
      node.addEventListener('mouseleave',hideGraphTooltip);
      node.addEventListener('focus',()=>{state.hovered=id;updateCenter();paintFocus();});
      node.addEventListener('blur',()=>{state.hovered=null;updateCenter();paintFocus();});
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}});
    });
    svg.querySelectorAll('[data-feature]').forEach(node=>{
      const key=node.dataset.feature;
      node.addEventListener('click',()=>{if(!moved)setFeature(key);});
      node.addEventListener('mouseenter',event=>showGraphTooltip(event,key));
      node.addEventListener('mouseleave',hideGraphTooltip);
      node.addEventListener('focus',()=>{state.hovered=key;updateCenter();paintFocus();});
      node.addEventListener('blur',()=>{state.hovered=null;updateCenter();paintFocus();});
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setFeature(key);}});
    });
    svg.querySelectorAll('[data-sector]').forEach(node=>{
      node.addEventListener('click',()=>{if(!moved)toggleKind(node.dataset.sector);});
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleKind(node.dataset.sector);}});
    });
    updateCenter();paintFocus();renderSelection();scheduleEdgeRaster();
  }
  function applyTransform() {
    graphRoot?.setAttribute('transform',`translate(${400+state.pan.x} ${400+state.pan.y}) scale(${state.zoom}) rotate(${state.rotation}) translate(-400 -400)`);
    // Radial labels only need a local transform when they cross the left/right boundary.
    graphLabels.forEach(label=>{
      const left=Math.cos((label.degree+state.rotation)*Math.PI/180)<0;
      if(left===label.left)return;
      label.node.setAttribute('transform',`rotate(${label.degree+(left?180:0)},${label.x},${label.y})`);
      label.node.setAttribute('text-anchor',left?'end':'start');label.left=left;
    });
    sectorLabels.forEach(label=>label.node.setAttribute('transform',`rotate(${-state.rotation},${label.x},${label.y})`));
    if(displayedZoom===state.zoom)return;
    displayedZoom=state.zoom;
    $('#zoom-label').textContent=Math.round(state.zoom*100)+'%';
    $('#zoom-in').disabled=state.zoom>=3;$('#zoom-out').disabled=state.zoom<=.65;
    $('#zoom-in').title=state.zoom>=3?'已达到放大上限（300%）':'放大图谱';
    $('#zoom-out').title=state.zoom<=.65?'已达到缩小下限（65%）':'缩小图谱';
    $('#graph-center').style.opacity=state.zoom>1.5?.3:1;
  }
  function scheduleGraphTransform() {
    if(graphFrame)return;
    graphFrame=requestAnimationFrame(()=>{
      graphFrame=0;
      if(graphHasNames!==(state.names||state.zoom>=1.6))drawNetwork();
      else applyTransform();
    });
  }
  function setZoom(zoom,coalesce=false) {
    const next=Math.min(3,Math.max(.65,zoom));
    if(next===state.zoom)return;
    state.zoom=next;
    if(coalesce)scheduleGraphTransform();
    else if(graphHasNames!==(state.names||state.zoom>=1.6))drawNetwork();
    else applyTransform();
  }
  function selectBuilding(id) {
    state.selected=state.selected===id?null:id;state.hovered=null;
    $('#graph-tooltip').hidden=true;drawNetwork();
  }
  function renderSelection() {
    const r=byId.get(state.selected),panel=$('#graph-selection');
    panel.hidden=!r||state.view!=='network';if(!r)return;
    panel.innerHTML=`<div class="selection-title"><span class="kind-tag" style="--color:${COLORS[r.kind]}">${r.kind}</span><strong>${escape(r.name)}</strong><span>${recordFeatures.get(r.id).length} 条关联</span><button id="selection-clear" aria-label="取消建筑聚焦">×</button></div><div class="selection-features">${recordFeatures.get(r.id).map(f=>`<button data-selection-feature="${escape(f.key)}" title="筛选${escape(f.dimension+'：'+displayText(f.value))}">${escape(displayText(f.value))}</button>`).join('')}</div><div class="selection-actions"><button id="selection-detail">查看资料</button><button id="selection-filter">${state.building===r.id?'取消单建筑筛选':'联动此建筑'}</button><span>点击上方特征，寻找同类建筑</span></div>`;
    $('#selection-clear').addEventListener('click',()=>{state.selected=null;state.hovered=null;drawNetwork();});
    $('#selection-detail').addEventListener('click',()=>openDetail(r.id));
    $('#selection-filter').addEventListener('click',()=>{state.building=state.building===r.id?null:r.id;render();});
    panel.querySelectorAll('[data-selection-feature]').forEach(button=>button.addEventListener('click',()=>{state.building=null;setFeature(button.dataset.selectionFeature);}));
  }
  function paintFocus() {
    const signature=JSON.stringify([state.hovered,state.selected,state.feature]);
    if(paintedFocus===signature)return;
    paintedFocus=signature;
    const key=state.hovered||state.selected||state.feature,record=byId.get(key),feature=featureMap.get(key);
    const relatedFeature=new Set(record?recordFeatures.get(record.id).map(f=>f.key):[]);
    let index=0;const paths=$('#network').querySelectorAll('.network-edge');
    records.forEach(r=>recordFeatures.get(r.id).forEach(f=>{
      const related=record?r.id===record.id:feature?feature.key===f.key:true;
      paths[index]?.setAttribute('opacity',matches(r)?key?related?.85:.025:.18:.012);
      paths[index++]?.setAttribute('stroke-width',key&&related?'1.6':'.65');
    }));
    $('#network').querySelectorAll('[data-building]').forEach(node=>{
      const r=byId.get(node.dataset.building),related=record?r.id===record.id:feature?feature.records.includes(r.id):true;
      node.setAttribute('opacity',!matches(r)?.12:key&&!related?.3:1);
      node.querySelector('circle').setAttribute('r',r.id===key||r.id===state.selected?'6':'3.1');
    });
    $('#network').querySelectorAll('[data-feature]').forEach(node=>{
      const f=featureMap.get(node.dataset.feature),related=record?relatedFeature.has(f.key):true;
      node.setAttribute('opacity',record&&!related?.2:1);
    });
  }
  function clearEdgeRaster() {
    clearTimeout(edgeRasterTimer);edgeRasterVersion++;
    edgeRasterStatus='empty';
    $('#network').classList.remove('edges-cached');
    graphRoot?.querySelector('.edge-raster')?.remove();
    if(edgeRasterImage){edgeRasterImage.onload=null;edgeRasterImage.onerror=null;edgeRasterImage=null;}
  }
  function scheduleEdgeRaster() {
    clearEdgeRaster();
    const version=edgeRasterVersion,root=graphRoot;
    edgeRasterStatus='scheduled';
    // Keep text and nodes live. Only the unchanged connections use a bitmap during dragging.
    edgeRasterTimer=setTimeout(()=>{
      if(version!==edgeRasterVersion||!root?.isConnected)return;
      edgeRasterStatus='drawing';
      const canvas=document.createElement('canvas');canvas.width=canvas.height=2400;
      const ctx=canvas.getContext('2d');if(!ctx)return;ctx.scale(3,3);
      const paths=[...root.querySelectorAll('.network-edge')];
      const key=state.selected||state.feature,record=byId.get(key),feature=featureMap.get(key);
      let index=0;
      // Dragging clears transient hover; cache the persistent selection rather than a hover frame.
      records.forEach(r=>recordFeatures.get(r.id).forEach(f=>{
        const edge=paths[index++],related=record?r.id===record.id:feature?feature.key===f.key:true;
        ctx.strokeStyle=edge.getAttribute('stroke');ctx.lineWidth=key&&related?1.6:.65;
        ctx.globalAlpha=matches(r)?key?related?.85:.025:.18:.012;
        ctx.setLineDash([]);
        ctx.stroke(new Path2D(edge.getAttribute('d')));
      }));
      edgeRasterStatus='encoding';
      const source=canvas.toDataURL('image/png');
      if(version!==edgeRasterVersion||!root.isConnected)return;
      edgeRasterStatus='decoding';
      const sprite=document.createElementNS('http://www.w3.org/2000/svg','image');
      sprite.setAttribute('class','edge-raster');sprite.setAttribute('x','0');sprite.setAttribute('y','0');sprite.setAttribute('width','800');sprite.setAttribute('height','800');sprite.setAttribute('aria-hidden','true');
      sprite.setAttribute('href',source);root.insertBefore(sprite,paths[0]);
      edgeRasterImage=new Image();
      edgeRasterImage.onload=()=>{if(version===edgeRasterVersion&&root.isConnected){$('#network').classList.add('edges-cached');edgeRasterStatus='ready';}};
      edgeRasterImage.onerror=()=>{if(version===edgeRasterVersion)edgeRasterStatus='unavailable';};
      edgeRasterImage.src=source;
    },120);
  }
  function updateCenter() {
    const item=byId.get(state.hovered||state.selected);
    const f=featureMap.get(state.hovered||state.feature);
    let markup;
    if(item){markup=`<span class="center-kicker">${escape(item.kind)} · ${escape(item.period)}</span><strong class="selected-name">${escape(item.name)}</strong><span>${recordFeatures.get(item.id).length} 条特征关联</span>`;}
    else if(f){markup=`<span class="center-kicker">${escape(f.dimension)}</span><strong class="selected-name">${escape(displayText(f.value.replace('（名称明确）','')))}</strong><span>${current().filter(r=>recordFeatures.get(r.id).some(x=>x.key===f.key)).length} 个匹配对象</span>`;}
    else{markup='<span class="center-kicker">ARCHITECTURAL GENES</span><div class="center-glyph">构</div><strong>万象同构</strong><span>点击节点，发现共同特征</span>';}
    if(markup!==centerMarkup){$('#graph-center').innerHTML=markup;centerMarkup=markup;}
  }
  function showGraphTooltip(event,key) {
    if(pointerStart&&moved)return;
    state.hovered=key;updateCenter();
    const tooltip=$('#graph-tooltip'),record=byId.get(key),feature=featureMap.get(key);
    const box=$('#network-view').getBoundingClientRect();
    tooltip.innerHTML=record?`<strong>${escape(record.name)}</strong><p>${escape(record.kind)} · ${escape(record.period)}<br>${escape(record.location)}<br>点击聚焦关联，再查看资料</p>`:`<strong>${escape(displayText(feature.value))}</strong><p>${escape(feature.dimension)} · ${feature.records.filter(id=>matches(byId.get(id))).length} 个匹配对象<br>点击筛选关联建筑</p>`;
    tooltip.hidden=false;
    const width=tooltip.offsetWidth,height=tooltip.offsetHeight;
    tooltip.style.left=Math.max(8,Math.min(event.clientX-box.left+16,box.width-width-8))+'px';
    tooltip.style.top=Math.max(8,Math.min(event.clientY-box.top+16,box.height-height-8))+'px';
    paintFocus();
  }
  function hideGraphTooltip() {
    if(pointerStart&&moved)return;
    state.hovered=null;$('#graph-tooltip').hidden=true;updateCenter();
    paintFocus();
  }

  function renderPurpose(list) {
    const scope=records.filter(record=>matchesCoverage(record));
    $('#purpose-scope').textContent=COVERAGE_LABELS[state.coverage];
    $('#purpose-chart').innerHTML=KINDS.map(kind=>{
      const all=scope.filter(record=>record.kind===kind).length,n=list.filter(record=>record.kind===kind).length;
      const percentage=list.length?(n/list.length*100).toFixed(1):'0.0';
      const scopePercentage=scope.length?(all/scope.length*100).toFixed(1):'0.0';
      return `<button class="chart-button ${state.kind===kind?'selected':''} ${all?'':'empty-kind'}" aria-pressed="${state.kind===kind}" style="--color:${COLORS[kind]}" data-chart-kind="${kind}" data-count="${n}" data-scope-count="${all}" data-percent="${percentage}" aria-label="${COVERAGE_LABELS[state.coverage]}，${kind}，当前${n}个，占比${percentage}%，范围内${all}个" title="点击${kind}，联动图谱与其他图表"><span class="bar-label">${kind}</span><span class="bar-track"><span class="bar-baseline" style="width:${scopePercentage}%"></span><span class="bar-fill" style="width:${percentage}%;position:relative"></span></span><span class="bar-value"><strong>${n}</strong><small>${percentage}%</small></span></button>`;
    }).join('')+'<div class="material-row purpose-summary"><span>当前匹配 / 范围对象</span><strong>'+list.length+' / '+scope.length+'</strong></div>';
    $('#purpose-chart').querySelectorAll('[data-chart-kind]').forEach(b=>b.addEventListener('click',()=>toggleKind(b.dataset.chartKind)));
  }
  function renderMaterial(list) {
    const bridges=list.length>0&&list.every(r=>r.kind==='桥梁'),field=bridges?'surfaceMaterial':'material';
    const applicable=!bridges?list.filter(r=>r.kind!=='桥梁'||r.material):list;
    const sample=applicable.filter(r=>r[field]),known=sample.length;
    const percentage=applicable.length?Math.round(known/applicable.length*100):0;
    const groups=[...new Set(sample.map(r=>r[field]))];
    $('#material-title').textContent='材料分布';
    $('#material-meta').textContent='数量 / 占比';
    $('#material-note').textContent=`${applicable.length} 个适用对象 · 屋面与承重材料分别统计`;
    $('#material-chart').innerHTML=`<div class="material-big">${percentage}%<span>${bridges?'桥面':'屋面'}材料</span></div><div class="evidence-track"><span style="width:${percentage}%"></span></div><div class="material-chart-rows">${groups.map(name=>{const rows=sample.filter(r=>r[field]===name);return `<div class="material-row material-category"><button class="material-option" data-material="${escape(name)}"><span class="material-name">${escape(displayText(name.replace('（廊屋屋面）','（廊屋）').replace('（屋面）','').replace('（桥面）','')))}</span><span class="material-meter" aria-hidden="true"><i style="width:${applicable.length?rows.length/applicable.length*100:0}%"></i></span><strong>${rows.length}</strong></button></div>`}).join('')}<div class="material-row material-summary"><span>有值 / 空缺</span><strong>${known} / ${applicable.length-known}</strong></div><div class="material-row material-summary"><span>承重材料</span><strong>${list.filter(r=>r.supportMaterial).length} / ${list.length}</strong></div></div>`;
    $('#material-chart').querySelectorAll('[data-material]').forEach(button=>{
      const selected=field==='material'?state.feature==='屋面材料|'+button.dataset.material:state.material?.field===field&&state.material?.value===button.dataset.material;
      button.setAttribute('aria-pressed',selected);button.classList.toggle('selected-control',selected);
      button.addEventListener('click',()=>{if(field==='material')setFeature('屋面材料|'+button.dataset.material);else{state.material=state.material?.field===field&&state.material?.value===button.dataset.material?null:{field,value:button.dataset.material};render();}});
    });
  }
  function chartBox(selector) {
    const el=$(selector);
    const minimum=matchMedia('(min-width:1100px) and (min-height:600px)').matches?(selector==='#shape-chart'?130:120):110;
    return {width:Math.max(150,el.clientWidth),height:Math.max(minimum,el.clientHeight)};
  }
  function renderShape(list) {
    const bridges=list.length>0&&list.every(r=>r.kind==='桥梁');
    $('.shape-panel h2').textContent=bridges?'桥型关联':'形制关联';
    if(bridges){renderBridgeMatrix(list);return;}
    const sample=list.filter(r=>r.kind!=='桥梁'&&r.roof&&r.bays!=null),roofs=['庑殿顶','歇山顶','攒尖顶','硬山顶','悬山顶'],bays=[3,5,7,9,11];
    
    $('#shape-count').textContent=sample.length+' 个样本';
    $('#shape-note').textContent='屋顶 × 开间 · 点击方格联动筛选';
    if(!sample.length){$('#shape-chart').innerHTML='<div class="empty-chart">当前筛选下暂无<br>屋顶与开间的成对资料</div>';return;}
    const {width,height}=chartBox('#shape-chart'),labelWidth=44,top=23,bottom=17;
    const cell=Math.min((width-labelWidth-5)/bays.length,(height-top-bottom)/roofs.length);
    const col=cell,row=cell,startX=(width-labelWidth-bays.length*cell-5)/2+labelWidth,startY=top+(height-top-bottom-roofs.length*cell)/2;
    let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="屋顶和开间交叉矩阵">`;
    bays.forEach((b,i)=>svg+=`<text x="${startX+(i+.5)*col}" y="15" text-anchor="middle">${b}</text>`);
    roofs.forEach((roof,j)=>{
      svg+=`<text x="${startX-7}" y="${startY+(j+.5)*row+4}" text-anchor="end">${roof.replace('顶','')}</text>`;
      bays.forEach((b,i)=>{
        const cellRecords=sample.filter(r=>r.roof===roof&&r.bays===b),count=cellRecords.length;
        const selected=state.matrix?.roof===roof&&state.matrix?.bays===b;
        const xx=startX+i*col,yy=startY+j*row;
        svg+=`<g class="matrix-cell" role="button" tabindex="0" aria-pressed="${!!selected}" data-roof="${roof}" data-bays="${b}" aria-label="${roof}，面阔${b}间，${count}个对象"><rect x="${xx}" y="${yy}" width="${col-3}" height="${row-3}" rx="2" fill="${count?`rgba(116,191,176,${.25+Math.min(count,4)*.15})`:'#223841'}" ${selected?'stroke="#d6b67b" stroke-width="2"':''}/><text x="${xx+(col-3)/2}" y="${yy+(row-3)/2+4}" text-anchor="middle" style="fill:${count?'#ecf4ed':'#6d8792'};font-size:12px">${count||'·'}</text><title>${roof} · ${b}间 · ${count}个对象</title></g>`;
      });
    });
    svg+=`<text x="${startX}" y="${height-2}" class="axis-title">面阔/间</text></svg>`;
    $('#shape-chart').innerHTML=svg;
    $('#shape-chart').querySelectorAll('[data-roof]').forEach(b=>{
      const select=()=>{const next={roof:b.dataset.roof,bays:Number(b.dataset.bays)};state.matrix=state.matrix?.roof===next.roof&&state.matrix?.bays===next.bays?null:next;render();};
      b.addEventListener('click',select);b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});
    });
  }
  function renderBridgeMatrix(list) {
    const formValue=r=>r.form.replace('（名称明确）','');
    const forms=[...new Set(list.map(formValue))].sort(),materials=['石材','木材'];
    $('#shape-count').textContent=list.length+' 个样本';
    $('#shape-note').textContent='桥型 × 承重材料 · 点击方格联动筛选';
    const {width,height}=chartBox('#shape-chart'),labelWidth=60,top=24;
    const cell=Math.min((width-labelWidth-5)/2,(height-top-5)/forms.length),col=cell,row=cell;
    const startX=(width-labelWidth-2*cell-5)/2+labelWidth,startY=top+(height-top-5-forms.length*cell)/2;
    let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="桥型与承重材料矩阵">`;
    materials.forEach((m,i)=>svg+=`<text x="${startX+(i+.5)*col}" y="16" text-anchor="middle">${m}</text>`);
    forms.forEach((form,j)=>{
      svg+=`<text x="${startX-7}" y="${startY+(j+.5)*row+4}" text-anchor="end">${escape(form.replace('（名称明确）',''))}</text>`;
      materials.forEach((material,i)=>{
        const count=list.filter(r=>formValue(r)===form&&r.supportMaterial===material).length;
        const selected=state.matrix?.bridge&&state.matrix.form===form&&state.matrix.material===material;
        const xx=startX+i*col,yy=startY+j*row;
        svg+=`<g class="bridge-matrix-cell" role="button" tabindex="0" aria-pressed="${!!selected}" data-form="${escape(form)}" data-support="${material}" aria-label="${escape(form)}，${material}，${count}个对象"><rect x="${xx}" y="${yy}" width="${col-4}" height="${row-4}" rx="2" fill="${count?'#629a8d':'#223841'}" ${selected?'stroke="#e8c882" stroke-width="2"':''}/><text x="${xx+(col-4)/2}" y="${yy+(row-4)/2+4}" text-anchor="middle" style="fill:#e9efdf">${count||'·'}</text><title>${escape(form)} · ${material} · ${count}个对象</title></g>`;
      });
    });
    svg+='</svg>';$('#shape-chart').innerHTML=svg;
    $('#shape-chart').querySelectorAll('[data-support]').forEach(button=>{
      const select=()=>{const next={bridge:true,form:button.dataset.form,material:button.dataset.support};state.matrix=state.matrix?.bridge&&state.matrix?.form===next.form&&state.matrix?.material===next.material?null:next;render();};
      button.addEventListener('click',select);button.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});
    });
  }
  function renderScale(list) {
    const bridge=list.length>0&&list.every(r=>r.kind==='桥梁');
    const xField=bridge?'length':'bays',yField=bridge?'width':'depth';
    const sample=list.filter(r=>(bridge||r.kind!=='桥梁')&&r[xField]!=null&&r[yField]!=null);
    
    $('#scale-title').textContent=bridge?'桥长与桥宽':'开间与进深';
    $('#scale-count').textContent=sample.length+' 个样本';
    $('#scale-note').textContent=`${bridge?'单位：米':'单位：间'} · 点击散点查看匹配对象`;
    if(!sample.length){$('#scale-chart').innerHTML='<div class="empty-chart">当前筛选下暂无<br>可用的成对尺度资料</div>';return;}
    const xMax=bridge?Math.ceil(Math.max(...sample.map(r=>r.length))/20)*20:12,yMax=bridge?Math.ceil(Math.max(...sample.map(r=>r.width))/2)*2:6;
    const {width,height}=chartBox('#scale-chart'),leftMargin=34,rightMargin=14,top=23,bottom=28;
    const plotHeight=height-top-bottom,plotWidth=Math.min(width-leftMargin-rightMargin,plotHeight*1.8);
    const left=(width-leftMargin-rightMargin-plotWidth)/2+leftMargin,right=width-left-plotWidth;
    const x=n=>left+n/xMax*plotWidth,y=n=>height-bottom-n/yMax*plotHeight;
    const xTicks=bridge?[0,xMax/3,xMax*2/3,xMax]:[0,3,6,9,12],yTicks=bridge?[0,yMax/3,yMax*2/3,yMax]:[0,2,4,6];
    let svg=`<svg viewBox="0 0 ${width} ${height}" data-plot-ratio="${plotWidth/plotHeight}" role="img" aria-label="${bridge?'桥长与桥宽':'面阔开间与进深'}散点图">`;
    yTicks.forEach(n=>svg+=`<path d="M${left} ${y(n)}H${width-right}" stroke="#38515b" stroke-dasharray="2 4"/><text x="${left-8}" y="${y(n)+4}" text-anchor="end">${Number(n.toFixed(1))}</text>`);
    xTicks.forEach(n=>svg+=`<text x="${x(n)}" y="${height-13}" text-anchor="middle">${Number(n.toFixed(1))}</text>`);
    svg+=`<path d="M${left} ${top}V${height-bottom}H${width-right}" fill="none" stroke="#63818b"/><text x="${left-26}" y="13" class="axis-title">${bridge?'桥宽 / 米':'进深 / 间'}</text><text x="${width-right}" y="${height-1}" text-anchor="end" class="axis-title">${bridge?'桥长 / 米':'面阔 / 间'}</text>`;
    const groups=new Map();sample.forEach(r=>{const key=`${r[xField]}|${r[yField]}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);});
    groups.forEach(group=>{
      const r=group[0],xx=r[xField],yy=r[yField],sim=group.some(v=>isSimulated(v,[xField,yField])),selected=state.scatter?.bays===xx&&state.scatter?.depth===yy;
      svg+=`<g class="scatter-point" tabindex="0" role="button" data-bays="${xx}" data-depth="${yy}" data-bridge="${bridge}" data-simulated="${sim}" aria-label="${xx} × ${yy}${bridge?'米':'间'}：${escape(group.map(v=>v.name).join('、'))}"><circle cx="${x(xx)}" cy="${y(yy)}" r="${4+Math.sqrt(group.length)*1.2}" fill="${COLORS[r.kind]}" stroke="${selected?'#fff':COLORS[r.kind]}" stroke-width="${selected?2:1.5}" opacity=".9"/><circle cx="${x(xx)}" cy="${y(yy)}" r="10" fill="transparent"/><title>${escape(group.map(v=>v.name).join('、'))} · ${xx} × ${yy}${bridge?'米':'间'}</title></g>`;
    });
    svg+='</svg>';$('#scale-chart').innerHTML=svg;
    $('#scale-chart').querySelectorAll('[data-bays]').forEach(button=>{
      const select=()=>{const next={bays:Number(button.dataset.bays),depth:Number(button.dataset.depth),bridge:button.dataset.bridge==='true'};state.scatter=state.scatter?.bays===next.bays&&state.scatter?.depth===next.depth?null:next;render();};
      button.addEventListener('click',select);button.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});
    });
  }
  function flowPeriod(r) {
    if(r.period.includes('争议'))return '年代有争议';
    return r.periods.length===1?r.periods[0]+'代':r.periods.length>1?'跨时期':'时期待核实';
  }
  function flowShape(r) {return displayText(r.roof||r.form?.replace('（名称明确）','')||'形制待补充');}
  function renderFlow(list) {
    const width=800,height=590,padding=70,nodeWidth=12;
    const dimensions=[{title:'类型',x:110,get:r=>r.kind},{title:'文献时期',x:385,get:flowPeriod},{title:'形制',x:670,get:flowShape}];
    let svg='';
    if(!list.length){$('#flow-chart').innerHTML='<text x="400" y="260" text-anchor="middle">暂无匹配对象，请调整筛选条件</text>';return;}
    const columns=dimensions.map(d=>{
      const values=[...new Set(list.map(d.get))],counts=new Map(values.map(v=>[v,list.filter(r=>d.get(r)===v).length]));
      const available=height-padding*2-(values.length-1)*17;
      let cursor=padding;
      const nodes=values.map(value=>{const node={value,count:counts.get(value),y:cursor,height:counts.get(value)/list.length*available,x:d.x};cursor+=node.height+17;return node;});
      return {...d,nodes};
    });
    columns.forEach(column=>svg+=`<text x="${column.x}" y="35" text-anchor="middle" style="fill:#a1b1b7;letter-spacing:2px">${column.title}</text>`);
    for(let i=0;i<2;i++){
      const a=columns[i],b=columns[i+1],leftOffsets=new Map(a.nodes.map(n=>[n.value,0])),rightOffsets=new Map(b.nodes.map(n=>[n.value,0]));
      a.nodes.forEach(left=>b.nodes.forEach(right=>{
        const group=list.filter(r=>a.get(r)===left.value&&b.get(r)===right.value);if(!group.length)return;
        const lHeight=group.length/left.count*left.height,rHeight=group.length/right.count*right.height;
        const y1=left.y+leftOffsets.get(left.value),y2=right.y+rightOffsets.get(right.value),x1=a.x+nodeWidth/2,x2=b.x-nodeWidth/2;
        const color=i===0?COLORS[left.value]:'#789f9f';
        svg+=`<path class="flow-band" tabindex="0" role="button" aria-label="${escape(left.value+'到'+right.value+'：'+group.length+'个对象')}" data-flow-column="${i}" data-flow-left="${escape(left.value)}" data-flow-right="${escape(right.value)}" d="M${x1} ${y1} C${x1+110} ${y1} ${x2-110} ${y2} ${x2} ${y2} L${x2} ${y2+rHeight} C${x2-110} ${y2+rHeight} ${x1+110} ${y1+lHeight} ${x1} ${y1+lHeight}Z" fill="${color}" opacity=".25"><title>${escape(left.value+' → '+right.value+' · '+group.length+'个对象')}</title></path>`;
        leftOffsets.set(left.value,leftOffsets.get(left.value)+lHeight);rightOffsets.set(right.value,rightOffsets.get(right.value)+rHeight);
      }));
    }
    columns.forEach((column,i)=>column.nodes.forEach(n=>{
      const color=i===0?COLORS[n.value]:'#91b4b1';
      svg+=`<g class="flow-node" tabindex="0" role="button" data-flow-node="${i}" data-value="${escape(n.value)}" aria-label="${escape(n.value+'：'+n.count+'个对象')}"><rect x="${n.x-nodeWidth/2}" y="${n.y}" width="${nodeWidth}" height="${Math.max(n.height,2)}" fill="${color}"/><text x="${n.x+(i===0?-15:15)}" y="${n.y+n.height/2+4}" text-anchor="${i===0?'end':'start'}" style="font-size:12px">${escape(n.value)} <tspan fill="#93aab3">${n.count}</tspan></text><title>${escape(n.value+' · '+n.count+'个对象')}</title></g>`;
    }));
    $('#flow-chart').innerHTML=svg;
    $('#flow-chart').querySelectorAll('[data-flow-node]').forEach(node=>{
      const select=()=>selectFlowNode(Number(node.dataset.flowNode),node.dataset.value);
      node.addEventListener('click',select);node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});
    });
    $('#flow-chart').querySelectorAll('[data-flow-column]').forEach(node=>{
      const select=()=>{
        const i=Number(node.dataset.flowColumn),left=node.dataset.flowLeft,right=node.dataset.flowRight;
        state.flow=[{column:i,value:left},{column:i+1,value:right}];
        render();
      };
      node.addEventListener('click',select);node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});
    });
  }
  function selectFlowNode(column,value,rerender=true) {
    const next=[{column,value}];
    state.flow=state.flow?.length===1&&state.flow[0].column===column&&state.flow[0].value===value?null:next;
    if(rerender)render();
  }
  function renderCatalog(list) {
    $('#catalog-summary').textContent=`${list.length} 个匹配对象 · 点击名称查看建筑资料`;
    $('#catalog-body').innerHTML=list.length?list.map(r=>`<tr><td><button data-record="${r.id}">${escape(r.name)}</button><div class="coverage-tag">${escape(r.location)}</div></td><td><span class="kind-tag" style="--color:${COLORS[r.kind]}">${r.kind}</span></td><td>${escape(r.period)}<div class="coverage-tag">${r.kind==='皇宫'?'历史沿革时期':'文保名录时代'}</div></td><td><span class="coverage-tag">${r.roof?'屋顶：'+escape(displayText(r.roof)):r.form?'形制：'+escape(displayText(r.form)):'名录信息'}<br>${r.bays!=null?'面阔 '+r.bays+' 间':r.kind==='桥梁'&&r.length!=null?'桥长 '+r.length+' 米':'尺度待补充'}</span></td></tr>`).join(''):'<tr><td colspan="4"><div class="empty-state"><strong>暂无匹配建筑</strong>试试清除部分条件，或搜索另一项特征。<br><button id="empty-reset">重置筛选</button></div></td></tr>';
    $('#catalog-body').querySelectorAll('[data-record]').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.record)));
    $('#empty-reset')?.addEventListener('click',reset);
  }
  function setView(view) {
    const same=state.view===view;
    state.view=view;
    document.querySelectorAll('[data-view]').forEach(button=>{button.classList.toggle('active',button.dataset.view===view);button.setAttribute('aria-pressed',button.dataset.view===view);});
    ['network','flow','catalog'].forEach(v=>$('#'+v+'-view').hidden=v!==view);
    $('#stage-title').textContent=({network:'营造星盘',flow:'特征组合',catalog:'建筑名录'})[view];
    $('#zoom-controls').hidden=view!=='network';$('#names-button').hidden=view!=='network';
    renderSelection();
    $('#graph-legend').hidden=view==='catalog';
    $('#stage-status').textContent=({network:'拖动旋转 · 滚轮缩放 · 点击节点探索',flow:'流带宽度 · 对象数量　缺失保留为未知',catalog:'文保单位与宫城单体分开标注'})[view];
    if(view==='flow')renderFlow(current());
    if(same)toast('当前已在'+({network:'营造图谱',flow:'特征组合',catalog:'建筑名录'})[view]);
  }
  function render() {
    $('#relation-count').textContent=relationCount;$('#feature-count').textContent=featureList.length;
    $('#relation-label').textContent='特征关联';
    $('#relation-footnote').textContent='连线：建筑与特征关系 · 颜色：建筑类型';
    $('#flow-view .flow-note').textContent='类型 → 文献时期 → 形制 · 流带宽度表示对象数量';
    if(state.selected&&!matches(byId.get(state.selected)))state.selected=null;
    const list=current();
    $('#visible-count').textContent=list.length;
    renderCategories();chips();
    renderPurpose(list);renderMaterial(list);renderShape(list);renderScale(list);renderCatalog(list);
    drawNetwork(list);if(state.view==='flow')renderFlow(list);
    $('#names-button').setAttribute('aria-pressed',state.names);$('#names-button').textContent=state.names?'收起名称':'显示名称';
  }

  const value=(v,unit='')=>v==null?'<span class="unknown">暂无核实资料</span>':escape(v)+unit;
  const detailFields=r=>[
    ['对象类型',r.kind,'kind'],['收录层级',r.scope,'scope'],['来源所载时期',r.period,'period'],['屋顶形制',r.roofDetail|| (r.roof?(r.eaves||'')+r.roof:null),['roof','eaves']],['屋面材料',r.material,'material'],['桥面材料',r.surfaceMaterial,'surfaceMaterial'],['承重材料',r.supportMaterial,'supportMaterial'],['构造细节',r.structure,'structure'],['建筑形式',r.form,'form'],['面阔开间',r.bays==null?null:r.bays+' 间','bays'],['进深开间',r.depth==null?null:r.depth+' 间','depth'],[r.kind==='桥梁'?'桥面面积':'建筑面积',r.area==null?null:r.area+' ㎡','area'],['面积口径',r.areaBasis,'areaBasis'],['高度',r.height==null?null:r.height+' 米','height'],['桥长',r.length==null?null:r.length+' 米','length'],['桥宽',r.width==null?null:r.width+' 米（'+r.widthQualifier+'）',['width','widthQualifier']],['跨度',r.span==null?null:r.span+' 米','span']
  ];
  function openDetail(id) {
    const record=byId.get(id);if(!record)return;
    if($('#detail-drawer').hidden)returnFocus=document.activeElement;
    state.selected=id;state.hovered=null;drawNetwork();
    const r=record;
    $('#detail-content').innerHTML=`<div class="drawer-header"><span class="eyebrow">BUILDING DOSSIER</span><button id="detail-close" class="close-button" aria-label="关闭建筑详情">×</button></div><div class="drawer-body"><span class="kind-tag" style="--color:${COLORS[r.kind]}"><i class="dot"></i>${r.kind}</span><h2>${escape(r.name)}</h2><div class="detail-location">${escape(r.location)}</div><p class="detail-summary">${escape(r.summary)}</p><dl class="detail-field-list">${detailFields(r).map(([key,v,field])=>`<div><dt>${key}</dt><dd>${fieldValue(r,field,v)}</dd></div>`).join('')}</dl><section class="detail-section"><h3>年代口径</h3><p>${escape(r.dateBasis)}</p>${r.events.length?'<ul class="event-list">'+r.events.map(e=>`<li><strong>${e.year}</strong>${escape(e.type)}</li>`).join('')+'</ul>':'<p>尚未整理可用于精确比较的建造／重建事件。</p>'}</section><section class="detail-section"><h3>资料来源</h3><a class="source-link" href="${escape(r.source)}" target="_blank" rel="noopener noreferrer">${escape(r.sourceName)}</a>${r.auxSource?`<a class="source-link" href="${escape(r.auxSource)}" target="_blank" rel="noopener noreferrer">故宫官方青少版建筑解说原始数据</a>`:''}<p>${escape(r.sourceStatus)}${r.code?' · 编号 '+escape(r.code):''} · 整理日期 ${dataset.meta.updated}</p>${r.imageUrl?`<a class="source-link" href="${escape(r.imageUrl)}" target="_blank" rel="noopener noreferrer">查看官网建筑配图</a><p>${escape(r.imageCaption)}。图片再用许可尚未核实，本项目未复制图片。</p>`:''}</section><section class="detail-section"><h3>待补充资料</h3><div class="gap-tags">${r.gaps.map(g=>`<span>${escape(g)}</span>`).join('')}</div><p>局部字段有资料，不代表整座建筑已经完成测绘。</p></section><div class="detail-buttons"><button id="add-compare" class="primary-button">${state.compare.includes(id)?'已加入比较':'加入比较'}</button><button id="find-similar" class="secondary-button">寻找相近建筑</button></div><section class="detail-section" id="similar-section" hidden><h3>共同特征最多的对象</h3><p>按已知共同特征数排序；缺失字段不作为差异，也不推断历史传承。</p><ul id="similar-list" class="similar-list"></ul></section></div>`;
    $('#drawer-scrim').hidden=false;$('#detail-drawer').hidden=false;document.body.classList.add('modal-open');
    $('#detail-drawer').scrollTop=0;$('#detail-close').focus();
    $('#detail-close').addEventListener('click',closeDetail);
    $('#add-compare').addEventListener('click',()=>addCompare(id));
    $('#find-similar').addEventListener('click',()=>showSimilar(id));
  }
  function closeDetail() {
    $('#detail-drawer').hidden=true;$('#drawer-scrim').hidden=true;document.body.classList.remove('modal-open');
    state.selected=null;drawNetwork();
    if(returnFocus?.isConnected)returnFocus.focus();else $('#list-button').focus();
  }
  function addCompare(id) {
    if(state.compare.includes(id)){state.compare=state.compare.filter(x=>x!==id);$('#add-compare').textContent='加入比较';}
    else if(state.compare.length===2){toast('已选两座建筑，请先清空比较清单再选择');return;}
    else{state.compare.push(id);$('#add-compare').textContent='已加入比较';toast(state.compare.length===1?'已加入比较，再选择一座建筑':'两座建筑已选好，可以查看比较');}
    renderCompareTray();
  }
  function renderCompareTray() {
    $('#compare-tray').hidden=!state.compare.length;
    document.body.classList.toggle('has-comparison',state.compare.length>0);
    $('#compare-names').textContent=state.compare.map(id=>byId.get(id).name).join(' / ');
    $('#compare-open').disabled=state.compare.length!==2;
    $('#compare-open').textContent=state.compare.length===1?'再选一座':'查看比较';
    $('#compare-open').title=state.compare.length===1?'请选择第二座建筑后再比较':'查看两座建筑的共同点与差异';
  }
  function showSimilar(id) {
    const r=byId.get(id),base=new Set(recordFeatures.get(id).filter(f=>f.dimension!=='所在地'&&f.dimension!=='文献时期').map(f=>f.key));
    const scored=records.filter(v=>v.id!==id).map(v=>{
      const common=recordFeatures.get(v.id).filter(f=>base.has(f.key));
      return {r:v,common,count:common.length};
    }).filter(v=>v.count>0).sort((a,b)=>b.count-a.count||a.r.name.localeCompare(b.r.name,'zh-CN')).slice(0,6);
    $('#similar-section').hidden=false;
    $('#find-similar').setAttribute('aria-expanded','true');
    $('#similar-list').innerHTML=scored.length?scored.map(v=>`<li><button data-similar="${v.r.id}"><span>${escape(v.r.name)}<small>共同：${escape(v.common.map(f=>displayText(f.value)).join('、'))}</small></span><span class="similar-number">${v.count}</span></button></li>`).join(''):'<li><p>当前对象的已知形制特征不足，暂不计算相似关系。</p></li>';
    $('#similar-list').querySelectorAll('[data-similar]').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.similar)));
    $('#similar-section').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  function openCompare() {
    if(state.compare.length!==2)return;
    if(!$('#detail-drawer').hidden)closeDetail();
    const [a,b]=state.compare.map(id=>byId.get(id));
    const aKeys=new Set(recordFeatures.get(a.id).filter(f=>!['所在地','文献时期'].includes(f.dimension)).map(f=>f.key));
    const common=recordFeatures.get(b.id).filter(f=>aKeys.has(f.key)).map(f=>f.value);
    const aa=detailFields(a),bb=detailFields(b);
    $('#compare-content').innerHTML=`<p class="compare-common">共同建筑特征：${common.length?escape(common.map(displayText).join('、')):'暂无可比较的共同形制记录'}</p><table class="compare-table"><thead><tr><th>比较字段</th><th>${escape(a.name)}</th><th>${escape(b.name)}</th></tr></thead><tbody>${aa.map(([key,v,field],i)=>`<tr><td>${key}</td><td>${fieldValue(a,field,v)}</td><td>${fieldValue(b,bb[i][2],bb[i][1])}</td></tr>`).join('')}<tr><td>年代说明</td><td>${escape(a.dateBasis)}</td><td>${escape(b.dateBasis)}</td></tr><tr><td>资料来源</td><td><a class="source-link" href="${escape(a.source)}" target="_blank" rel="noopener noreferrer">查看来源</a></td><td><a class="source-link" href="${escape(b.source)}" target="_blank" rel="noopener noreferrer">查看来源</a></td></tr></tbody></table><p class="chart-note">屋顶、屋面材料与局部开间可独立比较；资料层级不同的对象不进行总量、面积或完整程度排名。</p>`;
    $('#compare-dialog').showModal();
  }
  function openSources() {
    const roof=records.filter(r=>r.roof).length,scale=records.filter(r=>r.bays!=null&&r.depth!=null).length;
    $('#source-content').innerHTML=`<div class="source-stats"><span><strong>${records.length}</strong>收录对象</span><span><strong>${roof}</strong>屋顶条目</span><span><strong>${scale}</strong>开间与进深成对资料</span></div><h3>收录范围与对象层级</h3><p>${escape(dataset.meta.scope)}。本项目筛选民居、官府、皇宫和桥梁，排除寺庙、宝塔及其他无关类型。名录中跨越民国等超出范围且尚未逐项核实的 ${dataset.excluded.filter(r=>r.reason.includes("1911")).length} 个候选对象暂未纳入，历史别名另行去重。</p><h3>特征关联</h3><p>连线表示建筑与特征的对应关系，颜色区分建筑类型。所在地仅用省级文字分类，不采用地理坐标或地图。名称明确写有“土楼”“廊桥”等的对象，标注“名称明确”；其余形制不从建筑名称猜测。屋面材料与承重材料分开保存。</p><h3>年代与比较</h3><p>${escape(dataset.meta.chronology)}名录对象的时期来自名录，故宫对象的时期来自历史沿革解说，这两种口径在详情与名录中明确标注。时期关系用于文献探索，不用于精确年代排名。</p><h3>缺失与证据</h3><p>空值表示缺失，不按0绘图。填充率只表示字段是否有资料，不表示证据可信程度或测绘完整程度。尺寸与矩阵只统计字段同时有值的对象；重叠点可以筛选后在完整名录逐项查看。</p><h3>来源目录</h3>${dataset.meta.sources.map(source=>`<div class="source-item"><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)}</a><small>${escape(source.authority)}</small></div>`).join('')}<h3>图片与参赛说明</h3><p>未复制官网建筑照片，仅提供原图与来源链接。正式使用图片前仍需核对视角和再用许可。${escape(dataset.meta.aiNote)}本作品为本地制作结果，未代替参赛报名、届次规则确认或正式数据审定。</p>`;
    $('#source-dialog').showModal();
  }
  function exportData() {
    const exported={meta:{...dataset.meta,dataMode:'统一视图',simulation:simulationData?.meta||null},filters:{kind:state.kind,search:state.search,coverage:state.coverage,feature:state.feature,material:state.material,matrix:state.matrix,scatter:state.scatter,flow:state.flow,building:state.building},buildings:current()};
    const blob=new Blob([JSON.stringify(exported,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='构谱-当前筛选建筑数据.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出当前匹配对象和筛选条件');
  }

  $('#total-count').textContent=records.length;$('#relation-count').textContent=relationCount;$('#feature-count').textContent=featureList.length;
  $('#graph-legend').innerHTML=KINDS.map(k=>`<span style="--color:${COLORS[k]}"><i></i>${k}</span>`).join('');
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('#list-button').addEventListener('click',()=>setView('catalog'));
  $('#search-input').addEventListener('input',e=>{state.search=e.target.value.trim();state.selected=null;render();});
  $('#coverage-filter').addEventListener('change',e=>{state.coverage=e.target.value;render();});
  $('#reset-button').addEventListener('click',()=>{reset();toast('筛选已重置，显示全部 '+records.length+' 个对象');});
  $('#names-button').addEventListener('click',()=>{state.names=!state.names;drawNetwork();$('#names-button').setAttribute('aria-pressed',state.names);$('#names-button').textContent=state.names?'收起名称':'显示名称';});
  $('#zoom-in').addEventListener('click',()=>setZoom(state.zoom+.25));
  $('#zoom-out').addEventListener('click',()=>setZoom(state.zoom-.25));
  $('#zoom-reset').addEventListener('click',()=>{state.zoom=1;state.rotation=0;state.pan={x:0,y:0};drawNetwork();toast('圆盘已复位：100%缩放，恢复初始角度');});
  $('#rotate-left').addEventListener('click',()=>{state.rotation-=25;applyTransform();});
  $('#rotate-right').addEventListener('click',()=>{state.rotation+=25;applyTransform();});
  $('#network').addEventListener('wheel',event=>{
    event.preventDefault();setZoom(state.zoom+(event.deltaY<0?.1:-.1),true);
  },{passive:false});
  function graphPoint(event) {
    const svg=$('#network'),point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    return point.matrixTransform(pointerStart?.matrix||svg.getScreenCTM().inverse());
  }
  $('#network').addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const p=graphPoint(event),cx=400+state.pan.x,cy=400+state.pan.y;
    pointerStart={x:event.clientX,y:event.clientY,point:p,matrix:$('#network').getScreenCTM().inverse(),pan:{...state.pan},rotation:state.rotation,angle:Math.atan2(p.y-cy,p.x-cx),radius:Math.hypot(p.x-cx,p.y-cy),id:event.pointerId,mode:event.shiftKey?'pan':'rotate'};moved=false;
  });
  window.addEventListener('pointermove',event=>{
    if(!pointerStart)return;
    const dx=event.clientX-pointerStart.x,dy=event.clientY-pointerStart.y;
    if(moved||Math.abs(dx)+Math.abs(dy)>6){
      if(!moved){
        moved=true;$('#network').setPointerCapture(pointerStart.id);$('#network').classList.add('dragging');
        $('#graph-tooltip').hidden=true;state.hovered=null;updateCenter();paintFocus();
      }
      const p=graphPoint(event);
      if(pointerStart.mode==='pan')state.pan={x:pointerStart.pan.x+p.x-pointerStart.point.x,y:pointerStart.pan.y+p.y-pointerStart.point.y};
      else if(pointerStart.radius<70)state.rotation=pointerStart.rotation+dx*.4;
      else{
        const angle=Math.atan2(p.y-400-state.pan.y,p.x-400-state.pan.x),delta=Math.atan2(Math.sin(angle-pointerStart.angle),Math.cos(angle-pointerStart.angle));
        state.rotation+=delta*180/Math.PI;pointerStart.angle=angle;
      }
      scheduleGraphTransform();
    }
  });
  function finishDrag() {
    if(pointerStart&&moved){cancelAnimationFrame(graphFrame);graphFrame=0;applyTransform();}
    if(pointerStart&&$('#network').hasPointerCapture(pointerStart.id))$('#network').releasePointerCapture(pointerStart.id);
    pointerStart=null;$('#network').classList.remove('dragging');
    if(moved)setTimeout(()=>moved=false,160);
  }
  window.addEventListener('pointerup',finishDrag);
  window.addEventListener('pointercancel',finishDrag);
  $('#drawer-scrim').addEventListener('click',closeDetail);
  $('#sources-button').addEventListener('click',openSources);
  $('#export-button').addEventListener('click',exportData);
  $('#mobile-sources').addEventListener('click',openSources);
  $('#mobile-export').addEventListener('click',exportData);
  $('#compare-open').addEventListener('click',openCompare);
  $('#compare-clear').addEventListener('click',()=>{state.compare=[];renderCompareTray();if(!$('#detail-drawer').hidden)$('#add-compare').textContent='加入比较';});
  document.querySelectorAll('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{
    const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();
  }));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!$('#detail-drawer').hidden){event.preventDefault();closeDetail();}
    if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')&&$('#detail-drawer').hidden){event.preventDefault();$('#search-input').focus();}
    if(event.key==='Tab'&&!$('#detail-drawer').hidden){
      const focusable=[...$('#detail-drawer').querySelectorAll('button,a[href],input,[tabindex="0"]')].filter(el=>!el.disabled&&!el.closest('[hidden]'));
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  document.addEventListener('click',event=>{
    const control=event.target.closest('button,[role="button"]');
    if(!control||control.disabled)return;
    control.classList.add('pressed-feedback');setTimeout(()=>control.classList.remove('pressed-feedback'),200);
  },true);
  render();
  let chartResizeFrame;
  const panelChartObserver=new ResizeObserver(()=>{
    cancelAnimationFrame(chartResizeFrame);
    chartResizeFrame=requestAnimationFrame(()=>{const list=current();renderShape(list);renderScale(list);});
  });
  panelChartObserver.observe($('#shape-chart'));panelChartObserver.observe($('#scale-chart'));
  // Read-only snapshot for reproducible local QA; no production controls are exposed.
  window.getAtlasRenderSnapshot=()=>({edgeCache:edgeRasterStatus,cacheVersion:edgeRasterVersion,pendingFrame:!!graphFrame});
  window.getAtlasSnapshot=()=>({dataMode:'统一视图',total:records.length,visible:current().length,relations:relationCount,features:featureList.length,simulatedFields:records.reduce((n,r)=>n+r.simulatedFields.length,0),filters:{kind:state.kind,coverage:state.coverage,feature:state.feature,material:state.material,matrix:state.matrix,scatter:state.scatter,building:state.building},view:state.view,compare:[...state.compare],selected:state.selected,rotation:state.rotation,zoom:state.zoom,pan:{...state.pan}});
})();
