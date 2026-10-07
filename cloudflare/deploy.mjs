import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cli=path.join(root,'node_modules/wrangler/bin/wrangler.js');
const local=process.argv.includes('--local');
const config=JSON.parse(await readFile(path.join(root,'wrangler.jsonc'),'utf8'));
if(config.name!=='goupu'||config.d1_databases?.[0]?.database_name!=='goupu-db'||config.vars.DATA_REVISION==='build-required')throw new Error('请先生成goupu部署文件。');
async function run(args){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,...args],{cwd:root,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Wrangler退出：'+code)));});}
await run(['d1','execute','goupu-db',local?'--local':'--remote','--file=cloudflare/import.sql','--yes']);
if(!local)await run(['deploy']);
