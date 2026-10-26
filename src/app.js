import {loadCatalog} from './catalog.js';
import {CLASS_NAMES,CATEGORY_NAMES,SOCKET_NAMES,activeSockets,compatible,classAppearance,cleanSearch,emptyPreset,selection,addWeapon,generateLua,errorsForPreset,validateImport,randomPreset} from './core.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog,preset,weaponIndex,appearanceIndex,armorIndex;
let tab='weapons',limit=40,shown=[],dialogTarget=null,toastTimer;
const STORAGE='warface-preset-v3';
const slotName=w=>({primary:'Основное оружие',secondary:'Пистолет',melee:'Нож'}[w.slot]||CATEGORY_NAMES[w.category]||w.slot);
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function image(row,cls=''){
 if(!row?.image)return '<span class="placeholder">НЕТ ИКОНКИ В КЛИЕНТЕ</span>';
 if(row.imageRegion){const r=row.imageRegion;return '<svg class="icon '+cls+'" role="img" aria-label="'+esc(row.title)+'" width="'+r.width+'" height="'+r.height+'" viewBox="'+[r.x,r.y,r.width,r.height].join(' ')+'"><image href="'+esc(row.image)+'" width="'+r.atlasWidth+'" height="'+r.atlasHeight+'"/></svg>';}
 return '<img class="'+cls+'" src="'+esc(row.image)+'" alt="'+esc(row.title)+'" loading="lazy" decoding="async">';
}
function tier(row){return row.meta?'<span class="tier tier-'+esc(row.meta.tier)+'">'+esc(row.meta.tier)+'</span><span class="score">'+row.meta.score.toFixed(2).replace('.',',')+'</span>':'';}
function selected(row){
  return tab==='weapons'?preset.items.some(i=>i.id===row.id):tab==='appearances'?preset.appearance===row.id:preset.armor.includes(row.id);
}
function available(){
  const query=cleanSearch($('searchInput').value),category=$('categoryFilter').value;
  const terms=query.split(/\s+/).filter(Boolean);
  return catalog[tab].filter(row=>{
    if(row.internal||(tab==='appearances'?!classAppearance(row,preset.classId):!compatible(row,preset.classId)))return false;
    if(tab==='armor'&&catalog.heads.includes(row.id))return false;
    if(tab==='weapons'){
      if(!$('showVariants').checked&&row.variant)return false;
      if($('metaOnly').checked&&!row.meta)return false;
      if(category&&row.category!==category)return false;
    }
    const haystack=cleanSearch([row.title,row.id,row.description].join(' '));
    return terms.every(term=>haystack.includes(term));
  }).sort((a,b)=>tab==='weapons'?
    (b.meta?.score||0)-(a.meta?.score||0)||Number(b.slot==='primary')-Number(a.slot==='primary')||(b.number-a.number)||a.title.localeCompare(b.title,'ru'):
    a.title.localeCompare(b.title,'ru'));
}
function renderCatalog(){
  if(!catalog)return;
  const rows=available();shown=rows.slice(0,limit);
  $('catalogCount').textContent=rows.length.toLocaleString('ru-RU');
  $('catalogGrid').innerHTML=shown.length?shown.map((row,n)=>'<button type="button" class="item-card '+(selected(row)?'selected':'')+'" data-item="'+n+'" aria-label="'+esc((selected(row)?'Выбрано: ':'Добавить: ')+row.title)+'"><span class="image-wrap">'+image(row)+'</span><span class="item-title">'+esc(row.title)+'</span><span class="item-id">'+esc(row.id)+'</span><span class="card-bottom">'+tier(row)+'<span class="card-add" aria-hidden="true">'+(selected(row)?'✓':'+')+'</span></span></button>').join(''):'<div class="empty-state"><h3>Ничего не найдено</h3><p>Попробуй другое название или ID. Для серийных предметов включи «Варианты».</p></div>';
  $('moreBtn').hidden=rows.length<=limit;
  $('moreBtn').textContent='Показать ещё · осталось '+Math.max(0,rows.length-limit);
}
function weaponImage(w,item){return w.skins.find(s=>s.id===item.skin&&s.image)||w;}
function options(values,current){return values.map(([value,title])=>'<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(title)+'</option>').join('');}
function renderSelected(){
  const gear=[];
  if(preset.appearance){
    const a=appearanceIndex.get(preset.appearance);
    gear.push('<div class="gear-row">'+image(a)+'<div><span class="section-kicker">ОБЛИК</span><h3>'+esc(a.title)+'</h3><span class="item-id">'+esc(a.id)+'</span></div><button class="remove" data-remove-appearance aria-label="Убрать облик">×</button></div>');
  }
  for(const id of preset.armor){
    const a=armorIndex.get(id);
    gear.push('<div class="gear-row">'+image(a)+'<div><h3>'+esc(a.title)+'</h3><span class="item-id">'+esc(a.id)+'</span></div><button class="remove" data-remove-armor="'+esc(id)+'" aria-label="Убрать броню">×</button></div>');
  }
  const items=preset.items.map((item,index)=>{
    const w=weaponIndex.get(item.id);
    const stats=[['Урон',w.settings.damage],['Темп',w.settings.rpm?String(w.settings.rpm)+' / мин':null],['Магазин',w.settings.ammo_amount]].filter(([,v])=>v!==null&&v!==undefined);
    const sockets=activeSockets(w,item).filter(s=>!s.hidden).map(s=>{
      const a=catalog.attachments[item.sockets[s.id]];
      const choices=[...(s.optional?[['','Без модуля']]:[]),...s.options.map(id=>[id,catalog.attachments[id]?.title||id])];
      return '<div class="socket-row"><div class="socket-image">'+(a?image(a):'<span class="muted">—</span>')+'</div><label>'+esc(SOCKET_NAMES[s.id]||s.id)+'<select data-socket="'+esc(s.id)+'" data-index="'+index+'" aria-label="'+esc(SOCKET_NAMES[s.id]||s.id)+' для '+esc(w.title)+'">'+options(choices,item.sockets[s.id]||'')+'</select></label><button class="browse" data-browse="'+esc(s.id)+'" data-index="'+index+'" aria-label="Показать картинки модулей">▦</button></div>';
    }).join('');
    return '<article class="selected-card"><div class="selected-top"><span class="slot">'+esc(slotName(w))+'</span><button class="remove" data-remove="'+index+'" aria-label="Убрать '+esc(w.title)+'">×</button><div class="image-wrap">'+image(weaponImage(w,item))+'</div><h3>'+esc(w.title)+'</h3><div class="item-id">'+esc(w.id)+'</div><div class="stats">'+stats.map(([k,v])=>'<span>'+k+'<strong>'+esc(v)+'</strong></span>').join('')+'</div></div>'+((w.skins.length||sockets)?'<div class="config-controls">'+(w.skins.length?'<label class="skin-label">Камуфляж<select data-skin="'+index+'" aria-label="Камуфляж для '+esc(w.title)+'">'+options(w.skins.map(s=>[s.id,s.title]),item.skin)+'</select></label>':'')+sockets+'</div>':'')+'</article>';
  });
  $('selectedContainer').innerHTML=[...gear,...items].join('')||'<div class="empty-state"><span class="empty-cross">+</span><h3>Начни с оружия</h3><p>Добавь предмет из каталога или создай случайную сборку.</p></div>';
}
function renderOutput(){
  const errors=errorsForPreset(preset,catalog);
  const populated=preset.items.length||preset.appearance||preset.armor.length;
  $('resultArea').value=errors.length?'':generateLua(preset,catalog);
  $('validation').textContent=errors[0]||(populated?'Пресет готов · '+preset.items.length+' ед. оружия':'Добавь снаряжение из каталога');
  $('validation').classList.toggle('invalid',!!errors.length);
  $('copyBtn').disabled=$('downloadBtn').disabled=!!errors.length||!populated;
  $('ammoAmount').value=preset.ammoAmount;
  $('headSelect').value=preset.head;
}
function syncClass(){
  for(const b of $('classTabs').querySelectorAll('button')){
    const active=b.dataset.class===preset.classId;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));
  }
  const categories=[...new Set(catalog.weapons.filter(w=>compatible(w,preset.classId)&&!w.internal).map(w=>w.category))];
  const previous=$('categoryFilter').value;
  $('categoryFilter').innerHTML=options([['','Все категории'],...categories.map(c=>[c,CATEGORY_NAMES[c]||c.toUpperCase()])],categories.includes(previous)?previous:'');
}
function changed({list=true}={}){
  renderSelected();renderOutput();if(list)renderCatalog();
  try{localStorage.setItem(STORAGE,JSON.stringify(preset));}catch{ /* Storage may be blocked; export still works. */ }
}
function resetList(){limit=40;$('catalogScroll').scrollTop=0;renderCatalog();}
function changeClass(cls){
  preset.classId=cls;
  preset.items=preset.items.filter(i=>compatible(weaponIndex.get(i.id),cls));
  preset.armor=preset.armor.filter(id=>compatible(armorIndex.get(id),cls));
  if(preset.appearance&&!classAppearance(appearanceIndex.get(preset.appearance),cls))preset.appearance='';
  syncClass();resetList();changed();
}
function presetFileName(){
  const main=preset.items.find(item=>weaponIndex.get(item.id)?.slot==='primary')||preset.items[0];
  const weapon=main?weaponIndex.get(main.id):null;
  const appearance=appearanceIndex.get(preset.appearance);
  const clean=value=>String(value||'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'').replace(/[. ]+$/g,'').trim().slice(0,75);
  const weaponName=clean(weapon?.title)||'Без оружия';
  const appearanceName=clean(appearance?.title)||'Без облика';
  const unique=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  return weaponName+' - '+appearanceName+' - '+unique+'.lua';
}
function download(name,text,type){
  const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function showModules(index,socketId){
  const item=preset.items[index],w=weaponIndex.get(item?.id),socket=w?.sockets.find(s=>s.id===socketId);
  if(!socket)return;
  dialogTarget={index,socketId};
  $('dialogTitle').textContent=SOCKET_NAMES[socket.id]||socket.id;
  $('moduleGrid').innerHTML=[...(socket.optional?['']:[]),...socket.options].map(id=>{
    const a=catalog.attachments[id];
    return '<button class="item-card '+(item.sockets[socketId]===id?'selected':'')+'" data-module="'+esc(id)+'"><span class="image-wrap">'+(a?image(a):'<span class="muted">—</span>')+'</span><span class="item-title">'+esc(a?.title||'Без модуля')+'</span><span class="item-id">'+esc(id)+'</span></button>';
  }).join('');
  $('moduleDialog').showModal();
}
function rangeOptions(){
  const min={},max={};
  for(const cat of ['ar','mg','shg','smg','sr','pt','kn']){
    const lo=$(cat+'Min').value,hi=$(cat+'Max').value;
    if(lo!=='')min[cat]=Number(lo);
    if(hi!=='')max[cat]=Number(hi);
    if((lo!==''&&(!Number.isInteger(min[cat])||min[cat]<0))||(hi!==''&&(!Number.isInteger(max[cat])||max[cat]<0))||(lo!==''&&hi!==''&&min[cat]>max[cat]))throw Error('Проверь диапазон ID: '+cat.toUpperCase()+'.');
  }
  return {min,max,randomSkins:$('randomSkins').checked};
}
function generate(meta){
  try{
    const next=randomPreset(catalog,preset.classId,{...rangeOptions(),tier:meta?$('tierSelect').value:null});
    preset=next;changed();toast(meta?'Пресет собран из народного тир-листа':'Случайный пресет готов');
  }catch(e){toast(e.message);}
}
function attachEvents(){
  $('classTabs').addEventListener('click',e=>{const b=e.target.closest('[data-class]');if(b&&catalog)changeClass(b.dataset.class);});
  $('catalogTabs').addEventListener('click',e=>{
    const b=e.target.closest('[data-tab]');if(!b)return;
    tab=b.dataset.tab;
    for(const x of $('catalogTabs').querySelectorAll('button')){x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));}
    $('categoryFilter').hidden=tab!=='weapons';
    $('showVariants').closest('label').hidden=$('metaOnly').closest('label').hidden=tab!=='weapons';resetList();
  });
  for(const id of ['searchInput','categoryFilter','showVariants','metaOnly'])$(id).addEventListener(id==='searchInput'?'input':'change',resetList);
  $('moreBtn').addEventListener('click',()=>{limit+=40;renderCatalog();});
  $('catalogGrid').addEventListener('click',e=>{
    const button=e.target.closest('[data-item]');if(!button)return;const row=shown[Number(button.dataset.item)];if(!row)return;
    if(tab==='weapons'){
      if(preset.items.some(i=>i.id===row.id)){toast('Оружие уже в сборке');return;}
      addWeapon(preset,row,catalog);
    }else if(tab==='appearances')preset.appearance=preset.appearance===row.id?'':row.id;
    else preset.armor=preset.armor.includes(row.id)?preset.armor.filter(id=>id!==row.id):[...preset.armor.filter(id=>armorIndex.get(id)?.slot!==row.slot),row.id];
    changed();
  });
  $('selectedContainer').addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-remove'))preset.items.splice(Number(b.dataset.remove),1);
    else if(b.hasAttribute('data-remove-appearance'))preset.appearance='';
    else if(b.hasAttribute('data-remove-armor'))preset.armor=preset.armor.filter(id=>id!==b.dataset.removeArmor);
    else if(b.hasAttribute('data-browse')){showModules(Number(b.dataset.index),b.dataset.browse);return;}
    changed();
  });
  $('selectedContainer').addEventListener('change',e=>{
    const s=e.target;
    if(s.hasAttribute('data-skin'))preset.items[Number(s.dataset.skin)].skin=s.value;
    else if(s.hasAttribute('data-socket'))preset.items[Number(s.dataset.index)].sockets[s.dataset.socket]=s.value;
    changed({list:false});
  });
  $('closeDialog').addEventListener('click',()=>$('moduleDialog').close());
  $('moduleGrid').addEventListener('click',e=>{
    const b=e.target.closest('[data-module]');if(!b||!dialogTarget)return;
    const {index,socketId}=dialogTarget;const item=preset.items[index],w=weaponIndex.get(item?.id);
    const socket=w?.sockets.find(s=>s.id===socketId);const id=b.dataset.module;
    if(!socket||(!socket.optional&&!id)||(id&&!socket.options.includes(id)))return;
    item.sockets[socketId]=id;$('moduleDialog').close();changed({list:false});
  });
  $('randomBtn').addEventListener('click',()=>generate(false));$('metaBtn').addEventListener('click',()=>generate(true));
  $('clearBtn').addEventListener('click',()=>{preset=emptyPreset(catalog,preset.classId);changed();});
  $('ammoAmount').addEventListener('change',()=>{preset.ammoAmount=Number($('ammoAmount').value);changed({list:false});});
  $('headSelect').addEventListener('change',()=>{preset.head=$('headSelect').value;changed({list:false});});
  $('copyBtn').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText($('resultArea').value);toast('Lua скопирован');}
    catch{$('resultArea').focus();$('resultArea').select();toast('Выделено. Нажми Ctrl+C, чтобы скопировать.');}
  });
  $('downloadBtn').addEventListener('click',()=>download(presetFileName(),$('resultArea').value,'text/plain;charset=utf-8'));
  $('saveBtn').addEventListener('click',()=>download('warface_'+catalog.build+'_'+preset.classId+'.json',JSON.stringify(preset,null,2),'application/json'));
  $('importBtn').addEventListener('click',()=>$('importFile').click());
  $('importFile').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      if(file.size>1024*1024)throw Error('Файл сборки слишком большой.');
      const value=JSON.parse(await file.text());preset=validateImport(value,catalog);syncClass();changed();
      toast(String(value.build)!==String(catalog.build)?'Сборка проверена по текущему билду '+catalog.build:'Сборка открыта');
    }catch(error){toast('Не удалось открыть сборку: '+error.message);}
    e.target.value='';
  });
  document.addEventListener('error',e=>{
    if(e.target instanceof HTMLImageElement){const span=document.createElement('span');span.className='placeholder';span.textContent='Иконка недоступна';e.target.replaceWith(span);}
  },true);
}
async function init(){
  try{
    catalog=await loadCatalog(new URL('../data/catalog.json',import.meta.url));
    if(catalog.schemaVersion!==1||!catalog.weapons.length)throw Error('Каталог имеет неподдерживаемый формат.');
    weaponIndex=new Map(catalog.weapons.map(w=>[w.id,w]));appearanceIndex=new Map(catalog.appearances.map(a=>[a.id,a]));armorIndex=new Map(catalog.armor.map(a=>[a.id,a]));
    preset=emptyPreset(catalog);
    try{const saved=localStorage.getItem(STORAGE);if(saved)preset=validateImport(JSON.parse(saved),catalog);}catch{toast('Сохранённая сборка устарела. Создана новая.');}
    $('buildLabel').textContent='БИЛД '+catalog.build;
    $('dataSummary').textContent='Клиент '+catalog.build+' · '+catalog.weapons.filter(w=>!w.variant&&!w.internal).length+' базовых предметов · '+Object.keys(catalog.attachments).length+' модулей';
    $('headSelect').innerHTML=options([['','Без головы'],...catalog.heads.map(id=>[id,id.replace('default_head_','Голова ')])],preset.head);
    $('rangeControls').innerHTML=['ar','mg','shg','smg','sr','pt','kn'].map(cat=>'<label class="range-item"><span>'+cat.toUpperCase()+'</span><input id="'+cat+'Min" type="number" min="0" step="1" placeholder="от" aria-label="'+cat+' минимальный ID"><input id="'+cat+'Max" type="number" min="0" step="1" placeholder="до" aria-label="'+cat+' максимальный ID"></label>').join('');
    for(const id of ['randomBtn','metaBtn','clearBtn','saveBtn','importBtn'])$(id).disabled=false;
    attachEvents();syncClass();changed();
  }catch(error){
    $('buildLabel').textContent='КАТАЛОГ НЕДОСТУПЕН';$('loadError').hidden=false;
    $('loadError').textContent='Не удалось загрузить данные игры. Обнови страницу. Если открываешь проект на компьютере, используй локальный сервер из инструкции README.';
    $('catalogGrid').innerHTML='<div class="empty-state">Каталог недоступен</div>';$('validation').textContent='Данные не загружены';console.error(error);
  }
}
init();

