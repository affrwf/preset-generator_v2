"""Read extracted Warface client resources. No game files are modified."""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from parser.icons import export_icons
from parser.sprites import pack_catalog_images
from parser.parts import write_catalog

SCHEMA = 1
CLASSES = {'ar':'R','arl':'R','mg':'R','ap':'R','shg':'M','mk':'M','df':'M','smg':'E','ak':'E','sr':'S'}
KNOWN_CATEGORIES = {'ar','arl','mg','shg','smg','sr','pt','kn','fg','sg','fl','gg','cm','ap','ak','mk','df','rg','gl','hmg'}
PRIMARY = {'ar','arl','mg','shg','smg','sr'}
INTERNAL = re.compile(r'(^|_)(ai|lms|console|tutor|tutorial|test|teamgungame|powerup|zombiemod|npc|igr)(_|$)',re.I)

def params(root, section):
    return {p.get('name'):p.get('value','') for p in root.findall(f'./{section}/param') if p.get('name')}

def number(value):
    try:
        n=float(value)
        return int(n) if n.is_integer() else n
    except (ValueError,TypeError): return value

def plain(value):
    return re.sub(r'<[^>]*>','',value or '').replace('\\n','\n').strip()

def read_xml(path):
    try: return path, ET.parse(path).getroot(), None
    except (ET.ParseError,OSError) as exc: return path,None,str(exc)

def load_localization(root,report):
    values={}
    for p in sorted((root/'languages').glob('*.xml')):
        _,doc,error=read_xml(p)
        if error:
            report['parseErrors'].append({'file':'Russian/'+p.name,'error':error});continue
        for e in doc.findall('./entry'):
            key=e.get('key','').lower()
            translation=e.find('translation')
            original=e.find('original')
            text=translation.get('value','') if translation is not None else ''
            if not text and original is not None:text=original.get('value','')
            if key in values and values[key]!=text:report['duplicateLocalizationKeys'].append(key)
            values[key]=text
    return values

