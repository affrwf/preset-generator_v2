"""Resolve symbolic UI icons, including image_set grids, and crop DDS atlases."""
from __future__ import annotations
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import re
import xml.etree.ElementTree as ET
try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit('Image extraction needs Pillow: python -m pip install -r requirements.txt') from exc

def pair(value):
    result=tuple(round(float(v)) for v in value.split(','))
    if len(result)!=2:raise ValueError('Expected x,y pair')
    return result

def definitions(game):
    index=defaultdict(list)
    for path in sorted((game/'libs/config/ui').rglob('*.xml')):
        try:root=ET.parse(path).getroot()
        except (OSError,ET.ParseError):continue
        for el in root.iter('image'):
            if el.get('name') and el.get('file'):
                index[el.get('name').lower()].append({**el.attrib,'source':path.relative_to(game).as_posix()})
        for group in root.iter('image_set'):
            if not group.get('file'):continue
            sx,sy=float(group.get('size_x','0')),float(group.get('size_y','0'))
            for el in group.findall('image'):
                if not el.get('name') or not el.get('pos') or not sx or not sy:continue
                x,y=map(float,el.get('pos').split(','))
                index[el.get('name').lower()].append({'file':group.get('file'),'pos':f'{x*sx+float(group.get("offset_x",0))},{y*sy+float(group.get("offset_y",0))}','size':f'{sx},{sy}','source':path.relative_to(game).as_posix()})
    return index

def export_icons(game,other,out,catalog,workers):
    index=definitions(game)
    textures={p.relative_to(other).as_posix().lower():p for p in (other/'libs').rglob('*') if p.suffix.lower() in ('.dds','.png','.tif','.tga')}
    targets=defaultdict(list)
    def target(row,kind):
        icon=row.get('icon','').lower()
        if icon not in index and row.get('id','').lower() in index:icon=row['id'].lower()
        if icon:targets[icon].append((row,kind))
    for w in catalog['weapons']:
        target(w,'weapon')
        for skin in w['skins']:target(skin,'weapon')
    for row in catalog['attachments'].values():target(row,'module')
    for row in catalog['appearances']:target(row,'appearance')
    for row in catalog['armor']:target(row,'armor')
    # Choose the highest-resolution definition, with deterministic file ordering.
    tasks=defaultdict(list);missing=[]
    for icon,rows in sorted(targets.items()):
        candidates=[]
        for cfg in index.get(icon,[]):
            raw=cfg['file'].replace('\\','/').lstrip('/').lower()
            key=str(Path(raw).with_suffix('')).replace('\\','/')
            texture=next((textures.get(key+ext) for ext in ['.dds','.png','.tif','.tga'] if textures.get(key+ext)),None)
            if texture:
                try:
                    xy=pair(cfg.get('pos','0,0'));size=pair(cfg['size']) if cfg.get('size') else None
                    area=size[0]*size[1] if size else 0
                    candidates.append((area,str(texture),texture,cfg,xy,size))
                except (ValueError,KeyError):continue
        if not candidates:missing.append(icon);continue
        _,_,texture,cfg,xy,size=max(candidates,key=lambda c:(c[0],c[1],c[3]['source']))
        tasks[texture].append((icon,rows,cfg,xy,size))
    assets=out/'assets/icons';assets.mkdir(parents=True,exist_ok=True)
    manifest={};errors=[]
    def process(job):
        texture,items=job;results=[];failed=[]
        try:
            with Image.open(texture) as src: atlas=src.convert('RGBA')
        except (OSError,ValueError,NotImplementedError) as exc:
            return [],[{'texture':texture.relative_to(other).as_posix(),'error':str(exc)}]
        for icon,rows,cfg,(x,y),size in items:
            w,h=size or atlas.size
            if min(x,y)<0 or min(w,h)<=0 or x+w>atlas.width or y+h>atlas.height:
                failed.append({'icon':icon,'error':'Atlas rectangle outside texture'});continue
            im=atlas.crop((x,y,x+w,y+h))
            bounds=im.getchannel('A').getbbox()
            if not bounds:
                failed.append({'icon':icon,'error':'Empty alpha channel'});continue
            im=im.crop(bounds)
            kind=rows[0][1]
            im.thumbnail((420,168) if kind=='weapon' else (208,256) if kind=='appearance' else (200,160),Image.Resampling.LANCZOS)
            # Content-addressed icons avoid duplicate assets for identical UI symbols.
            digest=hashlib.sha256(im.tobytes()+str(im.size).encode()).hexdigest()[:20]
            dest=assets/(digest+'.webp')
            if not dest.exists():im.save(dest,format='WEBP',quality=86,method=4)
            rel=dest.relative_to(out).as_posix()
            results.append((icon,rows,rel,{'image':rel,'width':im.width,'height':im.height,'definition':cfg['source'],'texture':texture.relative_to(other).as_posix(),'rectangle':[x,y,w,h]}))
        return results,failed
    # DDS decoding can use substantial RAM: cap concurrent open atlases.
    with ThreadPoolExecutor(max_workers=min(4,workers)) as pool:
        for results,failed in pool.map(process,sorted(tasks.items(),key=lambda j:str(j[0]))):
            errors.extend(failed)
            for icon,rows,rel,info in results:
                manifest[icon]=info
                for row,_ in rows:row['image']=rel
    (out/'data').mkdir(parents=True,exist_ok=True)
    import json
    (out/'data/icon-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    return {'requested':len(targets),'exported':len(manifest),'missing':missing,'errors':errors,
            'bytes':sum(p.stat().st_size for p in assets.glob('*.webp'))}

