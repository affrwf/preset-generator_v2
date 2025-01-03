/**
 * parse_skins.js
 * ---------------
 * 1) Читает все .xml из data/skins/
 * 2) Парсит <GameItem name="..."/>
 * 3) Складывает результат в data/all_skins.json
 */
const fs = require('fs');
const path = require('path');
const { parseStringPromise } = require('xml2js');

const SKINS_FOLDER = path.join(__dirname, 'data', 'skins');
const OUTPUT_JSON = path.join(__dirname, 'data', 'all_skins.json');

async function parseOneSkin(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const xmlObj = await parseStringPromise(xml);

  // Предположим корневой элемент <GameItem name="..."/>
  const root = xmlObj.GameItem;
  if (!root || !root.$) return null;

  const name = root.$.name || 'unknown_skin';

  // Можно вытащить и другие поля
  // const someParam = root.$.someAttr || ...

  return { name };
}

async function main() {
  const files = fs.readdirSync(SKINS_FOLDER).filter(f => f.endsWith('.xml'));
  const results = [];

  for (const file of files) {
    const fullPath = path.join(SKINS_FOLDER, file);
    const skinObj = await parseOneSkin(fullPath);
    if (skinObj) results.push(skinObj);
  }

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Создан ${OUTPUT_JSON}. Внешностей: ${results.length}`);
}

main().catch(err => console.error('parse_skins.js ERROR:', err));
