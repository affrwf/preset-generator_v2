/**
 * Скрипт parse_weapons.js:
 * -------------------------
 * 1) Читает все .xml-файлы из data/weapons/
 * 2) Парсит их (через xml2js)
 * 3) Сохраняет результат в data/all_weapons.json (один массив из объектов).
 *
 * Запуск: node parse_weapons.js
 */
const fs = require('fs');
const path = require('path');
const { parseStringPromise } = require('xml2js');

const WEAPONS_FOLDER = path.join(__dirname, 'data', 'weapons');
const OUTPUT_JSON = path.join(__dirname, 'data', 'all_weapons.json');

async function parseWeaponFile(filePath, fileName) {
  // Считываем XML
  const xmlData = fs.readFileSync(filePath, 'utf8');
  const xmlObj = await parseStringPromise(xmlData);

  // Извлекаем категорию из имени файла
  const categoryMatch = fileName.match(/^[^\d]+/);
  const category = categoryMatch ? categoryMatch[0] : 'unknown_category';

  // Предположим, корень <item ... >
  // Смотрим, есть ли xmlObj.item
  const item = xmlObj.item;
  if (!item || !item.$) return null;

  // Вытаскиваем что-нибудь (имя, категория, ammoType, список скинов)
  const name = item.$.name || 'unknown_name';

  // Ищем ammo_type (примерно как раньше)
  let ammoType = '';
  if (item.fireparams && item.fireparams[0].fire && item.fireparams[0].fire[0].param) {
    const ammoParam = item.fireparams[0].fire[0].param.find(p => p.$.name === 'ammo_type');
    if (ammoParam) {
      ammoType = ammoParam.$.value || '';
    }
  }

  // Скины (<skins><material name="..."/>)
  let skins = [];
  if (item.skins && item.skins[0].material) {
    skins = item.skins[0].material.map(m => m.$.name);
  }

  // Модули (attachments) — <sockets><socket><support name="...">
  let attachments = [];
  if (item.sockets && item.sockets[0].socket) {
    item.sockets[0].socket.forEach(socket => {
      if (socket.support) {
        socket.support.forEach(sup => {
          attachments.push(sup.$.name);
        });
      }
    });
  }

  // Можно вытащить и другие параметры (damage, rpm, recoil, ...)
  // Здесь для примера вытащим парочку:
  let rpm = 0, damage = 0;
  if (item.settings && item.settings[0].param) {
    const rpmParam = item.settings[0].param.find(p => p.$.name === 'rpm');
    if (rpmParam) rpm = Number(rpmParam.$.value) || 0;

    const dmgParam = item.settings[0].param.find(p => p.$.name === 'damage');
    if (dmgParam) damage = Number(dmgParam.$.value) || 0;
  }

  // Собираем объект
  return {
    name,
    category,
    ammoType,
    skins,
    attachments,
    //rpm,
    //damage,
  };
}

async function main() {
  // Сканируем папку data/weapons
  const files = fs.readdirSync(WEAPONS_FOLDER).filter(f => f.endsWith('.xml'));

  const results = [];
  for (const file of files) {
    const fullPath = path.join(WEAPONS_FOLDER, file);
    const wObj = await parseWeaponFile(fullPath, file);
    if (wObj) {
      results.push(wObj);
    }
  }

  // Записываем в all_weapons.json
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Готово! Создан файл ${OUTPUT_JSON}, всего оружий: ${results.length}`);
}

main().catch(err => {
  console.error('Ошибка в parse_weapons.js:', err);
});
