const {test} = require('node:test');
const assert = require('node:assert/strict');
const {visualContext, sameVisualContext, isCurrentVisualContext, captureMatchesContext, captureIsFresh, trackingPresentation} = require('../src/core/visual-context.cjs');
const {OfferTracker} = require('../src/core/vision.cjs');

const window = () => ({hwnd:'1234', pid:42, dpi:144, foreground:true, visible:true, minimized:false,
  x:-1300, y:80, width:1296, height:759, clientRect:{x:-1292, y:111, width:1280, height:720}});
const frame = w => ({hwnd:w.hwnd, pid:w.pid, dpi:w.dpi, clientRect:{...w.clientRect}});

test('captured context is detached from mutable monitor geometry and handles negative screen coordinates', () => {
  const w=window(), context=visualContext(w);
  assert.equal(isCurrentVisualContext(context,w),true);
  assert.equal(captureMatchesContext(frame(w),context),true);
  w.clientRect.width=1920;
  assert.equal(context.rect.width,1280);
  assert.equal(isCurrentVisualContext(context,w),false);
});

test('window replacement, move, resize, DPI, visibility and focus changes invalidate pending work', () => {
  const context=visualContext(window());
  const changes=[w=>w.hwnd='4321',w=>w.pid=43,w=>w.dpi=192,w=>w.foreground=false,
    w=>w.visible=false,w=>w.minimized=true,w=>w.clientRect.x++,w=>w.clientRect.y++,
    w=>w.clientRect.width++,w=>w.clientRect.height++];
  for(const change of changes){
    const w=window();change(w);
    assert.equal(sameVisualContext(context,visualContext(w)),false);
    assert.equal(isCurrentVisualContext(context,w),false);
  }
  assert.equal(isCurrentVisualContext(context,null),false);
  assert.equal(visualContext({...window(),dpi:undefined}),null);
  assert.equal(visualContext({...window(),clientRect:null}),null);
  assert.equal(sameVisualContext(null,null),true);
});

test('fresh-looking capture with wrong process, geometry or DPI cannot match the requested observation', () => {
  const w=window(), context=visualContext(w);
  for(const change of [f=>f.hwnd='9999',f=>f.pid++,f=>f.dpi=96,f=>f.clientRect.x++,f=>f.clientRect.width++]){
    const f=frame(w);change(f);assert.equal(captureMatchesContext(f,context),false);
  }
  assert.equal(captureMatchesContext(frame(w),visualContext(w,false)),false);
});
test('unchanged window geometry cannot make an expired or invalid capture timestamp fresh', () => {
  const sample={capturedAt:new Date(10000).toISOString()};
  assert.equal(captureIsFresh(sample,12500),true);
  assert.equal(captureIsFresh(sample,12501),false);
  assert.equal(captureIsFresh(sample,14000,4000),true);
  assert.equal(captureIsFresh(sample,14001,4000),false);
  assert.equal(captureIsFresh(sample,9749),false);
  assert.equal(captureIsFresh({capturedAt:'invalid'},10000),false);
  assert.equal(captureIsFresh(null,10000),false);
});

test('first absent observation hides cards despite identical tracker output; second absence retains inferred pick semantics', () => {
  let now=0;const tracker=new OfferTracker({now:()=>now});
  const cards=[1,2,3].map((id,i)=>({id,name:String(id),rect:{x:i*.3,y:.2,width:.25,height:.4}}));
  const sample=n=>({cards,observedAt:String(n)});
  tracker.observe(sample(1),{active:true});now=100;
  tracker.observe(sample(2),{active:true});
  now=200;tracker.observe(sample(2),{active:true,x:.1,y:.3,leftPressed:true,leftDown:true,pressId:1});
  now=220;
  const stable=tracker.observe(sample(2),{active:true,leftDown:false,pressId:1});
  const before=trackingPresentation(stable,sample(2));
  now=1000;const absent1={cards:[],observedAt:'3'};
  const first=tracker.observe(absent1,{active:true,leftDown:false,pressId:1});
  assert.deepEqual(first,stable);
  const hidden=trackingPresentation(first,absent1);
  assert.notEqual(hidden.signature,before.signature);
  assert.equal(hidden.offer.present,false);
  assert.equal(hidden.offer.stable,true);
  assert.equal(first.selected.length,0);
  now=1900;
  const second=tracker.observe({cards:[],observedAt:'4'},{active:true,leftDown:false,pressId:1});
  assert.equal(second.selected.length,1);
  assert.equal(second.selected[0].confidence,'inferred');
  assert.equal(second.stable,false);
});
