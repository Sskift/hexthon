const {test}=require('node:test');
const assert=require('node:assert/strict');
const {locateOffer,OfferTracker}=require('../src/core/vision.cjs');
const {normalizeOcrLines}=require('../src/core/ocr.cjs');
const augments=[{id:1,name:'魔法飞弹'},{id:2,name:'循环往复'},{id:3,name:'术士果汁盒'},{id:4,name:'珠光护手'}];
const titleLines=()=>augments.slice(0,3).map((a,i)=>({text:a.name,x:.22+i*.23,y:.37,width:.09,height:.028}));
const located=(stamp=1)=>locateOffer({lines:titleLines(),capturedAt:String(stamp)},augments);
const absent=stamp=>({cards:[],observedAt:String(stamp)});

test('OCR boxes map cropped/scaled pixel coordinates back to original game window',()=>{
  const lines=normalizeOcrLines([{text:'魔法飞弹',x:100,y:50,width:200,height:30}],{x:200,y:100,width:1400,height:600},{width:700,height:300},{width:2000,height:1000});
  assert.deepEqual(lines[0],{text:'魔法飞弹',x:.2,y:.2,width:.2,height:.06});
  assert.deepEqual(normalizeOcrLines([{text:'bad',x:NaN,y:0,width:1,height:2}],{x:0,y:0,width:1,height:1},{width:1,height:1},{width:1,height:1}),[]);
});
test('aligned exact card titles produce measured title boxes and conservative estimated card bodies',()=>{
  const offer=located();assert.deepEqual(offer.cards.map(a=>a.id),[1,2,3]);
  assert.ok(offer.cards.every(a=>a.estimated&&a.geometrySource==='ocr-title-grid'));
  assert.ok(offer.cards.every(a=>a.rect.y+a.rect.height<=.76));
  assert.equal(offer.cards[0].titleRect.x,.22);
});
test('geometry is normalized and unaffected by monitor DPI or negative desktop coordinates',()=>{
  const source=titleLines();
  for(const size of [{width:1920,height:1080},{width:3840,height:2160}]) {
    const pixel=source.map(b=>({...b,x:b.x*size.width,y:b.y*size.height,width:b.width*size.width,height:b.height*size.height}));
    const normalized=normalizeOcrLines(pixel,{x:0,y:0,...size},size,size);
    assert.deepEqual(locateOffer({lines:normalized},augments).cards.map(c=>c.id),[1,2,3]);
  }
});
test('spatial OCR word gaps split titles even when the engine combines them into one line',()=>{
  const words=titleLines();
  const offer=locateOffer({lines:[{text:words.map(w=>w.text).join(' '),x:.2,y:.37,width:.7,height:.028,words}]},augments);
  assert.deepEqual(offer.cards.map(c=>c.id),[1,2,3]);
});
test('descriptions, bottom HUD names, vertical lists, partial and duplicate titles cannot create offers',()=>{
  assert.equal(locateOffer({lines:titleLines().map(l=>({...l,text:'获得'+l.text+'效果'}))},augments).cards.length,0);
  assert.equal(locateOffer({lines:titleLines().map(l=>({...l,y:.86}))},augments).cards.length,0);
  assert.equal(locateOffer({lines:titleLines().map((l,i)=>({...l,x:.25,y:.25+i*.15}))},augments).cards.length,0);
  assert.equal(locateOffer({lines:titleLines().slice(0,2)},augments).cards.length,0);
  assert.equal(locateOffer({lines:titleLines().map(l=>({...l,text:'魔法飞弹'}))},augments).cards.length,0);
});
test('tracker requires two distinct OCR reads; pointer events do not count as observations',()=>{
  const t=new OfferTracker();const a=located(1);
  assert.equal(t.observe(a).stable,false);
  assert.equal(t.observe(a,{x:.3,y:.4}).stable,false);
  assert.equal(t.observe(located(2)).stable,true);
});
test('one missing OCR read retains offer and never finalizes a clicked selection',()=>{
  let now=0;const t=new OfferTracker({now:()=>now});t.observe(located(1));t.observe(located(2));
  const a=located(3);t.observe(a,{x:.27,y:.4,leftDown:true,active:true,pressId:1});now=1000;
  const r=t.observe(absent(4),{active:true,leftDown:false});assert.equal(r.selected.length,0);assert.equal(r.stable,true);
  assert.equal(t.observe(located(5),{active:true}).stable,true);
  assert.equal(t.pendingSelection,null);
});
test('card click followed by two absent frames yields only an explicitly inferred selection',()=>{
  let now=0;const t=new OfferTracker({now:()=>now});t.observe(located(1));const stable=located(2);t.observe(stable);
  t.observe(stable,{x:.27,y:.4,leftDown:true,leftPressed:true,active:true,pressId:1});now=1000;t.observe(absent(3),{active:true,leftDown:false});now=1800;
  const r=t.observe(absent(4),{active:true});assert.equal(r.cards.length,0);assert.equal(r.selected.length,1);assert.equal(r.selected[0].id,1);assert.equal(r.selected[0].confidence,'inferred');
  t.observe(absent(5),{active:true});assert.equal(t.selected.length,1);
});
test('reroll replacement, outside clicks and losing foreground do not infer selected augments',()=>{
  let now=0;const make=()=>{const t=new OfferTracker({now:()=>now});t.observe(located(1));t.observe(located(2));return t;};
  const t=make();t.observe(located(3),{x:.27,y:.4,leftDown:true,active:true});
  const next=located(4);next.cards[0]={...next.cards[0],id:4,name:'珠光护手'};
  t.observe(next,{active:true,leftDown:false});now=1000;t.observe(absent(5),{active:true});t.observe(absent(6),{active:true});assert.equal(t.selected.length,0);
  const u=make();u.observe(located(3),{x:.27,y:.9,leftDown:true,active:true});u.observe(absent(4),{active:true});u.observe(absent(5),{active:true});assert.equal(u.selected.length,0);
  const v=make();v.observe(located(3),{x:.27,y:.4,leftDown:true,active:true});v.observe(absent(4),{active:false});v.observe(absent(5),{active:true});v.observe(absent(6),{active:true});assert.equal(v.selected.length,0);
});
test('lower card edge never supplies click evidence because it may contain reroll controls',()=>{
  let now=0;const t=new OfferTracker({now:()=>now});t.observe(located(1));const offer=located(2);t.observe(offer);
  const card=offer.cards[0];t.observe(offer,{x:card.rect.x+card.rect.width/2,y:card.rect.y+card.rect.height*.95,leftDown:true,active:true});
  assert.equal(t.pendingSelection,null);now=1000;t.observe(absent(3),{active:true});now=1800;t.observe(absent(4),{active:true});assert.equal(t.selected.length,0);
});
test('stale OCR geometry cannot accept a click or infer selection after an observation outage',()=>{
  let now=0;const t=new OfferTracker({now:()=>now});t.observe(located(1));const offer=located(2);t.observe(offer);
  now=20000;const r=t.observe(offer,{x:.27,y:.4,leftDown:true,leftPressed:true,active:true,pressId:1});
  assert.equal(r.stable,false);assert.equal(r.changed,true);assert.equal(r.pendingSelection,null);
  now=21000;t.observe(absent(3),{active:true,leftDown:false});now=22000;t.observe(absent(4),{active:true});
  assert.equal(t.selected.length,0);
});
test('expiry uses processing time and repeated pointer observations never refresh the TTL',()=>{
  let now=100;const t=new OfferTracker({observationTtlMs:1000,now:()=>now});
  t.observe(located('2099-01-01T00:00:00.000Z'));const offer=located('2099-01-01T00:00:01.000Z');t.observe(offer);
  now=900;assert.equal(t.observe(offer,{x:.27,y:.4}).stable,true);
  now=1101;assert.equal(t.expire().stable,false);
  assert.equal(t.observe(offer,{x:.27,y:.4,leftDown:true,active:true}).pendingSelection,null);
  assert.equal(t.observe(offer).stable,false);
  assert.equal(t.observe(located('new-1')).stable,false);
  assert.equal(t.observe(located('new-2')).stable,true);
});
test('explicit invalidation clears pending clicks, retains inferred history and requires fresh reads',()=>{
  let now=0;const t=new OfferTracker({now:()=>now});t.observe(located(1));const first=located(2);t.observe(first);
  t.observe(first,{x:.27,y:.4,leftDown:true,active:true});now=1000;t.observe(absent(3),{active:true,leftDown:false});now=1800;t.observe(absent(4),{active:true});
  assert.equal(t.selected.length,1);
  t.observe(located(5));const next=located(6);t.observe(next);t.observe(next,{x:.27,y:.4,leftDown:true,active:true});
  const r=t.invalidate();assert.equal(r.stable,false);assert.equal(r.pendingSelection,null);assert.equal(r.selected.length,1);
  assert.equal(t.observe(next).stable,false);assert.equal(t.observe(next).stable,false);
  now=2800;t.observe(absent(7),{active:true});now=3600;t.observe(absent(8),{active:true});assert.equal(t.selected.length,1);
});
test('a candidate read older than the TTL cannot combine with a new read to gain stability',()=>{
  let now=0;const t=new OfferTracker({now:()=>now});t.observe(located(1));now=7000;
  assert.equal(t.observe(located(2)).stable,false);assert.equal(t.observe(located(3)).stable,true);
});
