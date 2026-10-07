import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../site/dist');
const port=Number(process.env.ATLAS_PORT||4173);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const requestPath=decodeURIComponent(url.pathname);
    const target=path.resolve(root,'.'+(requestPath==='/'?'/index.html':requestPath));
    if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
    if(!(await stat(target)).isFile()){res.writeHead(404);res.end('Not found');return;}
    const body=await readFile(target);
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(body);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:500);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`构·谱 local preview: http://127.0.0.1:${port}`));
server.on('error',e=>{console.error(e.message);process.exit(1);});
