"""Pack cropped icons into bounded browser atlases."""
from PIL import Image
import hashlib
import io
import json
import math
from parser.parts import write_icon_manifest

def pack_catalog_images(catalog,out):
    rows=sorted(catalog['weapons'],key=lambda w:(not bool(w.get('meta')),bool(w.get('variant')),w['id']))
    rows+=list(catalog['attachments'].values())
    for w in catalog['weapons']:rows+=w['skins']
    rows+=catalog['appearances']+catalog['armor']
    unique=list(dict.fromkeys(r['image'] for r in rows if r.get('image')))
    folder=out/'assets/atlases';folder.mkdir(parents=True,exist_ok=True)
    mapping={};used=set();total=0;count=0
    tile_w,tile_h,cols,batch_size=432,272,8,24
    def pack(chunk):
        nonlocal total,count
        atlas=Image.new('RGBA',(tile_w*min(cols,len(chunk)),tile_h*math.ceil(len(chunk)/cols)),(0,0,0,0))
        regions={}
        for i,name in enumerate(chunk):
            with Image.open(out/name) as source:im=source.convert('RGBA')
            x=(i%cols)*tile_w;y=(i//cols)*tile_h;atlas.alpha_composite(im,(x,y))
            regions[name]={'x':x,'y':y,'width':im.width,'height':im.height,'atlasWidth':atlas.width,'atlasHeight':atlas.height}
        encoded=io.BytesIO();atlas.save(encoded,format='WEBP',quality=88,method=4)
        payload=encoded.getvalue()
        if len(payload)>390000 and len(chunk)>1:
            mid=len(chunk)//2;pack(chunk[:mid]);pack(chunk[mid:]);return
        digest=hashlib.sha256(payload).hexdigest()[:20];path=folder/(digest+'.webp')
        if not path.exists():path.write_bytes(payload)
        rel=path.relative_to(out).as_posix();used.add(path.resolve());count+=1;total+=len(payload)
        for name,region in regions.items():mapping[name]=(rel,region)
    for start in range(0,len(unique),batch_size):pack(unique[start:start+batch_size])
    for row in rows:
        if row.get('image'):row['image'],row['imageRegion']=mapping[row['image']]
    manifest_path=out/'data/icon-manifest.json'
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    for entry in manifest.values():
        old=entry['image']
        if old in mapping:entry['crop']=old;entry['image'],entry['imageRegion']=mapping[old]
    write_icon_manifest(manifest,out/'data')
    verified=folder.resolve()
    assert verified.parent==out.resolve()/'assets'
    for p in folder.glob('*.webp'):
        if p.resolve().parent==verified and p.resolve() not in used:p.unlink()
    return {'files':count,'bytes':total,'icons':len(unique)}

