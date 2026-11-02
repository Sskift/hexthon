const {validateSettings}=require('./settings.cjs');

// Keep the assistant preference separate from the API-only effective value.
// Opening the API-only app must not silently pause the next assistant launch.
function startupSettings(previous,{visual=false,light=false,paused=false}={}){
  previous=previous&&typeof previous==='object'&&!Array.isArray(previous)?previous:{};
  const input=previous.schemaVersion>=2?previous:{...previous,autoFollow:true,autoOverlay:true};
  let base;
  try{base=validateSettings(input);}catch{const {ocrRegion,...rest}=input;base=validateSettings(rest);}
  const assistantAutoScan=typeof previous.assistantAutoScan==='boolean'?previous.assistantAutoScan:true;
  return {...base,schemaVersion:5,assistantAutoScan:light&&paused?false:assistantAutoScan,
    autoScan:visual?(light?(paused?false:assistantAutoScan):base.autoScan):false};
}
function updateSettings(patch,current,{visual=false,light=false}={}){
  const next={...validateSettings(patch,current),schemaVersion:5,assistantAutoScan:current.assistantAutoScan};
  if(light&&typeof patch.autoScan==='boolean')next.assistantAutoScan=patch.autoScan;
  if(!visual)next.autoScan=false;
  return next;
}
module.exports={startupSettings,updateSettings};
