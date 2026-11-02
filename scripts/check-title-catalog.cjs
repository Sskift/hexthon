// Windows OCR coverage benchmark: generated catalog text only, no screen input.
const path=require('node:path');
if(!process.versions.electron){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  require('node:child_process').execFile(require('electron'),[__filename,...process.argv.slice(2)],{env,windowsHide:true,timeout:120000,maxBuffer:100000},(error,stdout)=>{
    if(stdout)process.stdout.write(stdout);if(error){process.stderr.write('Catalog benchmark did not complete.\n');process.exitCode=1;}
  });
}else{
  const {app,BrowserWindow,nativeImage,session}=require('electron'),fs=require('node:fs/promises');
  const {OcrReader,WindowsOcrWorker}=require('../src/core/ocr.cjs');
  const {readOfferTitles}=require('../src/core/title-reader.cjs');
  const {normalizeTitle:normalize}=require('../src/core/light-offer.cjs');
  const {layout}=require('../src/core/scene-gate.cjs');
  const root=path.resolve(__dirname,'..'),out=path.join(root,'.qa/title-catalog');
  app.disableHardwareAcceleration();app.setPath('userData',path.join(out,'profile'));
  let window,reader;
  app.whenReady().then(async()=>{
    await fs.mkdir(out,{recursive:true});
    session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
    window=new BrowserWindow({show:false,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    await window.loadURL('data:text/html,<meta charset="utf-8">');
    reader=new OcrReader(path.join(out,'unused'),()=>{},(bitmap,size)=>nativeImage.createFromBitmap(bitmap,size),{nativeWorker:new WindowsOcrWorker({timeoutMs:2500,retryMs:15000})});
    const catalog=JSON.parse(await fs.readFile(path.join(root,'data/seed/index.json'),'utf8')).augments;
    const cases=[],mistakes=[],variants=process.argv.includes('--variants');
    // Keep the original baseline unchanged. This extra matrix deliberately uses
    // unseen brightness, weight, size and background combinations, not game data.
    const matrix=variants?[[1280,720,400,'#d4cfb5',true],[1600,900,600,'#eee4c8',true],[1920,1080,600,'#c7c7c7',false],[2560,1440,400,'#fff7dd',true],[3440,1440,600,'#f0ebe0',false]]:[[1920,1080,400],[1280,720,600],[2560,1440,600]];
    for(const [width,height,weight,foreground='#f7f1d7',texture=false] of matrix){
      const geometry=layout(width,height),region=geometry.titleRegion;
      const sw=Math.round(region.width*width),sh=Math.round(region.height*height);
      for(let first=0;first<catalog.length;first+=3){
        const expected=[0,1,2].map(offset=>catalog[(first+offset)%catalog.length]);
        const input={sw,sh,width,height,weight,foreground,texture,region,titles:geometry.titles,names:expected.map(row=>row.name)};
        const png=await window.webContents.executeJavaScript(`(async()=>{
          const p=${JSON.stringify(input)},canvas=new OffscreenCanvas(p.sw,p.sh),ctx=canvas.getContext('2d');
          ctx.fillStyle='#101b27';ctx.fillRect(0,0,p.sw,p.sh);
          if(p.texture){const gradient=ctx.createLinearGradient(0,0,p.sw,p.sh);gradient.addColorStop(0,'#142c43');gradient.addColorStop(.5,'#374149');gradient.addColorStop(1,'#14202d');ctx.fillStyle=gradient;ctx.fillRect(0,0,p.sw,p.sh);ctx.shadowColor='#080c12';ctx.shadowBlur=2;ctx.shadowOffsetY=1;}
          ctx.fillStyle=p.foreground;ctx.textAlign='center';ctx.textBaseline='middle';
          const font=Math.round(p.height*.025);ctx.font=p.weight+' '+font+'px "Microsoft YaHei"';
          for(let i=0;i<3;i++){
            const rect=p.titles[i],lines=[];let line='';
            for(const letter of p.names[i]){if(line&&ctx.measureText(line+letter).width>rect.width*p.width*.94){lines.push(line);line='';}line+=letter;}lines.push(line);
            const cx=(rect.x+rect.width/2-p.region.x)*p.width,cy=(rect.y+rect.height/2-p.region.y)*p.height;
            lines.forEach((text,index)=>ctx.fillText(text,cx,cy+(index-(lines.length-1)/2)*font*1.1));
          }
          const blob=await canvas.convertToBlob({type:'image/png'});return await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob);});
        })()`);
        const image=nativeImage.createFromDataURL(png);
        const attempts=[];
        const traced={read:async(...args)=>{const result=await reader.read(...args);attempts.push({rect:args[1],options:args[3],lines:result.lines});return result;}};
        const reading=await readOfferTitles({ocr:traced,image,region,geometry,augments:catalog,capturedAt:new Date().toISOString()});
        const matched=reading.offer.recognized||[];
        const incorrect=matched.filter(row=>row.id!==expected[row.slot].id);
        if(incorrect.length)mistakes.push({width,height,expected:expected.map(row=>row.id),recognized:matched});
        cases.push({width,height,weight,...(variants?{foreground,texture}:{}),ids:expected.map(row=>row.id),accepted:reading.offer.cards.length===3,correctTitles:matched.filter(row=>row.id===expected[row.slot].id).length,
          missing:expected.filter((row,index)=>!matched.some(found=>found.slot===index&&found.id===row.id)).map(row=>({id:row.id,name:row.name})),reads:reading.reads,durationMs:reading.durationMs,
          ...(!reading.offer.cards.length||incorrect.length?{attempts}:{})});
      }
      console.log(JSON.stringify({resolution:`${width}x${height}`,cases:cases.filter(row=>row.width===width).length,completed:true}));
    }
    const durations=cases.map(row=>row.durationMs).sort((a,b)=>a-b);
    const coverageByResolution=[...new Set(cases.map(row=>`${row.width}x${row.height}`))].map(resolution=>{
      const rows=cases.filter(row=>`${row.width}x${row.height}`===resolution);
      return {resolution,fullyAcceptedScenes:rows.filter(row=>row.accepted).length,scenes:rows.length,correctTitles:rows.reduce((sum,row)=>sum+row.correctTitles,0),totalTitles:rows.length*3};
    });
    const normalizationAmbiguities=catalog.filter(item=>!normalize(item.name)||catalog.some(other=>other.id!==item.id&&normalize(other.name)===normalize(item.name)))
      .map(item=>({id:item.id,name:item.name,reason:normalize(item.name)?'Normalized name collides with another catalog ID; intentionally abstain.':'No letters remain after normalization; intentionally abstain.'}));
    const report={completed:true,syntheticOnly:true,actualWindowCapture:false,catalogCount:catalog.length,scenes:cases.length,
      fullyAcceptedScenes:cases.filter(row=>row.accepted).length,correctTitles:cases.reduce((sum,row)=>sum+row.correctTitles,0),totalTitles:cases.length*3,
      falseIdentifications:mistakes.length,p95Ms:durations[Math.ceil(durations.length*.95)-1],workerStarts:reader.nativeWorker.starts,maxReads:Math.max(...cases.map(row=>row.reads)),
      coverageByResolution,normalizationAmbiguities,mistakes,cases,
      limitations:variants?'Generated YaHei text with different brightness, weight, shadow, gradient and sizes. No game screenshots; not real-game accuracy or FPS.':'Generated YaHei text on a flat background. Abstention remains a coverage gap. This does not measure real game accuracy or FPS.'};
    await fs.writeFile(path.join(out,variants?'variants.json':'report.json'),JSON.stringify(report,null,2));
    const {cases:details,mistakes:wrong,...summary}=report;console.log(JSON.stringify(summary));
    await reader.close();window.destroy();app.exit(mistakes.length?1:0);
  }).catch(async error=>{await reader?.close();window?.destroy();console.error(error.message);app.exit(1);});
}
