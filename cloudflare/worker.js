async function readBundle(env){
  const {results}=await env.DB.prepare('SELECT collection,item_key,payload FROM goupu_entries WHERE revision = ? ORDER BY collection,ord,item_key').bind(env.DATA_REVISION).all();
  const rows=results.map(row=>({...row,value:JSON.parse(row.payload)}));
  const config=rows.find(row=>row.collection==='config'&&row.item_key==='bundle')?.value;
  const buildings=rows.filter(row=>row.collection==='building').map(row=>row.value);
  const records=rows.filter(row=>row.collection==='supplement').map(row=>row.value);
  if(!config||buildings.length!==config.counts.buildings||records.length!==config.counts.records)throw new Error('数据版本不完整。');
  const ids=new Set(buildings.map(record=>record.id));
  if(ids.size!==buildings.length||records.some(record=>!ids.has(record.id)))throw new Error('资料对象不一致。');
  return {atlas:{...config.atlas,buildings},supplement:{...config.supplement,records},revision:env.DATA_REVISION};
}

export default {
  async fetch(request,env){
    const pathname=new URL(request.url).pathname;
    if(['/api/bootstrap','/api/health','/data.json','/simulation.json'].includes(pathname)){
      if(request.method!=='GET'&&request.method!=='HEAD')return Response.json({error:'此接口只提供读取。'},{status:405,headers:{Allow:'GET, HEAD'}});
      try{
        const bundle=await readBundle(env);
        const value=pathname==='/data.json'?bundle.atlas:pathname==='/simulation.json'?bundle.supplement:pathname==='/api/health'?{status:'ok',revision:bundle.revision,buildings:bundle.atlas.buildings.length,records:bundle.supplement.records.length}:bundle;
        return new Response(request.method==='HEAD'?null:JSON.stringify(value),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      }catch(error){
        console.error('goupu data read failed:',error.message);
        return Response.json({error:'资料暂时无法加载，请稍后刷新。'},{status:503,headers:{'Cache-Control':'no-store'}});
      }
    }
    if(pathname.startsWith('/api/'))return Response.json({error:'接口不存在。'},{status:404});
    return env.ASSETS.fetch(request);
  }
};
