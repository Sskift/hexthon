// Uses the official OW-Electron development channel; no patching or bypass.
const {app, BrowserWindow, Menu} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {GepMayhemTracker, LOL_GAME_ID, MAYHEM_FEATURES} = require('../../src/core/gep-mayhem.cjs');
const {classifyMayhemUpdate} = require('./diagnostics.cjs');
const catalog = require('../../data/seed/gep-names.json');
const outputDir = path.resolve(__dirname,'../../.qa/overwolf-probe');
fs.mkdirSync(outputDir,{recursive:true});
app.setName('Hexthon GEP Probe');
app.setPath('userData',path.join(outputDir,'profile'));
app.disableHardwareAcceleration();
const tracker = new GepMayhemTracker({catalog:catalog.augments});
const credentials = {
  developerKeyPresent:Boolean(process.env.OW_DEV_KEY),
  consoleEmailPresent:Boolean(process.env.OW_CLI_EMAIL),
  consoleKeyPresent:Boolean(process.env.OW_CLI_API_KEY),
};
const credentialPresent = credentials.consoleEmailPresent ? credentials.consoleKeyPresent : credentials.developerKeyPresent;
const requested = Number(process.argv.find(a=>a.startsWith('--duration-ms='))?.split('=')[1]);
const durationMs = Number.isFinite(requested) ? Math.max(10000,Math.min(300000,requested)) : 45000;
const report = {schemaVersion:1,startedAt:new Date().toISOString(),pid:process.pid,
  runtimeVersion:process.versions.electron,credentials,durationMs,requestedPackages:['gep'],loadedPackages:[],
  stages:{runtimeReady:false,gepReady:false,lolDetected:false,featuresRegistered:false,mayhemFieldReceived:false,mayhemEventReceived:false,mappedCandidatesReceived:false,mappedPickReceived:false},
  features:[],eventCounts:{info:0,game:0,mayhemFields:0,mayhem:0,mappedCandidates:0,mappedPicks:0},errors:[],windowCount:0,
  applicationCapture:false,thirdPartyCaptureInternals:'unverified',cnCompatibility:'unverified',
  mapping:{source:catalog.source,patch:catalog.patch,count:catalog.augments.length},outcome:'running'};
