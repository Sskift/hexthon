const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readOfferTitles,tightTitleRect,replaceSlot,titleInkGuard}=require('../src/core/title-reader.cjs');
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

test('a native-size same-strip retry merges only unresolved slots and never overwrites previously exact titles',async()=>{
  let calls=0;const initial=lines();initial[0].text='会心冶疗';
  const alternate=lines();alternate[1].text='错字';
  const options=[];
  const out=await readOfferTitles({...base,image:{getSize:()=>({width:600,height:60})},ocr:{read:async(_image,rect,_a,opts)=>{
    calls++;options.push({rect,opts});return {lines:calls===3?alternate:initial};
  }}});
  assert.equal(out.reads,3);assert.equal(options[2].opts.scale,1);
  assert.deepEqual(options[2].rect,{x:0,y:0,width:1,height:1});
  assert.deepEqual(out.offer.cards.map(card=>card.id),[1,2,3]);
  assert.ok(options.every(call=>call.opts.allowFallback===false));
});

test('retry budget stays at four even for invalid or excessive requested budgets',async()=>{
  for(const budget of [3,999,NaN,Infinity]){
    let calls=0;const out=await readOfferTitles({...base,maxExtraReads:budget,ocr:{read:async()=>{calls++;return {lines:[]};}}});
    assert.equal(calls,4);assert.equal(out.reads,4);assert.equal(out.offer.cards.length,0);
  }
  let calls=0;await readOfferTitles({...base,maxExtraReads:0,ocr:{read:async()=>{calls++;return {lines:[]};}}});
  assert.equal(calls,1);
});

test('tight title bounds preserve all supplied bright strokes and stay inside their original slot',()=>{
  const pixels=Buffer.alloc(100*60*4);for(let p=3;p<pixels.length;p+=4)pixels[p]=255;
  for(let y=25;y<35;y++)for(let x=20;x<80;x+=2){const p=(y*100+x)*4;pixels[p]=pixels[p+1]=pixels[p+2]=240;}
  const image={getSize:()=>({width:100,height:60}),toBitmap:()=>pixels},rect={x:0,y:0,width:1,height:1};
  const tight=tightTitleRect(image,rect);
  assert.ok(tight.width<rect.width&&tight.height<rect.height);
  assert.ok(tight.x<=.2&&tight.x+tight.width>=.79&&tight.y<=25/60&&tight.y+tight.height>=35/60);
  const flat={...image,toBitmap:()=>Buffer.alloc(100*60*4,255)};
  assert.deepEqual(tightTitleRect(flat,rect),rect);
});

test('slot replacement carries native line geometry through to later exact matching',()=>{
  const source={text:'一 起',x:.2,y:.2,width:.2,height:.3,words:[{text:'一',x:.2,y:.3,width:.08,height:.04},{text:'起',x:.3,y:.2,width:.08,height:.3}]};
  const replaced=replaceSlot([], [source],{x:0,y:0,width:1,height:1});
  assert.ok(replaced.every(word=>word.rowY===source.y&&word.rowHeight===source.height));
});

test('same-pixel contrast retry can recover multiple slots and leaves already exact words intact',async()=>{
  const calls=[],initial=lines();initial[0].text='会心冶疗';initial[1].text='小虫蜂';
  const retry=lines();retry[2].text='错误标题';
  const image={getSize:()=>({width:800,height:60}),toBitmap:()=>Buffer.alloc(800*60*4,255)};
  const out=await readOfferTitles({...base,image,ocr:{read:async(...args)=>{calls.push(args);return {lines:calls.length===1?initial:retry};}}});
  assert.equal(calls.length,2);assert.equal(calls[0][0],calls[1][0]);
  assert.deepEqual(calls[1][1],{x:0,y:0,width:1,height:1});assert.equal(calls[1][3].brightText,.86);
  assert.equal(calls[1][3].allowFallback,false);assert.deepEqual(out.offer.cards.map(card=>card.id),[1,2,3]);
});

test('uncovered title strokes reject an exact short-name hit instead of accepting a truncated longer title',()=>{
  const width=800,height=60,pixels=Buffer.alloc(width*height*4);
  for(let p=3;p<pixels.length;p+=4)pixels[p]=255;
  // Two separated groups of bright strokes in one title area. An OCR box over
  // only the first group cannot establish the complete title, even if its text
  // happens to equal a different valid, shorter catalog name.
  for(let y=18;y<30;y++)for(let x=70;x<180;x++)if(x%4<2){const p=(y*width+x)*4;pixels[p]=pixels[p+1]=pixels[p+2]=240;}
  const guard=titleInkGuard({getSize:()=>({width,height}),toBitmap:()=>pixels},region,geometry);
  const partial={...word('属性',0),width:.065},complete={...partial,width:.14};
  assert.equal(guard([partial],0),false);assert.equal(guard([complete],0),true);
  const shifted={...complete,y:.75};assert.equal(guard([shifted],0),false);
});

test('contrast retries still obey the four-read budget and invalidate when the window changes',async()=>{
  const image={getSize:()=>({width:800,height:60}),toBitmap:()=>Buffer.alloc(800*60*4,255)};
  let calls=0;
  const out=await readOfferTitles({...base,image,ocr:{read:async()=>{calls++;return {lines:[]};}}});
  assert.equal(out.reads,4);assert.equal(calls,4);
  let active=true;calls=0;
  await assert.rejects(readOfferTitles({...base,image,isCurrent:()=>active,ocr:{read:async()=>{if(++calls===2)active=false;return {lines:[]};}}}),/STALE/);
  assert.equal(calls,2);
});
