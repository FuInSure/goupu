import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'public'),source=path.join(root,'site/dist');
const atlas=JSON.parse(await readFile(path.join(source,'data.json'),'utf8'));
const supplement=JSON.parse(await readFile(path.join(source,'simulation.json'),'utf8'));
const ids=new Set(atlas.buildings.map(record=>record.id));
if(ids.size!==atlas.buildings.length||supplement.records.some(record=>!ids.has(record.id)))throw new Error('对象标识重复或补充字段缺少对应对象。');
const revision=createHash('sha256').update(JSON.stringify({atlas,supplement})).digest('hex').slice(0,24);
const {buildings,...atlasConfig}=atlas,{records,...supplementConfig}=supplement;
const entries=[
  ['config','bundle',0,{atlas:atlasConfig,supplement:supplementConfig,counts:{buildings:buildings.length,records:records.length}}],
  ...buildings.map((record,index)=>['building',record.id,index,record]),
  ...records.map((record,index)=>['supplement',record.id,index,record])
];
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const sql=[`CREATE TABLE IF NOT EXISTS goupu_entries (
  revision TEXT NOT NULL,
  collection TEXT NOT NULL,
  item_key TEXT NOT NULL,
  ord INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (revision, collection, item_key)
);`];
for(const [collection,key,order,value] of entries){
  const statement=`INSERT INTO goupu_entries(revision,collection,item_key,ord,payload) VALUES(${quote(revision)},${quote(collection)},${quote(key)},${order},${quote(JSON.stringify(value))}) ON CONFLICT(revision,collection,item_key) DO UPDATE SET ord=excluded.ord,payload=excluded.payload;`;
  if(Buffer.byteLength(statement,'utf8')>100000)throw new Error('D1单条资料超过SQL限制：'+key);
  sql.push(statement);
}
await mkdir(out,{recursive:true});
await writeFile(path.join(root,'cloudflare/import.sql'),sql.join('\n'),'utf8');
for(const file of ['styles.css','app.js','favicon.svg'])await copyFile(path.join(source,file),path.join(out,file));
let html=await readFile(path.join(source,'index.html'),'utf8');
let removed=0;
html=html.replace(/<script\b[^>]*src="(?:data|simulation|app)\.js"[^>]*><\/script>/g,()=>{removed++;return '';});
if(removed!==3)throw new Error('未找到离线页面的数据和交互脚本入口，停止构建。');
html=html.replace('</head>','<script defer src="/bootstrap.js"></script></head>');
await writeFile(path.join(out,'index.html'),html,'utf8');
await copyFile(path.join(root,'cloudflare/bootstrap.js'),path.join(out,'bootstrap.js'));
await copyFile(path.join(root,'cloudflare/headers'),path.join(out,'_headers'));
const configPath=path.join(root,'wrangler.jsonc');
const config=JSON.parse(await readFile(configPath,'utf8'));
config.vars={...config.vars,DATA_REVISION:revision};
await writeFile(configPath,JSON.stringify(config,null,2)+'\n','utf8');
console.log(JSON.stringify({revision,buildings:buildings.length,supplement:records.length,d1Rows:entries.length,assets:6}));