def make_catalog(game, russian, build, workers, meta_path):
    report={'parseErrors':[],'duplicateLocalizationKeys':[],'duplicateItems':[], 'unresolvedSockets':[], 'missingLocalization':[], 'missingArchetypes':[], 'skipped':Counter()}
    loc=load_localization(russian,report)
    resolve=lambda ref:plain(loc.get((ref or '').lstrip('@').lower(), ref if not (ref or '').startswith('@') else ''))
    folders=['weapons','accessories','skins','armor','ammo']
    paths=sorted(p for folder in folders for p in (game/'items'/folder).rglob('*.xml'))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        loaded=list(pool.map(read_xml,paths))
    index={};by_path={};wrappers=defaultdict(list);skin_wrappers=defaultdict(list);materials={}
    for path,root,error in loaded:
        relative=path.relative_to(game).as_posix()
        if error:report['parseErrors'].append({'file':relative,'error':error});continue
        by_path[relative.lower()]=(root,relative)
        name=root.get('name','')
        if not name:continue
        if name in index:
            report['duplicateItems'].append({'id':name,'file':relative})
            continue
        index[name]=(root,relative)
        if root.tag=='shop_item':
            if root.get('type')=='weapon_skin':
                material=params(root,'skin').get('material','')
                base=re.match(r'^[a-z]+\d+',name,re.I)
                if material and base:materials[(base.group(),material)]=(root,relative)
            for c in root.findall('./content/item'):
                wrappers[c.get('name')].append((root,relative))
                if root.get('type')=='weapon_skin':
                    skin_wrappers[c.get('name')].append((root,relative,c))
    def display(root, fallback_id, extra=None):
        ui=params(root,'UI_stats')
        key=ui.get('name','')
        title=resolve(key)
        if not title and extra is not None:
            ui={**params(extra,'UI_stats'),**ui};title=resolve(ui.get('name',''))
        if not title:
            for k in [fallback_id+'_name',fallback_id+'_shop_name',fallback_id+'_default_name']:
                title=resolve('@'+k)
                if title:break
        if not title:
            title=fallback_id
            report['missingLocalization'].append({'id':fallback_id,'key':ui.get('name','')})
        icon=ui.get('icon','')
        el=root.find('./icons/ui_icon')
        if not icon and extra is not None:icon=params(extra,'UI_stats').get('icon','')
        if not icon and el is not None:icon=el.get('name','')
        return {'id':fallback_id,'name':fallback_id,'title':title,'description':resolve(ui.get('description','')),
                'icon':icon or fallback_id,'image':None,'rarity':ui.get('rarity',''),
                'nameKey':ui.get('name','').lstrip('@')}
    def classes(root,cat='',extra=None):
        value=params(root,'mmo_stats').get('classes','')
        if not value and extra is not None:value=params(extra,'mmo_stats').get('classes','')
        return ''.join(c for c in 'RMESH' if c in value) or CLASSES.get(cat,'RMES')
    def settings(root,path,seen=None):
        seen=set() if seen is None else seen
        element=root if root.tag=='settings' else root.find('settings')
        if element is None:return {}
        inherited={}
        ref=element.get('archetype','').replace('\\','/').lower()
        if ref and ref not in seen:
            if ref in by_path:
                parent,pp=by_path[ref];inherited=settings(parent,pp,seen|{ref})
            else: report['missingArchetypes'].append({'file':path,'reference':ref})
        return {**inherited,**{p.get('name'):number(p.get('value')) for p in element.findall('param') if p.get('name')}}
    attachments={}
    for iid,(root,path) in index.items():
        if root.tag!='item' or root.get('type')!='attachment':continue
        if path.startswith('items/accessories/perks/'):continue
        row=display(root,iid)
        row.update(source=path,classes=classes(root),settings=settings(root,path),
                   helpers=[dict(t.attrib) for t in root.findall('./types/type')],
                   additionalScopes=[s.get('name') for s in root.findall('./additional_scopes/scope')])
        attachments[iid]=row
    weapons=[]
    for iid,(root,path) in index.items():
        if root.tag!='item' or not path.startswith('items/weapons/'):continue
        # AI and archetype subdirectories are retained in the report, not player inventory.
        if Path(path).parent.as_posix()!='items/weapons':
            report['skipped']['weaponSubdirectory']+=1;continue
        m=re.match(r'^([a-z]+)(\d+)',iid,re.I)
        if not m or m.group(1).lower() not in KNOWN_CATEGORIES:
            report['skipped']['nonInventoryWeapon']+=1;continue
        cat=m.group(1).lower()
        shops=sorted((p for p in wrappers.get(iid,[]) if p[0].get('type')=='weapon'),
                     key=lambda pair:(pair[0].get('name')!=iid+'_shop',pair[1]))
        shop=shops[0][0] if shops else None
        row=display(root,iid,shop)
        ui=params(shop,'UI_stats') if shop is not None else {}
        sockets=[];fixed=[]
        skin_socket_names=defaultdict(list)
        for material in root.findall('./skins/material'):
            for attach in material.findall('attach'):
                if attach.get('socket'):skin_socket_names[attach.get('socket')].append(material.get('name'))
        for n,s in enumerate(root.findall('./sockets/socket')):
            sid=s.get('name',f'socket_{n}')
            if sid.startswith(('perk','sticker')) or sid in ('effects','charm'):continue
            options=[]
            for support in s.findall('support'):
                aid=support.get('name','')
                if aid in attachments:options.append(aid)
                elif sid not in ('mount',):
                    report['unresolvedSockets'].append({'weapon':iid,'socket':sid,'id':aid})
            options=list(dict.fromkeys(options))
            if not options:continue
            selected=next((p.get('name') for p in s.findall('support') if p.get('default')=='1' and p.get('name') in options),None)
            optional=s.get('can_be_empty','1')!='0'
            if not selected and not optional:selected=options[0]
            socket={'id':sid,'optional':optional,'options':options,'default':selected}
            if sid in skin_socket_names:socket['skins']=skin_socket_names[sid]
            if not s.get('ui_helper') and sid not in ('mount','scope','additionalscope','muzzle','underbarrel','grenadelauncher','bipod'):
                socket['hidden']=True
                socket['skins']=skin_socket_names.get(sid,[])
            if sid=='mount':fixed.extend(options[:1])
            else:sockets.append(socket)
        skin_items={}
        for skinroot,sp,content in skin_wrappers.get(iid,[]):
            material=content.get('skin','') or params(skinroot,'mmo_stats').get('skin','')
            if material:skin_items[material]=(skinroot,sp)
        skins=[]
        for material in root.findall('./skins/material'):
            sid=material.get('name','')
            if not sid:continue
            base=re.match(r'^[a-z]+\d+',iid,re.I).group()
            skinroot,sp=skin_items.get(sid,materials.get((base,sid),(None,None)))
            if skinroot is None:
                # Cosmetic IDs are resolved from real wrappers, never from a guessed display title.
                for candidate in [sid,iid+'_'+sid+'skin_shop',base+'_'+sid+'skin_shop',base+'_'+sid+'_skin',base+'_'+sid+'_skin_shop']:
                    if candidate in index:skinroot,sp=index[candidate];break
            skin=display(skinroot,iid+'_'+sid) if skinroot is not None else {'id':sid,'name':sid,'title':'Базовый' if sid=='default' else 'Золотой' if sid=='gold01' else resolve('@'+sid) or sid,'icon':row['icon'] if sid=='default' else base+'_'+sid,'image':None}
            skin.update(id=sid)
            if sp:skin['source']=sp
            skins.append(skin)
        stats=settings(root,path)
        ammo=list(dict.fromkeys(p.get('value') for p in root.findall('./fireparams/fire/param') if p.get('name')=='ammo_type' and p.get('value')))
        row.update(category=cat,number=int(m.group(2)),classes=classes(root,cat,shop),source=path,
                   shopId=shop.get('name') if shop is not None else None,
                   baseId=re.match(r'^[a-z]+\d+',iid,re.I).group(),variant='_' in iid,
                   internal=bool(INTERNAL.search(iid)) or row['title']==iid or bool(re.fullmatch(r'(TBD|Пистолет \d+|Пулемет \d+|Снайперская винтовка \d+)',row['title'],re.I)),slot='primary' if cat in PRIMARY else 'secondary' if cat=='pt' else 'melee' if cat=='kn' else iid,
                   ammoTypes=ammo,ammoType=ammo[0] if ammo else '',settings=stats,
                   sockets=sockets,fixedAttachments=fixed,attachments=list(dict.fromkeys(a for s in sockets for a in s['options'])),
                   skins=skins)
        weapons.append(row)
    appearances=[];armor=[]
    for iid,(root,path) in index.items():
        if root.tag!='GameItem':continue
        if not (path.startswith('items/skins/') or path.startswith('items/armor/')):continue
        row=display(root,iid)
        slot=root.find("./slots/slot[@main='1']")
        if slot is None:slot=root.find('./slots/slot')
        row.update(source=path,classes=classes(root),slot=slot.get('name','armor') if slot is not None else 'armor',internal=bool(INTERNAL.search(iid)))
        (appearances if path.startswith('items/skins/') else armor).append(row)
    heads=[iid for iid in index if re.fullmatch(r'default_head_\d+',iid)]
    # Head definitions live in characterparts, separate from appearances.
    for p in sorted((game/'items/characterparts').glob('default_head_*.xml')):
        _,r,e=read_xml(p)
        if not e and r.get('name'):heads.append(r.get('name'))
    meta=json.loads(meta_path.read_text(encoding='utf-8')) if meta_path.exists() else {}
    weapon_index={w['id']:w for w in weapons}
    for cls,entries in meta.items():
        for vote in entries:
            for iid in vote['ids']:
                if iid not in weapon_index:raise ValueError(f"Meta item not found in build {build}: {iid}")
                w=weapon_index[iid]
                if cls not in w['classes']:raise ValueError(f'Meta class mismatch: {cls}/{iid}')
                w['meta']={'tier':vote['tier'],'score':vote['score'],'title':vote['title']}
    report['scannedFiles']=len(paths)
    report['skipped']=dict(report['skipped'])
    catalog={'schemaVersion':SCHEMA,'build':str(build),
             'weapons':sorted(weapons,key=lambda r:(r['category'],r['number'],r['id'])),
             'attachments':attachments,'appearances':sorted(appearances,key=lambda r:r['id']),
             'armor':sorted(armor,key=lambda r:r['id']),'heads':sorted(set(heads)),
             'meta':meta}
    return catalog,report

