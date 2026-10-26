export const CLASS_NAMES={R:'Штурмовик',M:'Медик',E:'Инженер',S:'Снайпер'};
export const CATEGORY_NAMES={ar:'Автоматы',arl:'Автоматы',mg:'Пулемёты',shg:'Дробовики',smg:'Пистолеты-пулемёты',sr:'Винтовки',pt:'Пистолеты',kn:'Ножи',fg:'Гранаты',sg:'Дымовые гранаты',fl:'Световые гранаты',gg:'Зажигательные гранаты',cm:'Мины',ap:'Боеприпасы',ak:'Бронекомплекты',mk:'Аптечки',df:'Дефибрилляторы',rg:'Ракетницы',gl:'Гранатомёты',hmg:'Тяжёлое оружие'};
export const SOCKET_NAMES={scope:'Прицел',additionalscope:'Дополнительный прицел',muzzle:'Дульный модуль',grenadelauncher:'Подствольный модуль',underbarrel:'Подствольный модуль',bipod:'Сошки',magazine:'Магазин',butt:'Приклад',barrel:'Ствол'};
export const TIER_ORDER=['S','A','B','C','D'];
export const activeSockets=(weapon,item)=>weapon.sockets.filter(s=>!s.skins||s.skins.includes(item.skin));
export const compatible=(row,cls)=>Boolean(row?.classes?.includes(cls));
export const classAppearance=(row,cls)=>Boolean(row&&!row.internal&&row.classes===cls);
export const pick=(list,rng=Math.random)=>list.length?list[Math.min(list.length-1,Math.floor(rng()*list.length))]:null;
export const cleanSearch=value=>String(value??'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[«»"'’]/g,'').normalize('NFKC').trim();
export function emptyPreset(catalog,cls='R'){
  return {version:1,build:catalog.build,classId:cls,head:catalog.heads[0]||'',appearance:'',armor:[],items:[],ammoAmount:999};
}
export function selection(weapon){
  return {id:weapon.id,skin:weapon.skins.find(s=>s.id==='default')?.id||weapon.skins[0]?.id||'',
    sockets:Object.fromEntries(weapon.sockets.map(s=>[s.id,s.default||'']))};
}
export function addWeapon(preset,weapon,catalog){
  if(!compatible(weapon,preset.classId))throw Error('Оружие недоступно выбранному классу.');
  const next=selection(weapon);
  preset.items=preset.items.filter(i=>i.id!==weapon.id);
  // Primary, sidearm and melee each occupy their real inventory slot.
  if(['primary','secondary','melee'].includes(weapon.slot)){
    const byId=new Map(catalog.weapons.map(w=>[w.id,w]));
    preset.items=preset.items.filter(i=>byId.get(i.id)?.slot!==weapon.slot);
  }
  preset.items.push(next);return next;
}
export function errorsForPreset(p,c){
  const errors=[],ids=new Set(),slots=new Set();
  const byId=new Map(c.weapons.map(w=>[w.id,w]));
  if(!CLASS_NAMES[p.classId])errors.push('Неизвестный класс.');
  if(!Number.isInteger(p.ammoAmount)||p.ammoAmount<0||p.ammoAmount>999999)errors.push('Боезапас должен быть целым числом от 0 до 999999.');
  if(p.head&&!c.heads.includes(p.head))errors.push('Неизвестная голова.');
  if(p.appearance&&!c.appearances.some(a=>a.id===p.appearance&&classAppearance(a,p.classId)))errors.push('Облик недоступен этому классу.');
  const armorSlots=new Set();
  for(const id of p.armor||[]){
    const a=c.armor.find(a=>a.id===id);
    if(!a||!compatible(a,p.classId)){errors.push('Неизвестная или несовместимая броня.');continue;}
    if(armorSlots.has(a.slot))errors.push('Два предмета брони в одном слоте.');
    armorSlots.add(a.slot);
  }
  for(const i of p.items||[]){
    const w=byId.get(i.id);
    if(!w){errors.push('В пресете неизвестное оружие: '+i.id);continue;}
    if(ids.has(i.id))errors.push('Повторяющееся оружие.');
    ids.add(i.id);
    if(!compatible(w,p.classId))errors.push(w.title+': несовместимый класс.');
    if(['primary','secondary','melee'].includes(w.slot)&&slots.has(w.slot))errors.push('Два оружия в одном слоте.');
    slots.add(w.slot);
    if(i.skin&&!w.skins.some(s=>s.id===i.skin))errors.push(w.title+': неизвестный камуфляж.');
    for(const key of Object.keys(i.sockets||{}))if(!w.sockets.some(s=>s.id===key))errors.push('Неизвестный слот модуля.');
    for(const s of w.sockets){
      const id=i.sockets?.[s.id]||'';
      if((activeSockets(w,i).includes(s)&&!s.optional&&!id)||(id&&!s.options.includes(id)))errors.push(w.title+': несовместимый модуль в слоте '+s.id+'.');
    }
  }
  return errors;
}
const luaString=value=>'"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r/g,'\\r').replace(/\n/g,'\\n')+'"';
export function generateLua(p,c){
  const errors=errorsForPreset(p,c);if(errors.length)throw Error(errors[0]);
  const weapons=new Map(c.weapons.map(w=>[w.id,w]));
  const armor=[p.head,p.appearance,...(p.armor||[])].filter(Boolean);
  const items=[],attachments=[],ammo=new Set();
  for(const i of p.items){
    const w=weapons.get(i.id);
    items.push('    { name = '+luaString(i.id)+(i.skin?', skin = '+luaString(i.skin):'')+' },');
    for(const aid of new Set([...(w.fixedAttachments||[]),...activeSockets(w,i).map(s=>i.sockets?.[s.id]).filter(Boolean)])){
      attachments.push('    { name = '+luaString(aid)+', attachTo = '+luaString(i.id)+' },');
    }
    for(const aid of w.ammoTypes||[])ammo.add(aid);
  }
  return ['local inventory = {','  armor = {',...armor.map(id=>'    { name = '+luaString(id)+' },'),'  },',
    '  items = {',...items,'  },','  attachments = {',...attachments,'  },','  ammo = {',
    ...[...ammo].map(id=>'    { name = '+luaString(id)+', amount = '+p.ammoAmount+' },'),'  },','}','return inventory',''].join('\n');
}
export function validateImport(value,c){
  if(!value||value.version!==1||!Array.isArray(value.items)||!Array.isArray(value.armor)||value.items.length>100||value.armor.length>30)throw Error('Неподдерживаемый файл пресета.');
  const p={version:1,build:c.build,classId:value.classId,head:value.head||'',appearance:value.appearance||'',
    ammoAmount:value.ammoAmount,armor:[...value.armor],items:value.items.map(i=>({id:i.id,skin:i.skin||'',sockets:{...(i.sockets||{})}}))};
  const errors=errorsForPreset(p,c);if(errors.length)throw Error(errors[0]);return p;
}
export function randomPreset(c,cls,{tier=null,min={},max={},randomSkins=true}={},rng=Math.random){
  const p=emptyPreset(c,cls);
  const base=c.weapons.filter(w=>!w.variant&&!w.internal&&compatible(w,cls));
  const inRange=w=>{const cat=w.category==='arl'?'ar':w.category;return (!Number.isFinite(min[cat])||w.number>=min[cat])&&(!Number.isFinite(max[cat])||w.number<=max[cat]);};
  const primaryCategories={R:['ar','arl','mg'],M:['shg'],E:['smg'],S:['sr']}[cls]||[];
  const main=base.filter(w=>w.slot==='primary'&&primaryCategories.includes(w.category)&&inRange(w)&&(!tier||(w.meta&&TIER_ORDER.indexOf(w.meta.tier)<=TIER_ORDER.indexOf(tier))));
  if(!main.length)throw Error('Нет основного оружия для выбранного тира и диапазона ID.');
  for(const list of [main,base.filter(w=>w.category==='pt'&&inRange(w)),base.filter(w=>w.category==='kn'&&inRange(w))]){
    const w=pick(list,rng);if(!w)continue;
    const item=selection(w);
    if(randomSkins&&w.skins.length)item.skin=pick(w.skins,rng).id;
    p.items.push(item);
  }
  p.appearance=pick(c.appearances.filter(a=>classAppearance(a,cls)),rng)?.id||'';
  p.head=pick(c.heads,rng)||'';
  return p;
}

