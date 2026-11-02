const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {nativeImage}=require('electron');
const gate=require('../src/core/scene-gate.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MATCH=888000411;

// These observations are fixture inputs, deliberately not OCR accuracy claims.
async function runReplaySmoke(t){
  const {state,history,app}=t,checks=[];
  const forbidden=[];
  // A future regression must fail before it can touch the desktop/client.
  // The replay owns this isolated process, so these guards live until exit.
  for(const [file,exportName,method] of [
    ['window-capture','WindowCapture','capture'],['window-monitor','WindowMonitor','start'],
    ['ocr','WindowsOcrWorker','recognize'],['league','LeagueReader','poll'],
  ]){
    const prototype=require(`../src/core/${file}.cjs`)[exportName].prototype;
    assert.equal(typeof prototype[method],'function');
    prototype[method]=function(){forbidden.push(`${exportName}.${method}`);throw new Error('REPLAY_NATIVE_IO_FORBIDDEN');};
  }
  const step=process.argv.find(arg=>arg.startsWith('--replay-step='))?.split('=')[1];
  const byName=name=>{const row=state.catalog.augments.find(a=>a.name===name);assert.ok(row,`Missing replay fixture ${name}`);return row;};
  const a=['珠光护手','小蜜蜂！！！','升级：无尽之刃'].map(byName),b=['会心治疗','小蜜蜂！！！','升级：无尽之刃'].map(byName);
  const ids=()=>state.selectedAugments.map(row=>row.id).sort((a,b)=>a-b);
  const hidden=()=>assert.ok(t.getWindows().every(win=>win.isDestroyed()||!win.isVisible()),'Replay must never display a window');
  const base={phase:'InProgress',liveConnected:true,lcuConnected:true,isMayhem:true,gameId:MATCH,championId:103,gameTime:200,
    ownItems:[],team:[],opponents:[],ownSelectedAugmentIds:[],detectedAugments:[]};
  let apiState={...base},apiFails=false;
  t.setReader({poll:async()=>{if(apiFails)throw new Error('REPLAY_API_UNAVAILABLE');return structuredClone(apiState);},reset:()=>{}});
  const poll=async patch=>{apiState={...apiState,...patch};await t.pollGame();hidden();};
  hidden();

  if(step==='restart'){
    // A fresh controller waits for complete identity, then restores its own file.
    await poll({gameId:null,championId:null,gameTime:301});assert.deepEqual(ids(),[]);
    await poll({gameId:MATCH+1,championId:null});assert.deepEqual(ids(),[]);
    await poll({gameId:MATCH+1,championId:103});
    assert.equal(state.selectionRecovery.restored,true);assert.deepEqual(ids(),[b[0].id]);
    assert.equal(state.selectedAugments[0].source,'api');assert.equal(state.selectionHistoryComplete,false);
    checks.push('new process restores last checkpoint only after match and champion resolve');
    await poll({phase:'ChampSelect',liveConnected:false,gameId:null,gameTime:null});
    assert.deepEqual(ids(),[]);assert.equal(state.overlayVisible,false);
    checks.push('next champion select clears restored match history and overlays');
  }else if(step==='scenario'){
    await poll({gameId:null});assert.equal(state.selectionRecovery.persistent,false);
    await poll({ownSelectedAugmentIds:[a[2].id]});assert.deepEqual(ids(),[a[2].id]);
    await poll({gameId:MATCH,ownSelectedAugmentIds:[]});assert.deepEqual(ids(),[a[2].id]);
    assert.equal(state.selectionRecovery.persistent,true);
    checks.push('late reliable match ID retains earlier API observations without inventing completeness');
    // Start visual generations with an empty history, preserving real identity.
    t.applyHistory(history.reset());t.applyHistory(history.begin({matchId:MATCH,championId:103,gameTime:200}));

    let window={hwnd:'12345',pid:4242,dpi:96,x:0,y:0,width:1920,height:1080,clientRect:{x:0,y:0,width:1920,height:1080},foreground:true,visible:true,minimized:false};
    let mode='a',captures=0,ocrReads=0,stall=null,lastCapture=null,pressId=0,frameAgeMs=0;
    const fixtures=new Map(),decks={a,b},colors={a:'#101b27',b:'#344151',blank:'#000000'};
    const template=nativeImage.createFromPath(path.resolve(__dirname,'../assets/vision/reroll-unused.png')).toDataURL();
    async function imageFor(w,kind){
      const size=w.clientRect,key=`${size.width}x${size.height}:${kind}`;
      if(fixtures.has(key))return fixtures.get(key);
      const geometry=gate.layout(size.width,size.height);
      const data={...size,geometry,kind,color:colors[kind],names:(decks[kind]||[]).map(a=>a.name),template};
      const rendered=await t.panel.webContents.executeJavaScript(`(async()=>{
        const p=${JSON.stringify(data)},canvas=new OffscreenCanvas(p.width,p.height),ctx=canvas.getContext('2d');
        const boxes=[];
        ctx.fillStyle=p.color;ctx.fillRect(0,0,p.width,p.height);
        if(p.kind!=='blank'){
          ctx.fillStyle='#f7f1d7';ctx.font='600 '+Math.round(p.height*.025)+'px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='middle';
          for(let i=0;i<3;i++){
            const r=p.geometry.titles[i],x=(r.x+r.width/2)*p.width,y=(r.y+r.height*.65)*p.height,m=ctx.measureText(p.names[i]);
            ctx.fillText(p.names[i],x,y);boxes.push({text:p.names[i],x:(x-m.actualBoundingBoxLeft-2)/p.width,y:(y-m.actualBoundingBoxAscent-2)/p.height,
              width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight+4)/p.width,height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent+4)/p.height});
          }
          const im=new Image();im.src=p.template;await im.decode();
          for(const r of p.geometry.rerolls)ctx.drawImage(im,Math.round(r.x*p.width),Math.round(r.y*p.height),Math.round(r.width*p.width),Math.round(r.height*p.height));
        }
        const blob=await canvas.convertToBlob({type:'image/png'});const url=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob);});return {url,boxes};
      })()`);
      const image=nativeImage.createFromDataURL(rendered.url);assert.equal(image.isEmpty(),false);const fixture={image,boxes:rendered.boxes};fixtures.set(key,fixture);return fixture;
    }
    const update=patch=>{
      window={...window,...patch};if(patch?.clientRect)window={...window,...patch.clientRect};
      t.onWindowUpdate({game:structuredClone(window),client:null,cursor:{x:0,y:0,active:true,leftDown:false,pressId},observedAt:new Date().toISOString()});
    };
    t.setCapture({capture:async({region,maxWidth})=>{
      captures++;const capturedWindow=structuredClone(window),capturedMode=mode;
      const fixture=await imageFor(capturedWindow,capturedMode),source=fixture.image,size=source.getSize();
      const x=Math.floor(region.x*size.width),y=Math.floor(region.y*size.height);
      const width=Math.min(size.width-x,Math.ceil((region.x+region.width)*size.width)-x),height=Math.min(size.height-y,Math.ceil((region.y+region.height)*size.height)-y);
      let image=source.crop({x,y,width,height});if(width>maxWidth)image=image.resize({width:maxWidth,height:Math.round(height*maxWidth/width)});
      await delay(3);
      const frame={...image.getSize(),hwnd:capturedWindow.hwnd,pid:capturedWindow.pid,dpi:capturedWindow.dpi,clientRect:capturedWindow.clientRect,
        bgraBuffer:image.toBitmap(),capturedAt:new Date(Date.now()-frameAgeMs).toISOString(),region:{x:x/size.width,y:y/size.height,width:width/size.width,height:height/size.height}};
      lastCapture={window:capturedWindow,mode:capturedMode,region:frame.region,boxes:fixture.boxes};
      if(stall){const pending=stall;stall=null;pending.started();await pending.release;}
      return frame;
    },close:async()=>{}});
    t.setOcr({busy:false,close:async()=>{},read:async()=>{
      ocrReads++;const sample=lastCapture,region=sample.region;
      const lines=sample.boxes.map(r=>({text:r.text,x:(r.x-region.x)/region.width,y:(r.y-region.y)/region.height,width:r.width/region.width,height:r.height/region.height}));
      return {lines,text:lines.map(r=>r.text).join(' '),matches:[],engine:'replay-injected',capturedAt:new Date().toISOString()};
    }});
    const scan=async()=>{await t.scanGame();await t.loadedWindows();hidden();};
    const stable=async kind=>{mode=kind;update({foreground:true});await scan();assert.equal(state.offer.stable,false,'First observation cannot become stable');await scan();assert.equal(state.offer.stable,true);assert.equal(state.overlayMode,'cards');};
    const click=slot=>{const r=state.offer.cards[slot].selectionRect;pressId++;t.pointer({active:true,x:r.x+r.width/2,y:r.y+r.height/2,leftPressed:true,leftDown:true,pressId});};
    const absent=async()=>{mode='blank';await delay(270);await scan();assert.equal(state.overlayVisible,false);await scan();};

    update({});await stable('a');click(0);
    mode='b';await scan();assert.equal(state.offer.stable,false);assert.deepEqual(ids(),[]);
    await scan();assert.equal(state.offer.stable,true);assert.deepEqual(state.offeredIds,b.map(a=>a.id));
    await absent();assert.deepEqual(ids(),[]);
    checks.push('changed three-card generation cancels prior click instead of recording a reroll as selected');

    await stable('a');click(0);await absent();assert.deepEqual(ids(),[a[0].id]);
    await stable('b');click(1);await absent();assert.deepEqual(ids(),[a[0].id,b[1].id].sort((a,b)=>a-b));
    await scan();assert.equal(state.selectedAugments.length,2);assert.ok(state.selectedAugments.every(row=>row.source==='inferred'));
    assert.equal(state.selectionHistoryComplete,false);
    checks.push('consecutive card generations accumulate exactly one partial inferred selection each');

    const saved=ids();await stable('a');
    for(const [name,patch] of [['DPI',{dpi:144}],['resize',{clientRect:{x:0,y:0,width:1600,height:900}}],['move',{clientRect:{x:-800,y:50,width:1600,height:900}}],['replacement',{hwnd:'12346',pid:4243}],['focus',{foreground:false}]]){
      let started,release;const entered=new Promise(resolve=>{started=resolve;});stall={started,release:new Promise(resolve=>{release=resolve;})};
      const before=ocrReads,inFlight=t.scanGame();await entered;update(patch);release();await inFlight;
      assert.equal(ocrReads,before,`${name} change must reject the pending captured ROI before OCR`);
      assert.equal(state.offer.stable,false);assert.equal(state.overlayVisible,false);assert.deepEqual(ids(),saved);
      update({foreground:true});await stable('a');
    }
    checks.push('DPI, resize, negative-coordinate move, window replacement and focus changes discard in-flight ROI before OCR');

    frameAgeMs=10000;const beforeExpired=ocrReads;await scan();frameAgeMs=0;
    assert.equal(ocrReads,beforeExpired);assert.equal(state.offer.stable,false);assert.equal(state.overlayVisible,false);assert.deepEqual(ids(),saved);
    assert.match(state.ocr.message,/过期/);await stable('a');
    checks.push('expired title pixels are rejected before OCR/cache use while partial history is retained');

    click(0);update({foreground:false});update({foreground:true});await absent();assert.deepEqual(ids(),saved);
    checks.push('focus change cancels pending click and hides cards without creating a selection');
    await poll({phase:'Reconnect',liveConnected:false,ownSelectedAugmentIds:[]});assert.deepEqual(ids(),saved);
    apiFails=true;await t.pollGame();assert.match(state.connectionError,/重连/);assert.deepEqual(ids(),saved);apiFails=false;
    await poll({phase:'InProgress',liveConnected:true,gameTime:205});assert.deepEqual(ids(),saved);assert.equal(state.connectionError,'');
    checks.push('temporary API disconnect and thrown polling error preserve known history through reconnect');

    await stable('a');await poll({gameId:MATCH+1,gameTime:300,ownSelectedAugmentIds:[b[0].id]});
    assert.deepEqual(ids(),[b[0].id]);assert.equal(state.offer.stable,false);assert.equal(state.overlayVisible,false);
    assert.equal(t.getWindows().length,1,'Match transition must release all scene windows');
    checks.push('new match identity clears old picks, pending cards and scene windows before new API evidence');
    // Deliberately leave the last write to production quit/flush, then restart.
    t.applyHistory(history.observe({id:b[0].id,source:'api'}));
    assert.deepEqual(forbidden,[]);
    await fs.writeFile(path.join(app.getPath('userData'),'scenario-result.json'),JSON.stringify({step,checks,captures,ocrReads,forbiddenNativeCalls:0,visibleWindows:0},null,2));
    return;
  }else throw new Error('Unknown replay step');
  hidden();
  assert.deepEqual(forbidden,[]);
  await fs.writeFile(path.join(app.getPath('userData'),`${step}-result.json`),JSON.stringify({step,checks,forbiddenNativeCalls:0,visibleWindows:0},null,2));
}
module.exports={runReplaySmoke};
