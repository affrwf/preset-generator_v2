"""Deterministic, bounded generated JSON files for static hosting."""
import json
from pathlib import Path
def encode(value):return json.dumps(value,ensure_ascii=False,separators=(',',':'))
def split_records(rows,limit=220000):
    result=[];chunk=[];size=2
    for row in rows:
        n=len(encode(row).encode('utf-8'))+1
        if chunk and size+n>limit:result.append(chunk);chunk=[];size=2
        chunk.append(row);size+=n
    if chunk:result.append(chunk)
    return result
def write_catalog(catalog,data):
    folder=data/'catalog-parts';folder.mkdir(parents=True,exist_ok=True)
    manifest={k:v for k,v in catalog.items() if k not in ('weapons','attachments','appearances','armor')}
    manifest['datasets']={};used=set()
    for kind in ['weapons','attachments','appearances','armor']:
        value=catalog[kind]
        rows=list(value.values()) if isinstance(value,dict) else value
        manifest['datasets'][kind]=[]
        for i,chunk in enumerate(split_records(rows)):
            name=f'{kind}-{i:03d}.json';path=folder/name;used.add(path.resolve())
            path.write_text(encode(chunk),encoding='utf-8');manifest['datasets'][kind].append('catalog-parts/'+name)
    assert folder.resolve().parent==data.resolve()
    for p in folder.glob('*.json'):
        if p.resolve() not in used and p.resolve().parent==folder.resolve():p.unlink()
    (data/'catalog.json').write_text(encode(manifest),encoding='utf-8')
def write_icon_manifest(manifest,data):
    folder=data/'icon-manifests';folder.mkdir(parents=True,exist_ok=True)
    names=[]
    for i,rows in enumerate(split_records([{'icon':k,**v} for k,v in sorted(manifest.items())])):
        name=f'icons-{i:03d}.json';(folder/name).write_text(encode(rows),encoding='utf-8');names.append('icon-manifests/'+name)
    (data/'icon-manifest.json').write_text(encode({'parts':names,'icons':len(manifest)}),encoding='utf-8')

