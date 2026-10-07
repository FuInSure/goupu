import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=JSON.parse(await readFile(path.join(root,'site/dist/data.json'),'utf8'));
const sim=JSON.parse(await readFile(path.join(root,'site/dist/simulation.json'),'utf8'));
const byId=new Map(base.buildings.map(r=>[r.id,r]));
const forbidden=new Set(['source','sourceName','sourceStatus','auxSource','period','periods','dateBasis','events','gaps','name','kind','id','summary']);
assert.equal(sim.records.length,base.buildings.length);
let count=0;
for(const item of sim.records){
  const raw=byId.get(item.id);assert.ok(raw);assert.equal(item.status,'模拟估算');assert.ok(item.method.includes('未进行测绘'));
  for(const [field,v] of Object.entries(item.values)){
    assert.ok(!forbidden.has(field),'Forbidden simulation field: '+field);
    assert.ok(raw[field]==null,'A recorded field was overwritten: '+raw.name+' '+field);
    assert.ok(item.fieldStatus[field].includes('模拟'));
    if(typeof v==='number')assert.ok(Number.isFinite(v)&&v>0);
    count++;
  }
  if(raw.kind==='桥梁'){
    assert.ok(!('bays' in item.values));assert.ok(!('depth' in item.values));
    const form=item.values.form||raw.form||'';
    if(!/廊桥/.test(form))assert.ok(!('roof' in item.values),'Open bridge received a house roof');
  }else assert.ok(!('span' in item.values));
}
assert.equal(count,Object.values(sim.meta.counts).reduce((a,b)=>a+b,0));
const payload=await readFile(path.join(root,'site/dist/simulation.js'),'utf8');
assert.deepEqual(JSON.parse(payload.replace(/^window\.ATLAS_SIMULATION = /,'').replace(/;\s*$/,'')),sim);
console.log('PASS simulation layer: '+count+' individually marked fields; no factual fields, sources, dates or gaps overwritten');
