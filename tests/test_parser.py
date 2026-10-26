import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
from PIL import Image
from parse_client import make_catalog
from parser.icons import export_icons

class ClientParserTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix=".fixture-",dir=Path(__file__).resolve().parent)
        self.root=Path(self.temp.name)
        self.game=self.root/'GameData';self.other=self.root/'Other';self.lang=self.root/'Russian'
        for d in ['items/weapons/archetypes','items/accessories','items/skins','items/armor','items/ammo','libs/config/ui']:
            (self.game/d).mkdir(parents=True)
        (self.lang/'languages').mkdir(parents=True)
        self.meta=self.root/'meta.json';self.meta.write_text('{}')
    def tearDown(self):self.temp.cleanup()
    def put(self,p,text):p.write_text(text,encoding='utf-8')
    def test_real_id_wrapper_skin_and_inherited_stats(self):
        self.put(self.lang/'languages/text_weapons.xml','<localization><entry key="weapon_title"><translation value="Тестовая винтовка"/></entry><entry key="skin_title"><translation value="Камуфляж тест"/></entry></localization>')
        self.put(self.game/'items/weapons/archetypes/ar.xml','<settings><param name="damage" value="50"/><param name="rpm" value="600"/></settings>')
        self.put(self.game/'items/weapons/ar99.xml','<item name="ar99"><settings archetype="Items/Weapons/Archetypes/ar.xml"><param name="damage" value="90"/></settings><skins><material name="unusual"/></skins><sockets><socket name="muzzle" can_be_empty="0"><support name="silencer_99"/></socket><socket name="perk_a"><support name="perk_a"/></socket></sockets><fireparams><fire><param name="ammo_type" value="bullet_ar"/></fire></fireparams></item>')
        self.put(self.game/'items/weapons/ar99_shop.xml','<shop_item name="ar99_shop" type="weapon"><mmo_stats><param name="classes" value="R"/></mmo_stats><UI_stats><param name="name" value="@weapon_title"/><param name="icon" value="rifle_icon"/></UI_stats><content><item name="ar99"/></content></shop_item>')
        self.put(self.game/'items/weapons/ar99_cosmetic.xml','<shop_item name="ar99_cosmetic" type="weapon_skin"><skin><param name="material" value="unusual"/></skin><UI_stats><param name="name" value="@skin_title"/><param name="icon" value="skin_icon"/></UI_stats></shop_item>')
        self.put(self.game/'items/accessories/silencer.xml','<item name="silencer_99" type="attachment"><UI_stats><param name="icon" value="module_icon"/></UI_stats></item>')
        c,r=make_catalog(self.game,self.lang,'fixture',2,self.meta)
        self.assertFalse(r['parseErrors'])
        self.assertEqual(len(c['weapons']),1)
        w=c['weapons'][0]
        self.assertEqual((w['id'],w['shopId'],w['title']),('ar99','ar99_shop','Тестовая винтовка'))
        self.assertEqual((w['settings']['damage'],w['settings']['rpm']),(90,600))
        self.assertEqual(w['skins'][0]['title'],'Камуфляж тест')
        self.assertEqual(w['skins'][0]['id'],'unusual')
        self.assertEqual(w['sockets'][0]['options'],['silencer_99'])
        self.assertEqual(w['ammoTypes'],['bullet_ar'])
    def test_image_set_grid_and_transparent_trim(self):
        (self.other/'libs/icons').mkdir(parents=True)
        im=Image.new('RGBA',(40,20),(0,0,0,0))
        for x in range(25,35):
            for y in range(5,15):im.putpixel((x,y),(255,20,10,255))
        im.save(self.other/'libs/icons/atlas.png')
        self.put(self.game/'libs/config/ui/icons.xml','<images><image_set file="Libs/Icons/atlas.tif" size_x="20" size_y="20"><image name="module_icon" pos="1,0"/></image_set></images>')
        row={'id':'scope','icon':'module_icon','image':None}
        c={'weapons':[],'attachments':{'scope':row},'appearances':[],'armor':[]}
        report=export_icons(self.game,self.other,self.root/'out',c,1)
        self.assertEqual(report['exported'],1)
        with Image.open(self.root/'out'/row['image']) as result:self.assertEqual(result.size,(10,10))
    def test_invalid_xml_is_reported(self):
        self.put(self.game/'items/weapons/ar99.xml','<item')
        _,r=make_catalog(self.game,self.lang,'fixture',1,self.meta)
        self.assertEqual(r['parseErrors'][0]['file'],'items/weapons/ar99.xml')

if __name__=='__main__':unittest.main()