let gep,finished=false,subscriptionBusy=false,registered=false,lastWrite=0;
function write(force=false) {
  if(!force && Date.now()-lastWrite<1000)return;
  lastWrite=Date.now();report.updatedAt=new Date().toISOString();
  report.windowCount=BrowserWindow.getAllWindows().length;
  report.mayhem=tracker.snapshot();
  fs.writeFileSync(path.join(outputDir,'status.json'),JSON.stringify(report,null,2)+'\n');
}
function error(stage,value) {
  // Do not copy arbitrary provider errors, names, process paths or credentials.
  const message=String(value?.message||value||'');
  const classification=/auth|credential|signature|whitelist|access denied|permission/i.test(message)?'access-or-integrity':
    /timeout|connect|network|fetch|download/i.test(message)?'connection':'provider-error';
  if(report.errors.length<20)report.errors.push({stage,classification,at:new Date().toISOString()});
  write(true);
}
function finish(outcome) {
  if(finished)return;finished=true;report.outcome=outcome;report.finishedAt=new Date().toISOString();write(true);
  // No windows, tray, hotkeys, overlay or recorder were created by this probe.
  app.quit();setTimeout(()=>app.exit(0),2000).unref();
}
async function registerFeatures() {
  if(registered||subscriptionBusy)return;subscriptionBusy=true;
  try {
    await gep.setRequiredFeatures(LOL_GAME_ID,MAYHEM_FEATURES);
    registered=true;report.stages.featuresRegistered=true;write(true);
  } catch(e) {error('set-required-features',e);} finally {subscriptionBusy=false;}
}
async function attachGep() {
  if(gep)return;
  try {gep=app.overwolf.packages.gep;}catch(e){error('gep-access',e);return;}
  if(!gep){error('gep-access','unavailable');return;}
  report.stages.gepReady=true;
  gep.on('error',(_event,gameId,err)=>{if(gameId===LOL_GAME_ID)error('gep',err);});
  gep.on('game-detected',(event,gameId)=>{
    if(gameId!==LOL_GAME_ID)return;
    report.stages.lolDetected=true;tracker.gameDetected(gameId);
    try {event.enable();}catch(e){error('enable-game',e);}
    registerFeatures();write(true);
  });
  gep.on('elevated-privileges-required',(_event,gameId)=>{
    if(gameId===LOL_GAME_ID){report.elevatedPrivilegesRequired=true;write(true);}
  });
  gep.on('game-exit',(_event,gameId)=>{tracker.gameExited(gameId);if(gameId===LOL_GAME_ID)write(true);});
  gep.on('new-info-update',(_event,gameId,data)=>{
    if(finished||gameId!==LOL_GAME_ID)return;
    const accepted=tracker.accepts(gameId,data)&&tracker.snapshot().matchStarted!==false;
    const classified=classifyMayhemUpdate(gameId,data,catalog.augments);
    report.eventCounts.info++;tracker.observeInfo(gameId,data);
    if(classified.fieldUpdate){report.eventCounts.mayhemFields++;report.stages.mayhemFieldReceived=true;}
    if(accepted&&classified.validContent){
      report.eventCounts.mayhem++;report.stages.mayhemEventReceived=true;
    }
    if(accepted&&classified.mappedCandidates){report.eventCounts.mappedCandidates++;report.stages.mappedCandidatesReceived=true;}
    if(accepted&&classified.mappedPick){report.eventCounts.mappedPicks++;report.stages.mappedPickReceived=true;}
    write();
  });
  gep.on('new-game-event',(_event,gameId,data)=>{
    if(gameId!==LOL_GAME_ID)return;
    report.eventCounts.game++;tracker.observeGameEvent(gameId,data);write();
  });
  write(true);
  try {report.features=(await gep.getFeatures(LOL_GAME_ID)).filter(f=>typeof f==='string'&&MAYHEM_FEATURES.includes(f));}catch(e){error('get-features',e);}
  await registerFeatures();
  try {
    // This untyped snapshot is not assumed to contain history. Keep only known
    // structural key names; never serialize full player/game payloads.
    const info=await gep.getInfo(LOL_GAME_ID);
    report.snapshotAvailable=Boolean(info&&typeof info==='object');
    report.snapshotKnownSections=info&&typeof info==='object'?Object.keys(info).filter(k=>['me','game_info','match_info','augments','matchState'].includes(k)):[];
  }catch(e){error('get-info',e);}
  write(true);
}
process.on('uncaughtException',e=>{error('uncaught-exception',e);finish('runtime-error');});
process.on('unhandledRejection',e=>error('unhandled-rejection',e));
if(app.overwolf) {
  app.overwolf.disableAnonymousAnalytics();app.overwolf.disableAdsOptimization();app.overwolf.disableAdsFPD();
  const manager=app.overwolf.packages;
  manager.on('ready',(_event,name,version)=>{
    if(name!=='gep')return;
    report.loadedPackages.push({name,version:String(version)});attachGep().catch(e=>error('attach-gep',e));
  });
  manager.on('failed-to-initialize',(_event,name)=>{if(name==='gep')error('package-initialize','failed');});
  manager.on('crashed',event=>{event.preventDefault();error('package-manager','crashed');finish('package-manager-crashed');});
}
app.whenReady().then(()=>{
  Menu.setApplicationMenu(null);report.stages.runtimeReady=true;write(true);
  if(!app.overwolf){finish('not-overwolf-runtime');return;}
  setTimeout(()=>finish(report.stages.mayhemEventReceived?'mayhem-events-observed':
    !report.stages.gepReady&&!credentialPresent?'authorization-required':
    !report.stages.gepReady?'package-not-ready':
    !report.stages.lolDetected?'game-not-detected':'no-mayhem-events-observed'),durationMs);
});
app.on('window-all-closed',()=>{});
