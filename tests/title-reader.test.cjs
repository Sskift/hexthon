const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readOfferTitles}=require('../src/core/title-reader.cjs');
const region={x:.1,y:.3,width:.8,height:.12};
const geometry={titles:[.15,.45,.75].map(x=>({x,y:.3,width:.15,height:.12})),cards:[.12,.42,.72].map(x=>({x,y:.18,width:.21,height:.48}))};
const augments=[{id:1,name:'会心治疗'},{id:2,name:'小蜜蜂！！！'},{id:3,name:'升级：无尽之刃'}];
const word=(text,slot)=>({text,x:([.17,.47,.77][slot]-region.x)/region.width,y:.3,width:.1,height:.2});
const lines=()=>augments.map((a,i)=>word(a.name,i));
const base={image:{},region,geometry,augments,capturedAt:'same-frame'};
test('exact three titles do not pay for extra OCR',async()=>{
  let calls=0;const out=await readOfferTitles({...base,ocr:{read:async()=>{calls++;return {lines:lines()};}}});
  assert.equal(calls,1);assert.deepEqual(out.offer.cards.map(c=>c.id),[1,2,3]);
});
test('only the failed slot gets an enlarged retry and coordinates stay in the same title strip',async()=>{
  const calls=[];const initial=lines();initial[0].text='会心氵台疗';
  const out=await readOfferTitles({...base,ocr:{read:async(_image,rect,_a,options)=>{calls.push({rect,options});return {lines:calls.length===1?initial:[word(augments[0].name,0)]};}}});
  assert.equal(calls.length,2);assert.ok(calls[1].rect.width<.2);assert.equal(calls[1].options.scale,3);
  assert.equal(calls[1].options.allowFallback,false);assert.deepEqual(out.offer.cards.map(c=>c.id),[1,2,3]);
});
test('unreadable and fuzzy names stay absent within a strict retry budget',async()=>{
  let calls=0;const bad=lines();bad[0].text='会心冶疗';
  const out=await readOfferTitles({...base,ocr:{read:async()=>{calls++;return {lines:bad};}}});
  assert.equal(out.offer.cards.length,0);assert.ok(calls<=4);
});
test('a window change cancels retries and rejects an in-flight reading',async()=>{
  let active=true,calls=0;
  await assert.rejects(readOfferTitles({...base,isCurrent:()=>active,ocr:{read:async()=>{calls++;active=false;return {lines:lines()};}}}),/STALE/);
  assert.equal(calls,1);
});
