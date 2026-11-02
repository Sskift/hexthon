// Offline renderer layout check: one hidden, offscreen window; no game reads,
// desktop capture, external requests, input simulation or foreground activation.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
app.disableHardwareAcceleration();
app.setPath('userData',path.join(require('node:os').tmpdir(),'hexthon-shop-layout-'+process.pid));
app.whenReady().then(async()=>{
  const directory=path.join(__dirname,'../src/renderer');
  const html=fs.readFileSync(path.join(directory,'shop.html'),'utf8')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'')
    .replace('<link rel="stylesheet" href="shop.css">','<style>'+fs.readFileSync(path.join(directory,'shop.css'),'utf8')+'</style>')
    .replace('<script src="shop.js"></script>','');
  const window=new BrowserWindow({show:false,width:300,height:360,useContentSize:true,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true}});
  window.webContents.session.webRequest.onBeforeRequest({urls:['https://*/*','http://*/*']},(_details,callback)=>callback({cancel:true}));
  await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
  const state={selectedChampion:{name:'阿狸'},game:{ownItems:[{id:3157,name:'中娅沙漏'}]},selectedAugments:[{name:'虚幻武器',confidence:'confirmed'}],
    buildSuggestions:[{name:'核心装备',rows:[{items:[{id:3118,name:'残疫',blocked:true,reasons:['终极技能条件冲突']},{id:3089,name:'灭世者的死亡之帽'},{id:3135,name:'虚空之杖'}],next:{id:3089,name:'灭世者的死亡之帽'}}]}],
    matchup:{recommendations:[{item:{id:3115,name:'纳什之牙'},reason:'已选「虚幻武器」：技能可施加攻击特效；该装备描述含攻击特效，具体触发限制仍按游戏说明。',kind:'synergy',source:'OP.GG 路线'},
      {item:{id:3135,name:'虚空之杖'},reason:'已读到 2 名对手的装备提供至少 30 魔抗；当前偏法术方向，可考虑百分比法穿。这不是对手总魔抗。',kind:'matchup',source:'Riot 装备资料'}]}};
  await window.webContents.executeJavaScript('window.hexthon={onState:()=>{},getState:()=>Promise.resolve('+JSON.stringify(state)+')};\n'+fs.readFileSync(path.join(directory,'shop.js'),'utf8'));
  const results=[];
  for(const [width,height,visibleAdvice] of [[300,360,2],[320,360,2],[300,320,1],[208,300,1],[190,300,1],[230,300,1],[760,96,2]]){
    window.setContentSize(width,height);
    window.webContents.enableDeviceEmulation({screenPosition:'desktop',screenSize:{width,height},viewPosition:{x:0,y:0},deviceScaleFactor:1,viewSize:{width,height},scale:1});
    await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const result=await window.webContents.executeJavaScript("(()=>{const p=document.querySelector('.shop-panel'),f=document.querySelector('footer'),cards=[...document.querySelectorAll('.advice-card')].filter(e=>e.getBoundingClientRect().height>0);return {width:innerWidth,height:innerHeight,clientHeight:p.clientHeight,scrollHeight:p.scrollHeight,clientWidth:p.clientWidth,scrollWidth:p.scrollWidth,footerBottom:f.getBoundingClientRect().bottom,visibleAdvice:cards.length,sourcesVisible:cards.every(e=>e.querySelector('small').getBoundingClientRect().height>0),sections:[...p.children].map(e=>({name:e.id||e.tagName,height:e.getBoundingClientRect().height,top:e.getBoundingClientRect().top}))};})()");
    assert.equal(result.width,width);assert.equal(result.height,height);assert.equal(result.visibleAdvice,visibleAdvice,JSON.stringify(result));assert.equal(result.sourcesVisible,true);assert.ok(result.scrollHeight<=result.clientHeight+1,JSON.stringify(result));assert.ok(result.scrollWidth<=result.clientWidth+1,JSON.stringify(result));assert.ok(result.footerBottom<=height,JSON.stringify(result));results.push(result);
  }
  console.log(JSON.stringify({offline:true,windowsShown:0,results}));
  window.destroy();app.exit(0);
}).catch(error=>{console.error(error.stack);app.exit(1);});