def archive_settings(catalog,out):
    # Keep complete scalar parameters for inspection without downloading them all at startup.
    folder=out/'data/settings';folder.mkdir(parents=True,exist_ok=True)
    groups=defaultdict(dict)
    for w in catalog['weapons']:
        groups[w['category']][w['id']]=w['settings']
        w['settings']={k:v for k,v in w['settings'].items() if k in ('damage','damage_min','rpm','ammo_amount','damage_drop_min_distance','damage_drop_per_meter','reload_duration','zoom_in_duration')}
    for category,rows in groups.items():
        (folder/(category+'.json')).write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    catalog['settingsFiles']={category:'data/settings/'+category+'.json' for category in groups}

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--build',default='729')
    ap.add_argument('--source-root',type=Path,help='Directory with GameData BUILD, Other BUILD, Russian BUILD')
    ap.add_argument('--gamedata',type=Path);ap.add_argument('--other',type=Path);ap.add_argument('--russian',type=Path)
    ap.add_argument('--output',type=Path,default=Path(__file__).resolve().parent)
    ap.add_argument('--workers',type=int,default=16)
    ap.add_argument('--no-images',action='store_true')
    ap.add_argument('--strict',action='store_true',help='Fail if any XML cannot be parsed')
    args=ap.parse_args()
    source=args.source_root or Path.home()/'Desktop/BSW'
    game=args.gamedata or source/f'GameData {args.build}'
    other=args.other or source/f'Other {args.build}'
    russian=args.russian or source/f'Russian {args.build}'
    for p in [game,russian]+([] if args.no_images else [other]):
        if not p.is_dir():ap.error(f'Directory not found: {p}')
    print(f'Parsing build {args.build}...',flush=True)
    catalog,report=make_catalog(game,russian,args.build,max(1,args.workers),Path(__file__).parent/'config/meta.json')
    print(f"Read {report['scannedFiles']} configs; weapons: {len(catalog['weapons'])}; attachments: {len(catalog['attachments'])}",flush=True)
    if args.strict and report['parseErrors']:raise ValueError(f"{len(report['parseErrors'])} malformed XML files; run without --strict to inspect the report")
    args.output.mkdir(parents=True,exist_ok=True)
    if not args.no_images:
        print('Cropping UI atlases...',flush=True)
        report['images']=export_icons(game,other,args.output,catalog,max(1,args.workers))
        report['sprites']=pack_catalog_images(catalog,args.output)
    archive_settings(catalog,args.output)
    data=args.output/'data';data.mkdir(parents=True,exist_ok=True)
    # Publish only a small, static client catalog; original game XML stays local.
    write_catalog(catalog,data)
    for file,value in [('build-report.json',report),
                       ('all_weapons.json',[{**{k:w[k] for k in ['name','id','title','category','classes','ammoType','attachments','image']},**({'imageRegion':w['imageRegion']} if 'imageRegion' in w else {}),'skins':[s['id'] for s in w['skins']]} for w in catalog['weapons']]),
                       ('all_skins.json',catalog['appearances'])]:
        tmp=data/(file+'.tmp')
        tmp.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8');tmp.replace(data/file)
    print(json.dumps({'build':args.build,'weapons':len(catalog['weapons']),'modules':len(catalog['attachments']),
                      'appearances':len(catalog['appearances']),'armor':len(catalog['armor']),'parseErrors':len(report['parseErrors']),
                      'images':report.get('images',{}).get('exported',0)},ensure_ascii=False),flush=True)
if __name__=='__main__':main()

