const {test}=require('node:test');
const assert=require('node:assert/strict');
const {layout,prepareTemplates,detectRerolls,fingerprint,fingerprintDistance,fingerprintChanged}=require('../src/core/scene-gate.cjs');
const WIDTH=2560,HEIGHT=1440;
function bitmap(width,height,value=24){const bgraBuffer=Buffer.alloc(width*height*4);for(let i=0;i<bgraBuffer.length;i+=4){bgraBuffer[i]=bgraBuffer[i+1]=bgraBuffer[i+2]=value;bgraBuffer[i+3]=255;}return{width,height,bgraBuffer};}
function texture(width=78,height=52,seed=13){
  const image=bitmap(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let random=Math.imul((x>>2)+1,0x1f123bb5)^Math.imul((y>>2)+1,0x5f356495)^seed;
    random^=random>>>16;random=Math.imul(random,0x7feb352d);random^=random>>>15;random=Math.imul(random,0x846ca68b);random^=random>>>16;
    const value=45+((random>>>0)%175),p=(y*width+x)*4;image.bgraBuffer[p]=image.bgraBuffer[p+1]=image.bgraBuffer[p+2]=value;
  }
  return image;
}
function roi(kind='rerollRegion',value=24){const region=layout(WIDTH,HEIGHT)[kind];return{...bitmap(Math.round(region.width*WIDTH),Math.round(region.height*HEIGHT),value),region,clientWidth:WIDTH,clientHeight:HEIGHT};}
function local(rect,image){return{x:Math.round((rect.x-image.region.x)/image.region.width*image.width),y:Math.round((rect.y-image.region.y)/image.region.height*image.height),width:Math.round(rect.width/image.region.width*image.width),height:Math.round(rect.height/image.region.height*image.height)};}
function paste(image,source,x,y){for(let sy=0;sy<source.height;sy++)for(let sx=0;sx<source.width;sx++){const p=((sy+y)*image.width+sx+x)*4;source.bgraBuffer.copy(image.bgraBuffer,p,(sy*source.width+sx)*4,(sy*source.width+sx)*4+4);}return image;}

test('height-scaled layout keeps three card/title/button regions in measured aspect ratios',()=>{
  for(const [w,h]of [[1024,768],[1280,1024],[1920,1080],[3440,1440],[3840,2160]]){
    const l=layout(w,h);assert.ok(l);
    for(const r of [...l.cards,...l.titles,...l.searches,l.rerollRegion,l.titleRegion]){
      assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=1&&r.y+r.height<=1);
    }
    assert.ok(Math.abs(l.titleRegion.y-.348)<1/h);assert.ok(Math.abs(l.titleRegion.y+l.titleRegion.height-.427)<2/h);
    assert.ok(l.rerollRegion.height<.054);assert.ok(l.rerollRegion.width*l.rerollRegion.height<.035);
  }
  assert.equal(layout(400,900),null);assert.equal(layout(NaN,1080),null);assert.equal(layout(300,250),null);
});

test('only a prepared textured template at the predicted button position opens the gate',()=>{
  const sample=texture(),templates=prepareTemplates([sample]),image=roi(),rect=local(layout(WIDTH,HEIGHT).rerolls[0],image);
  paste(image,sample,rect.x,rect.y);
  const result=detectRerolls(image,templates);
  assert.equal(result.present,true);assert.ok(result.score>.85);assert.equal(result.matches[0].slot,0);
  assert.equal('spent' in result,false);assert.equal('rerollsRemaining' in result,false);
});

test('search tolerance absorbs small alignment shifts, but a button between cards is ignored',()=>{
  const sample=texture(),templates=prepareTemplates([sample]),image=roi(),rect=local(layout(WIDTH,HEIGHT).rerolls[1],image);
  paste(image,sample,rect.x+3,rect.y-2);assert.equal(detectRerolls(image,templates).present,true);
  const wrong=roi();paste(wrong,sample,rect.x+170,rect.y);assert.equal(detectRerolls(wrong,templates).present,false);
});

test('constant black, constant gray and independent noise do not open the gate',()=>{
  const templates=prepareTemplates([texture()]);
  for(const value of [0,24,128,255])assert.equal(detectRerolls(roi('rerollRegion',value),templates).present,false);
  for(const seed of [5,7,11,29]){
    const image=roi(),noise=texture(image.width,image.height,seed);image.bgraBuffer=noise.bgraBuffer;
    assert.equal(detectRerolls(image,templates).present,false);
  }
});

test('missing pixels, clipped ROI, missing templates and malformed geometry remain absent',()=>{
  const templates=prepareTemplates([texture()]),image=roi();
  assert.equal(detectRerolls({...image,bgraBuffer:Buffer.alloc(10)},templates).present,false);
  assert.equal(detectRerolls({...image,region:{x:0,y:0,width:0,height:1}},templates).present,false);
  assert.equal(detectRerolls({...image,region:{x:0,y:0,width:1,height:.2}},templates).present,false);
  assert.equal(detectRerolls(image,[]).present,false);assert.equal(detectRerolls(image,[{}]).present,false);
  assert.deepEqual(prepareTemplates([bitmap(78,52),null,{width:2,height:3,bgraBuffer:Buffer.alloc(24)}]),[]);
});

test('striped title fingerprint notices one changed card without averaging it into the other two',()=>{
  const before=roi('titleRegion',0),after=roi('titleRegion',0),rect=local(layout(WIDTH,HEIGHT).titles[1],after);
  for(let y=rect.y+Math.ceil(rect.height*2/3);y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++){
    const p=(y*after.width+x)*4;after.bgraBuffer[p]=after.bgraBuffer[p+1]=after.bgraBuffer[p+2]=255;
  }
  const a=fingerprint(before),b=fingerprint(after);
  assert.equal(a.values.length,2304);assert.equal(fingerprintDistance(a,a),0);
  assert.ok(fingerprintDistance(a,b)>200);assert.equal(fingerprintChanged(a,b),true);
});

test('minor brightness noise can reuse OCR while unknown or resized contexts force a new reading',()=>{
  const a=fingerprint(roi('titleRegion',24)),b=fingerprint(roi('titleRegion',25));
  assert.equal(fingerprintChanged(a,b),false);assert.equal(fingerprintChanged(null,a),true);
  assert.equal(fingerprintDistance(a,{...a,clientWidth:1920}),255);
  assert.equal(fingerprintDistance(a,{...a,values:[]}),255);
  assert.equal(fingerprint({...roi('titleRegion'),bgraBuffer:Buffer.alloc(4)}),null);
});

test('gate and fingerprints do not modify supplied pixels',()=>{
  const image=roi(),before=Buffer.from(image.bgraBuffer),sample=texture(),copy=Buffer.from(sample.bgraBuffer);
  const templates=prepareTemplates([sample]);detectRerolls(image,templates);
  assert.deepEqual(image.bgraBuffer,before);assert.deepEqual(sample.bgraBuffer,copy);
  const titles=roi('titleRegion'),original=Buffer.from(titles.bgraBuffer);fingerprint(titles);assert.deepEqual(titles.bgraBuffer,original);
});
