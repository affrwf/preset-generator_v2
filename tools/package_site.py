"""Assemble a Pages artifact with only referenced website resources."""
from pathlib import Path
import json
import shutil
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'_site'
# _site is generated output, never a source directory.
assert OUT.resolve().parent==ROOT.resolve() and OUT.name=='_site'
if OUT.exists():shutil.rmtree(OUT)
OUT.mkdir()
shutil.copytree(ROOT/'src',OUT/'src')
catalog=json.loads((ROOT/'data/catalog.json').read_text(encoding='utf-8'))
parts=[]
if catalog.get('datasets'):
    for kind,paths in catalog['datasets'].items():
        values=[]
        for name in paths:
            values+=json.loads((ROOT/'data'/name).read_text(encoding='utf-8'));parts.append(name)
        catalog[kind]=dict((row['id'],row) for row in values) if kind=='attachments' else values
rows=[*catalog['weapons'],*catalog['attachments'].values(),*catalog['appearances'],*catalog['armor'],
      *[s for w in catalog['weapons'] for s in w['skins']]]
for name in sorted(set(row['image'] for row in rows if row.get('image'))):
    source=(ROOT/name).resolve()
    if not source.is_relative_to((ROOT/'assets').resolve()):raise ValueError('Icon path outside assets')
    target=OUT/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
(OUT/'data').mkdir()
shutil.copy2(ROOT/'data/catalog.json',OUT/'data/catalog.json')
for name in parts:
    target=OUT/'data'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/'data'/name,target)
shutil.copy2(ROOT/'index.html',OUT/'index.html')
(OUT/'.nojekyll').touch()
print(f'Pages site: {sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())/1024/1024:.1f} MiB')

