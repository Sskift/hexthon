const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LightShopScanner}=require('../src/core/shop-scanner.cjs');
const header={x:.1,y:.1,width:.8,height:.1},footer={x:.1,y:.7,width:.8,height:.1};
function harness(){
  let now=1000;const calls=[];
  const detector={headerRegions:()=>[header,header,{...header,y:.3}],pixelGate:f=>({candidate:f.candidate!==false}),
    headerEvidence:()=>({candidate:true}),footerRegions:()=>[footer],
    shopFromStrips:(_h,f)=>({visible:true,rect:{x:.1,y:.1,width:.7,height:.7},observedAt:f.capturedAt,headerRegion:header,footerRegion:footer})};
  const scanner=new LightShopScanner({now:()=>now,detector});
  const input={width:1920,height:1080,scope:'one',capture:async region=>{calls.push('capture');return {width:1200,height:100,region,capturedAt:new Date(now).toISOString()};},read:async()=>{calls.push('ocr');return {lines:[]};}};
  return {scanner,input,calls,detector,advance:n=>now+=n};
}
test('initial shop detection verifies two fresh strips and the locked followup never replays OCR',async()=>{
  const h=harness(),first=await h.scanner.scan(h.input);assert.equal(first.observation.visible,true);assert.equal(first.stats.ocrReads,2);
  const early=await h.scanner.scan(h.input);assert.equal(early.skipped,true);h.advance(900);
  const second=await h.scanner.scan(h.input);assert.notEqual(first.observation.observedAt,second.observation.observedAt);assert.equal(second.stats.ocrReads,2);
});
test('negative gates cannot run OCR and primary discovery stays within two regions',async()=>{
  const h=harness();h.detector.pixelGate=()=>({candidate:false});
  const out=await h.scanner.scan(h.input);assert.equal(out.observation.visible,false);assert.equal(out.stats.captures,2);assert.equal(out.stats.ocrReads,0);
  h.advance(1900);const burst=await h.scanner.scan({...h.input,urgent:true});assert.equal(burst.stats.captures,2);
});
test('window scope change discards a locked position and asynchronous stale capture never invokes OCR',async()=>{
  const h=harness();let current=true;
  await assert.rejects(h.scanner.scan({...h.input,isCurrent:()=>current,capture:async r=>{current=false;return {width:1,height:1,region:r};}}),/STALE/);
  assert.equal(h.calls.length,0);assert.equal(h.scanner.lock,null);
});
test('a slow strip read exhausts the time budget before further capture or visibility can be committed',async()=>{
  const h=harness();const out=await h.scanner.scan({...h.input,read:async()=>{h.advance(900);return {lines:[]};}});
  assert.equal(out.observation.visible,false);assert.equal(out.stats.budgetExceeded,true);assert.equal(out.stats.captures,1);assert.equal(h.scanner.lock,null);
});
