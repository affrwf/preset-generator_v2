export async function loadCatalog(url,fetcher=fetch){
  async function read(path){
    const response=await fetcher(path);
    if(!response.ok)throw Error('Каталог недоступен: HTTP '+response.status);
    return response.json();
  }
  const catalog=await read(url);
  if(!catalog.datasets)return catalog;
  const jobs=Object.entries(catalog.datasets).flatMap(([kind,paths])=>paths.map((path,index)=>({kind,index,url:new URL(path,url)})));
  const results=new Map();
  let next=0;
  async function worker(){
    while(next<jobs.length){
      const job=jobs[next++],rows=await read(job.url);
      if(!Array.isArray(rows))throw Error('Повреждён файл каталога.');
      results.set(job.kind+':'+job.index,rows);
    }
  }
  await Promise.all(Array.from({length:Math.min(6,jobs.length)},worker));
  for(const [kind,paths] of Object.entries(catalog.datasets)){
    const rows=paths.flatMap((_,index)=>results.get(kind+':'+index));
    catalog[kind]=kind==='attachments'?Object.fromEntries(rows.map(row=>[row.id,row])):rows;
  }
  return catalog;
}

