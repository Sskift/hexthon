const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runSmoke({panel, overlay, state, ocr}) {
  const dir = path.resolve(__dirname, '../.qa'); await fs.mkdir(dir, { recursive: true });
  assert.equal(panel.isVisible(), false, 'Control panel must remain hidden');
  assert.equal(overlay.isVisible(), false, 'Overlay must remain hidden');
  assert.equal(overlay.isFocusable(), false, 'Overlay must not accept focus');
  assert.equal(overlay.isAlwaysOnTop(), true);
  const run = script => panel.webContents.executeJavaScript(script);
  await wait(900);
  assert.equal(await run('typeof window.require'), 'undefined', 'Renderer must not have Node access');
  assert.equal(await run('document.querySelectorAll(".augment-card").length'), 209);
  assert.equal(await run('document.querySelector(".champion-summary h2").textContent'), '九尾妖狐');
  await fs.writeFile(path.join(dir,'control-panel.png'), (await panel.webContents.capturePage()).toPNG());
  await run('document.querySelector("[data-rarity=\\"4\\"]").click()');
  const goldCount=await run('document.querySelectorAll(".augment-card").length');
  assert.ok(goldCount>20&&goldCount<209);
  await run('document.getElementById("augment-search").value="魔法飞弹";document.getElementById("augment-search").dispatchEvent(new Event("input"))');
  assert.equal(await run('document.querySelectorAll(".augment-card").length'),1);
  await run('document.querySelector("[data-offer]").click()'); await wait(100);
  assert.equal(state.offeredIds.length,1);
  await run('document.getElementById("clear-offers").click()');await wait(100);
  assert.equal(state.offeredIds.length,0);
  await run('document.querySelector("[data-tab=\\"builds\\"]").click()');
  await wait(250);
  assert.equal(await run('document.getElementById("tab-builds").hidden'),false);
  assert.ok(await run('document.querySelectorAll(".item").length')>10);
  await fs.writeFile(path.join(dir,'builds.png'),(await panel.webContents.capturePage()).toPNG());
  await run('document.querySelector("[data-tab=\\"settings\\"]").click()');
  await wait(250);
  assert.equal(await run('document.querySelector("input[name=autoScan]").checked'),false);
  assert.equal(await run('window.hexthon.setOffers([999999999]).then(()=>false,()=>true)'),true);
  assert.equal(await run('window.hexthon.scan().then(()=>false,()=>true)'),true);
  await fs.writeFile(path.join(dir,'settings.png'),(await panel.webContents.capturePage()).toPNG());
  await run(`window.hexthon.setOffers(${JSON.stringify(state.augments.slice(0,3).map(a=>a.id))})`);
  await wait(100);
  await fs.writeFile(path.join(dir,'overlay.png'),(await overlay.webContents.capturePage()).toPNG());
  assert.equal(await overlay.webContents.executeJavaScript('document.querySelectorAll(".row").length'),3);
  if (process.argv.includes('--with-ocr')) {
    const dataUrl = await run(`(() => {const c=document.createElement('canvas');c.width=1200;c.height=540;const x=c.getContext('2d');x.fillStyle='#101a25';x.fillRect(0,0,1200,540);x.fillStyle='#ffffff';x.font='48px Microsoft YaHei';['术士果汁盒','魔法飞弹','循环往复'].forEach((s,i)=>x.fillText(s,80,110+i*150));return c.toDataURL('image/png');})()`);
    const img=require('electron').nativeImage.createFromDataURL(dataUrl);
    await fs.writeFile(path.join(dir,'ocr-synthetic.png'),img.toPNG());
    const result=await ocr.read(img,{x:0,y:0,width:1,height:1},state.catalog.augments);
    await fs.writeFile(path.join(dir,'ocr-synthetic.json'),JSON.stringify(result,null,2));
    assert.deepEqual(result.matches.filter(x=>x.exact).map(x=>x.name).sort(),['术士果汁盒','魔法飞弹','循环往复'].sort());
    console.log('Local Chinese OCR: 3/3 synthetic names recognized (not an in-game test)');
    await ocr.close();
  }
  assert.equal(panel.isVisible(),false);assert.equal(overlay.isVisible(),false);
  const report={passed:true,hiddenWindows:true,focusableOverlay:false,champions:state.catalog.champions.length,
    augments:state.catalog.augments.length,championAugments:state.augments.length,checks:['sandbox','search','rarity filter','three-option comparison','builds','settings','invalid IPC input','disconnected scan','hidden overlay render']};
  await fs.writeFile(path.join(dir,'smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
module.exports={runSmoke};
