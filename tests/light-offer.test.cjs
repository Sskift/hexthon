const {test}=require('node:test');
const assert=require('node:assert/strict');
const {titleOffer}=require('../src/core/light-offer.cjs');
const region={x:.1,y:.34,width:.8,height:.1};
const geometry={titles:[.15,.45,.75].map(x=>({x,y:.34,width:.15,height:.1})),cards:[.12,.42,.72].map(x=>({x,y:.18,width:.21,height:.48}))};
const catalog=[{id:1,name:'会心治疗'},{id:2,name:'小蜜蜂！！！'},{id:3,name:'升级：无尽之刃'}];
function line(text,x,y=.5){return {text,x:(x-region.x)/region.width,y,width:.08,height:.2};}
function result(){return {lines:[line('会心治疗',.17),line('小蜜蜂！！！',.47),line('升级：无尽之刃',.77)]};}
test('title strip coordinates map back to three client cards with exact names',()=>{
  const out=titleOffer(result(),region,geometry,catalog,'sample-one');
  assert.deepEqual(out.cards.map(c=>c.id),[1,2,3]);
  assert.equal(out.observedAt,'sample-one');assert.equal(out.cards[0].titleRect.x,.17);
  assert.equal(out.cards[0].rect,geometry.cards[0]);
  assert.ok(out.cards.every(c=>c.selectionRect.y+c.selectionRect.height<c.rect.y+c.rect.height));
});
test('wrapped Chinese titles and minor word vertical offsets retain reading order',()=>{
  const r=result();r.lines[2]={words:[line('无尽之刃',.77,.5),line('升级：',.77,.1)]};
  assert.deepEqual(titleOffer(r,region,geometry,catalog,'x').cards.map(c=>c.id),[1,2,3]);
});
test('missing, fuzzy, repeated or ambiguous names do not become reliable cards',()=>{
  const missing=result();missing.lines.pop();assert.equal(titleOffer(missing,region,geometry,catalog,'x').cards.length,0);
  const fuzzy=result();fuzzy.lines[0].text='会心冶疗';assert.equal(titleOffer(fuzzy,region,geometry,catalog,'x').cards.length,0);
  const repeated=result();repeated.lines[1].text=catalog[0].name;assert.equal(titleOffer(repeated,region,geometry,catalog,'x').cards.length,0);
  assert.equal(titleOffer(result(),region,geometry,[...catalog,{id:4,name:catalog[0].name}],'x').cards.length,0);
});
test('out-of-band text and malformed boxes cannot supply a card title',()=>{
  const r=result();r.lines[0].y=2;assert.equal(titleOffer(r,region,geometry,catalog,'x').cards.length,0);
  r.lines[0].y=NaN;assert.equal(titleOffer(r,region,geometry,catalog,'x').cards.length,0);
  assert.equal(titleOffer(r,region,null,catalog,'x').cards.length,0);
});
