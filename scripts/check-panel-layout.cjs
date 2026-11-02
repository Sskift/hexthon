// Real renderer, fake state: no local game API, capture, screenshot or update.
const path=require('node:path');
if(!process.versions.electron){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  require('node:child_process').execFile(require('electron'),[__filename],{env,windowsHide:true,timeout:30000,maxBuffer:100000},(error,stdout,stderr)=>{
    if(stdout)process.stdout.write(stdout);if(stderr)process.stderr.write(stderr);
    if(error)process.exitCode=1;
  });
}else{
  const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),assert=require('node:assert/strict');
  app.disableHardwareAcceleration();app.setPath('userData',path.join(require('node:os').tmpdir(),'hexthon-panel-layout-'+process.pid));
  let window;
  app.whenReady().then(async()=>{
    const directory=path.resolve(__dirname,'../src/renderer');
    const html=fs.readFileSync(path.join(directory,'index.html'),'utf8')
      .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'')
      .replace('<link rel="stylesheet" href="styles.css">','<style>'+fs.readFileSync(path.join(directory,'styles.css'),'utf8')+'</style>')
      .replace(/<script src="[^"]+"><\/script>/g,'');
    window=new BrowserWindow({show:false,width:900,height:650,useContentSize:true,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,nodeIntegration:false}});
    let shown=0,focused=0,externalRequests=0;
    window.on('show',()=>shown++);window.on('focus',()=>focused++);
    window.webContents.session.webRequest.onBeforeRequest({urls:['https://*/*','http://*/*']},(_details,callback)=>{externalRequests++;callback({cancel:true});});
    await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    const champions=[{id:103,key:'ahri',name:'阿狸',rank:12,tier:1},{id:54,key:'malphite',name:'墨菲特',rank:15,tier:1},{id:222,key:'jinx',name:'金克丝',rank:10,tier:1},{id:99,key:'lux',name:'拉克丝',rank:18,tier:2},{id:22,key:'ashe',name:'艾希',rank:8,tier:1}];
    const augments=[{id:3001,key:'demo',name:'虚幻武器',rarity:8,tier:1,description:'技能可施加攻击特效。',scope:'champion'}];
    const state={version:require('../package.json').version,recognitionMode:'api',catalog:{champions,augments,patch:'16.21'},selectedChampion:champions[0],augments,
      game:{phase:'ChampSelect',championId:103,isMayhem:true,lcuConnected:true,liveConnected:false,queueId:2400,team:champions.map((c,i)=>({championId:c.id,isSelf:i===0})),ownItems:[{id:3115,name:'纳什之牙'}]},
      settings:{...require('../src/core/settings.cjs').DEFAULTS},displays:[],shortcuts:{},offeredIds:[],selectedAugments:[{id:3001,confidence:'inferred'}],ocr:{status:'idle'},
      nativeItemSets:{status:'disabled'},compatibility:{itemSetSyncEnabled:true,warnings:[]},updates:{status:'ready',version:'0.4.2'},
      buildSuggestions:[{name:'核心装备',rows:[{items:[{id:3115,name:'纳什之牙',owned:true,fit:{benefits:['当前攻击特效路线可参考']}},{id:3118,name:'残疫',blocked:true,reasons:['终极技能已被禁用，不能按常规收益推荐']},{id:3089,name:'灭世者的死亡之帽'}],fitCautions:['强化记录仍可能不完整'],next:{id:3089,name:'灭世者的死亡之帽'}}]}],
      matchup:{summary:'依据双方已经公开的装备与本地已知强化进行规则判断。',recommendations:[{item:{id:3135,name:'虚空之杖'},reason:'已读取的对手装备提供魔抗，可考虑法术穿透。',source:'OP.GG 路线与装备规则',fit:{benefits:['补充法术穿透'],cautions:['装备数值不等于对手总魔抗']}}],evidence:{opponentInventoriesKnown:5,opponentPlayers:5,allyInventoriesKnown:5,allyPlayers:5,teamChampionIds:champions.map(c=>c.id),opponentChampionIds:[54,22],buildStyle:{label:'当前构筑线索',directions:[{label:'攻击特效'}],mechanisms:[{tentative:true,augmentName:'虚幻武器',effect:'可将部分技能与攻击特效联系起来'}],notice:'具体触发限制仍以当前游戏说明为准'}}},
      draft:{composition:{reasons:['队友前排覆盖不足','已有多名远程输出']},coverage:{rolesKnown:4,teammates:4},recommendation:{action:'consider-swap',championId:54,label:'可以考虑交换',scoreDelta:9,confidence:'medium',reasons:['补充前排与近身承伤角色'],tradeoffs:['交换后会减少当前英雄的远程法术输出']},candidates:[{championId:54,score:81,scoreDelta:9,reasons:['补充前排角色'],tradeoffs:['减少远程输出']},{championId:103,score:72,scoreDelta:0,isCurrent:true,reasons:['保持当前法术输出角色'],tradeoffs:[]}]}};
    await window.webContents.executeJavaScript('window.__panelErrors=[];window.addEventListener("error",e=>window.__panelErrors.push(e.message));window.hexthon=new Proxy({getState:()=>Promise.resolve('+JSON.stringify(state)+'),onState:fn=>{window.__pushHexthon=fn;}},{get:(target,name)=>name in target?target[name]:(()=>Promise.resolve({}))});\n'+fs.readFileSync(path.join(directory,'recommendation-details.js'),'utf8')+'\n'+fs.readFileSync(path.join(directory,'app.js'),'utf8'));
    const results=[];
    for(const [width,height]of [[900,650],[1280,900]]){
      window.setContentSize(width,height);
      window.webContents.enableDeviceEmulation({screenPosition:'desktop',screenSize:{width,height},viewPosition:{x:0,y:0},deviceScaleFactor:1,viewSize:{width,height},scale:1});
      for(const tab of ['draft','builds','settings']){
        await window.webContents.executeJavaScript(`setTab(${JSON.stringify(tab)});renderSettings();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
        const result=await window.webContents.executeJavaScript(`(()=>{const panel=document.getElementById('tab-${tab}'),main=document.querySelector('main'),visible=e=>e.getBoundingClientRect().height>0;return {tab:${JSON.stringify(tab)},width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,mainWidth:main.clientWidth,mainScrollWidth:main.scrollWidth,overflow:[...panel.querySelectorAll('.settings-card,.draft-decision,.build-style,.build-fit-summary,.draft-candidate,.build-row,.matchup-card')].filter(visible).filter(e=>e.scrollWidth>e.clientWidth+1||e.getBoundingClientRect().right>innerWidth+1).map(e=>({name:e.className,width:e.clientWidth,scroll:e.scrollWidth,right:e.getBoundingClientRect().right})),draftExplanation:document.querySelector('.draft-decision')?.textContent||'',buildExplanation:document.querySelector('.build-style')?.textContent||'',blockedReason:document.querySelector('.build-fit-summary')?.textContent||'',updates:document.getElementById('updates-status')?.textContent||'',updateDisabled:document.getElementById('updates-apply')?.disabled,errors:window.__panelErrors.slice(),toast:document.getElementById('toast').hidden?'':document.getElementById('toast').textContent};})()`);
        assert.equal(result.width,width);assert.equal(result.height,height);assert.ok(result.documentWidth<=width,JSON.stringify(result));assert.ok(result.mainScrollWidth<=result.mainWidth+1,JSON.stringify(result));assert.deepEqual(result.overflow,[],JSON.stringify(result));assert.deepEqual(result.errors,[]);assert.equal(result.toast,'');
        assert.match(result.draftExplanation,/补充前排与近身承伤角色/);assert.match(result.draftExplanation,/减少当前英雄的远程法术输出/);assert.match(result.buildExplanation,/待确认记录 · 虚幻武器/);assert.match(result.blockedReason,/终极技能已被禁用/);assert.match(result.updates,/退出选人和对局后更新/);assert.equal(result.updateDisabled,true);
        results.push({width,height,tab,horizontalOverflow:false,explanationsPresent:true});
      }
    }
    const idle={...state,game:{...state.game,phase:'EndOfGame'},updates:{status:'ready',version:'0.4.2',lastResult:{status:'rolled-back'}}};
    await window.webContents.executeJavaScript(`window.__pushHexthon(${JSON.stringify(idle)});setTab('settings');`);
    const updateState=await window.webContents.executeJavaScript(`({disabled:document.getElementById('updates-apply').disabled,text:document.getElementById('updates-status').textContent})`);
    assert.equal(updateState.disabled,false);assert.match(updateState.text,/已恢复此前版本/);
    assert.equal(shown,0);assert.equal(focused,0);assert.equal(window.isVisible(),false);assert.equal(externalRequests,0);
    console.log(JSON.stringify({passed:true,syntheticOnly:true,windowsShown:shown,windowFocusEvents:focused,externalRequests,actualUpdateActions:0,results}));
    window.destroy();window=null;app.exit(0);
  }).catch(error=>{console.error(error.stack);window?.destroy();app.exit(1);});
}
