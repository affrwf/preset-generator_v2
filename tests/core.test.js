import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {emptyPreset,selection,addWeapon,generateLua,randomPreset,errorsForPreset,validateImport} from '../src/core.js';
import {loadCatalog} from '../src/catalog.js';
const catalog=await loadCatalog(new URL('../data/catalog.json',import.meta.url),async url=>({ok:true,json:async()=>JSON.parse(readFileSync(url,'utf8').replace(/^\uFEFF/,''))}));
test('build and all tier-list IDs are real, class-compatible items',()=>{
  assert.equal(catalog.schemaVersion,1);assert.ok(catalog.build);
  for(const [cls,rows] of Object.entries(catalog.meta)){
    assert.ok(rows.length>=20);
    for(const row of rows)for(const id of row.ids){
      const w=catalog.weapons.find(w=>w.id===id);assert.ok(w,id);assert.ok(w.classes.includes(cls));assert.equal(w.meta.tier,row.tier);
    }
  }
});
test('random presets are valid for every class and every meta threshold',()=>{
  for(const cls of ['R','M','E','S'])for(const tier of [null,'S','A','B','C','D'])for(let n=0;n<16;n++){
    const p=randomPreset(catalog,cls,{tier},()=>n/16);
    assert.deepEqual(errorsForPreset(p,catalog),[]);
    const w=catalog.weapons.find(w=>w.id===p.items[0].id);
    assert.ok(w.classes.includes(cls));if(tier)assert.ok(w.meta);
    assert.ok(generateLua(p,catalog).endsWith('return inventory\n'));
  }
});
test('a new primary replaces the old primary, preserving the pistol',()=>{
  const p=emptyPreset(catalog),ar60=catalog.weapons.find(w=>w.id==='ar60'),ar65=catalog.weapons.find(w=>w.id==='ar65'),pt=catalog.weapons.find(w=>w.id==='pt33');
  addWeapon(p,ar60,catalog);addWeapon(p,pt,catalog);addWeapon(p,ar65,catalog);
  assert.deepEqual(new Set(p.items.map(i=>i.id)),new Set(['pt33','ar65']));assert.deepEqual(errorsForPreset(p,catalog),[]);
});
test('only one chosen module per socket is exported; no perk/helper placeholders',()=>{
  const w=catalog.weapons.find(w=>w.id==='ar60'),p=emptyPreset(catalog);
  p.items=[selection(w)];
  const muzzle=w.sockets.find(s=>s.id==='muzzle');assert.ok(muzzle.options.length>1);
  p.items[0].sockets.muzzle=muzzle.options.at(-1);
  const lua=generateLua(p,catalog);
  assert.ok(lua.includes(muzzle.options.at(-1)));
  for(const id of muzzle.options.slice(0,-1))assert.ok(!lua.includes('name = "'+id+'"'));
  assert.ok(!lua.includes('name = "perk_a"'));assert.ok(!lua.includes('muzzle_flash'));
  p.items[0].sockets.muzzle='unrelated_scope';assert.throws(()=>generateLua(p,catalog),/модуль/);
});
test('ammo is deduplicated and stable heads do not change while editing',()=>{
  const p=emptyPreset(catalog);p.items=[selection(catalog.weapons.find(w=>w.id==='ar60'))];
  const lua=generateLua(p,catalog);assert.equal(lua,generateLua(p,catalog));assert.ok(!lua.includes('\\nlocal inventory'));
  p.ammoAmount=-1;assert.throws(()=>generateLua(p,catalog),/Боезапас/);
});
test('range includes real number from a base ID; no matches does not generate a half preset',()=>{
  const p=randomPreset(catalog,'R',{min:{ar:65,mg:999},max:{ar:65}});
  assert.equal(p.items[0].id,'ar65');
  assert.throws(()=>randomPreset(catalog,'R',{min:{ar:999,mg:999}}),/Нет основного/);
});
test('import validates class, skins and modules before replacing state',()=>{
  const p=randomPreset(catalog,'E',{tier:'S'},()=>0);assert.deepEqual(validateImport(JSON.parse(JSON.stringify(p)),catalog),p);
  const bad=structuredClone(p);bad.items[0].skin='not_a_skin';assert.throws(()=>validateImport(bad,catalog),/камуфляж/);
  bad.items[0].skin=p.items[0].skin;bad.classId='M';assert.throws(()=>validateImport(bad,catalog),/класс|классу/);
});
test('all referenced images exist and all socket options resolve',()=>{
  const rows=[...catalog.weapons,...Object.values(catalog.attachments),...catalog.appearances,...catalog.armor,...catalog.weapons.flatMap(w=>w.skins)];
  for(const row of rows)if(row.image)assert.ok(existsSync(new URL('../'+row.image,import.meta.url)),row.image);
  for(const w of catalog.weapons)for(const s of w.sockets)for(const id of s.options)assert.ok(catalog.attachments[id],id);
});


test('cosmetic sockets are exported only for their bound material',()=>{
 const c=structuredClone(catalog),w=c.weapons.find(w=>w.id==='ar60');
 const socket=w.sockets.find(s=>s.id==='muzzle');socket.skins=['bf24'];
 const p=emptyPreset(c);p.items=[selection(w)];
 for(const id of socket.options)assert.ok(!generateLua(p,c).includes('name = "'+id+'"'));
 p.items[0].skin='bf24';assert.ok(generateLua(p,c).includes('name = "'+socket.default+'"'));
});
