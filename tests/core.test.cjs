const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { parsePage, flightObjects, OpggProvider, BASE } = require('../src/core/opgg.cjs');
const { parseLockfile, parseCommandLine, localGet, isMayhem, championFromSelect, championFromLive } = require('../src/core/league.cjs');
const { matchAugments } = require('../src/core/matching.cjs');
const { validateSettings, overlayBounds } = require('../src/core/settings.cjs');
const catalog = require('../data/seed/index.json');
const ahri = require('../data/seed/ahri-augments.json');

test('real fetched data has named, unique augments and does not invent win rates', () => {
  assert.equal(catalog.champions.length, 173); assert.equal(catalog.augments.length, 263);
  assert.equal(ahri.augments.length, 209);
  for (const data of [catalog, ahri]) {
    assert.equal(new Set(data.augments.map(a=>a.id)).size, data.augments.length);
    assert.ok(data.augments.every(a=>a.name&&[1,4,8].includes(a.rarity)));
    assert.ok(data.augments.every(a=>!('winRate' in a)));
  }
  const global=catalog.augments.find(a=>a.key==='WarlockJuicebox'),specific=ahri.augments.find(a=>a.key==='WarlockJuicebox');
  assert.notEqual(global.tier,specific.tier); assert.equal(specific.scope,'champion');
});
test('Flight JSON can span script chunks without evaluating script',()=>{
  const value={data:'中文<script>bad()</script>',items:[1,2]};const text='a:'+JSON.stringify(value)+'\n';
  const h=[text.slice(0,17),text.slice(17)].map(s=>`<script>self.__next_f.push(${JSON.stringify([1,s]).replace(/<\//g,'<\\/')})</script>`).join('');
  assert.deepEqual(flightObjects(h),[value]);
  assert.deepEqual(flightObjects('<script>self.__next_f.push(alert(1))</script>'),[]);
});
test('parser strips HTML, ignores incomplete augment rows and fails on missing structure',()=>{
  const rows=Array.from({length:12},(_,i)=>({id:i+1,key:`key${i}`,name:`符文${i}`,rarity:4,largeIcon:'https://evil.invalid/a.png',tier:0,desc:'<b>增加</b><br>技能急速',performance:88}));
  rows.push({id:999,tier:5});
  const text='1:'+JSON.stringify({data:rows})+'\n';
  const h='<title>海克斯大乱斗 16.21 版本</title>aram-mayhem<script>self.__next_f.push('+JSON.stringify([1,text])+')</script>';
  const d=parsePage(h,{kind:'augments',championKey:'ahri'});
  assert.equal(d.augments.length,12);assert.equal(d.augments[0].description,'增加\n技能急速');assert.equal(d.augments[0].image,'');
  assert.throws(()=>parsePage(h,{kind:'index'}),/不完整/);
  assert.throws(()=>parsePage('<html>captcha</html>'),/不是/);
});
test('cache uses stale data on failure, backs off, and preserves attribution',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hexthon-cache-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.writeFile(path.join(dir,'index.json'),JSON.stringify({...catalog,fetchedAt:'2000-01-01T00:00:00Z'}));
  let calls=0;const p=new OpggProvider(dir,dir,async()=>{calls++;throw new Error('network unavailable');});
  const a=await p.get();const b=await p.get('index',null,true);
  assert.equal(a.cacheStatus,'stale');assert.equal(b.cacheStatus,'stale');assert.equal(a.url,BASE);assert.equal(calls,1);
});
test('provider rejects unknown kinds and path traversal',async()=>{
  const p=new OpggProvider('missing','missing');
  await assert.rejects(()=>p.get('augments','../secret'),/无效/);
  await assert.rejects(()=>p.get('arbitrary','ahri'),/无效/);
});
test('LCU lockfile and process tokens stay separate from public state',()=>{
  assert.deepEqual(parseLockfile('LeagueClient:101:54212:test-token:https'),{port:54212,password:'test-token'});
  assert.deepEqual(parseCommandLine('LeagueClientUx.exe --app-port=54212 --remoting-auth-token="test-token"'),{port:54212,password:'test-token'});
  assert.equal(parseCommandLine('--app-port=0'),null);
  assert.throws(()=>parseLockfile('LeagueClient:1:123:token:http'));
});
test('local API enforces an endpoint allowlist',async()=>{
  await assert.rejects(()=>localGet('/lol-chat/v1/me',{port:1,password:'x'}),/未允许/);
  await assert.rejects(()=>localGet('https://remote.example/liveclientdata/activeplayer'),/未允许/);
});
test('plain ARAM is not automatically classified as Mayhem',()=>{
  assert.equal(isMayhem({gameData:{queue:{id:450,name:'ARAM'}}}),false);
  assert.equal(isMayhem({gameData:{queue:{id:2400}}}),true);
  assert.equal(isMayhem(null),false);
});
test('champ select resolves localPlayerCellId rather than the first teammate',()=>{
  assert.equal(championFromSelect({localPlayerCellId:2,myTeam:[{cellId:1,championId:22},{cellId:2,championId:103}]}),103);
  assert.equal(championFromSelect(null),null);
});
test('Live Client resolves own champion using stable raw name on Chinese clients',()=>{
  assert.equal(championFromLive({riotId:'local#CN'},[{riotId:'other#CN',rawChampionName:'game_character_displayname_Ashe'},{riotId:'local#CN',championName:'阿狸',rawChampionName:'game_character_displayname_Ahri'}],catalog.champions),103);
  assert.equal(championFromLive({riotId:'missing#CN'},[],catalog.champions),null);
});
test('Chinese OCR ignores punctuation and never calls a fuzzy guess exact',()=>{
  const exact=matchAugments('魔 法 飞 弹\n小蜜蜂!!!\n循环往复',catalog.augments);
  assert.equal(exact.length,3);assert.ok(exact.every(x=>x.exact));
  const fuzzy=matchAugments('魔法飞掸',catalog.augments);
  assert.equal(fuzzy[0].name,'魔法飞弹');assert.equal(fuzzy[0].exact,false);
  assert.equal(matchAugments('随机画面里的无关文字',catalog.augments).length,0);
});
test('window bounds support negative monitor coordinates and small screens',()=>{
  const area={x:-1280,y:0,width:1280,height:720},b=overlayBounds(area,'bottom-right');
  assert.ok(b.x>=area.x&&b.x+b.width<=0);assert.ok(b.y+b.height<=720);
  const small=overlayBounds({x:0,y:0,width:320,height:480},'top-left');assert.ok(small.width<320&&small.height<480);
});
test('settings validate OCR rectangles and clamp opacity',()=>{
  assert.equal(validateSettings({opacity:4}).opacity,1);
  assert.equal(validateSettings({autoScan:'true'}, {autoScan:false}).autoScan,false);
  assert.equal(validateSettings({}).autoScan,false);
  assert.throws(()=>validateSettings({ocrRegion:{x:.9,y:0,width:.3,height:.3}}),/区域/);
  assert.throws(()=>validateSettings({ocrRegion:{x:NaN,y:0,width:.3,height:.3}}),/区域/);
});
