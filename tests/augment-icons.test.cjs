const {test}=require('node:test');
const assert=require('node:assert/strict');
const {HUD_REGION,prepareTemplates,matchAugmentIcons,AugmentIconTracker}=require('../src/core/augment-icons.cjs');
const {AugmentIconWorker}=require('../src/core/augment-icon-worker.cjs');
function bitmap(width,height,color=[130,140,180]){const bgraBuffer=Buffer.alloc(width*height*4);for(let p=0;p<bgraBuffer.length;p+=4){bgraBuffer[p]=color[2];bgraBuffer[p+1]=color[1];bgraBuffer[p+2]=color[0];bgraBuffer[p+3]=255;}return{width,height,bgraBuffer};}
function icon(kind){const image=bitmap(24,24,[16,34,28]);for(let y=4;y<20;y++)for(let x=4;x<20;x++){const white=kind===1?Math.abs(x-12)<3||Math.abs(y-12)<3:Math.abs(x-y)<2||Math.abs(x+y-23)<2;if(white){const p=(y*24+x)*4;image.bgraBuffer[p]=210;image.bgraBuffer[p+1]=235;image.bgraBuffer[p+2]=245;}}return image;}
function paste(frame,image,x,y){for(let yy=0;yy<image.height;yy++)image.bgraBuffer.copy(frame.bgraBuffer,((y+yy)*frame.width+x)*4,yy*image.width*4,(yy+1)*image.width*4);}
const templates=prepareTemplates([{id:1,name:'Cross',image:icon(1)},{id:2,name:'Diagonal',image:icon(2)}]);
function scene(x=200,y=540){const image=bitmap(800,600);paste(image,icon(1),x,y);paste(image,icon(2),x+34,y);paste(image,bitmap(24,24,[16,34,28]),x+68,y);return image;}
const hit=(id=1,x=.25)=>({id,name:`Augment ${id}`,score:.97,margin:.08,confidence:'visual',rect:{x,y:.9,width:.03,height:.04}});

test('pixel matcher reads only aligned own HUD slots and returns explicit visual evidence',()=>{
  const result=matchAugmentIcons(scene(),templates,{observedAt:'one'});
  assert.deepEqual(result.matches.map(m=>m.id),[1,2]);
  assert.ok(result.matches.every(m=>m.confidence==='visual'&&m.score>.94&&m.margin>.032));
  assert.equal(matchAugmentIcons(scene(500,540),templates).matches.length,0,'Other screen regions are not own augment evidence');
  assert.equal(matchAugmentIcons(scene(200,100),templates).matches.length,0,'Floating combat icons are ignored');
});
test('blank, incomplete bitmaps and empty slots cannot produce selections',()=>{
  assert.deepEqual(matchAugmentIcons(null,templates).matches,[]);
  assert.deepEqual(matchAugmentIcons({width:800,height:600,bgraBuffer:Buffer.alloc(4)},templates).matches,[]);
  assert.deepEqual(matchAugmentIcons(bitmap(800,600),templates).matches,[]);
});
test('identical generic OP.GG icon artwork cannot choose between augment IDs',()=>{
  const ambiguous=prepareTemplates([{id:1,name:'One',image:icon(1)},{id:9,name:'Shared art',image:icon(1)},{id:2,name:'Two',image:icon(2)}]);
  assert.equal(ambiguous[0].entries.length,2);
  assert.deepEqual(matchAugmentIcons(scene(),ambiguous).matches.map(m=>m.id),[2]);
});
test('two distinct positive frames are required and old samples cannot accumulate',()=>{
  const tracker=new AugmentIconTracker();
  assert.equal(tracker.observe({observedAt:'a',matches:[hit()]}).selected.length,0);
  assert.equal(tracker.observe({observedAt:'a',matches:[hit()]}).selected.length,0);
  assert.equal(tracker.observe({observedAt:'b',matches:[hit()]}).selected[0].confidence,'visual');
  assert.equal(tracker.observe({observedAt:'c',matches:[]}).selected.length,1,'Temporary HUD occlusion keeps established history');
  assert.equal(tracker.reset().selected.length,0);
});
test('low confidence, weak margin and positions outside own HUD are rejected',()=>{
  const tracker=new AugmentIconTracker();const values=[{...hit(),score:.93},{...hit(),margin:.01},{...hit(),score:Infinity},hit(2,.7)];
  tracker.observe({observedAt:'a',matches:values});assert.equal(tracker.observe({observedAt:'b',matches:values}).selected.length,0);
});
test('focus loss and long gaps prevent observations on different occasions being combined',()=>{
  let now=0;const tracker=new AugmentIconTracker({now:()=>now});
  tracker.observe({observedAt:'a',matches:[hit()]});now=10000;
  assert.equal(tracker.observe({observedAt:'b',matches:[hit()]}).selected.length,0);
  tracker.observe({observedAt:'c',matches:[hit()]},{active:false});
  assert.equal(tracker.observe({observedAt:'d',matches:[hit()]}).selected.length,0);
});
test('a stable replacement reports the old slot ID without erasing other selected slots',()=>{
  const tracker=new AugmentIconTracker();for(const stamp of ['a','b'])tracker.observe({observedAt:stamp,matches:[hit(1),hit(2,.3)]});
  tracker.observe({observedAt:'c',matches:[hit(3),hit(2,.3)]});
  const result=tracker.observe({observedAt:'d',matches:[hit(3),hit(2,.3)]});
  assert.deepEqual(result.replacedIds,[1]);assert.deepEqual(result.selected.map(m=>m.id).sort(),[2,3]);
});

function grid(){const image=scene();for(let col=0;col<3;col++)paste(image,bitmap(24,24,[16,34,28]),200+col*34,574);return image;}
function hudCrop(frame){
  const x=Math.round(frame.width*HUD_REGION.x),y=Math.round(frame.height*HUD_REGION.y),width=Math.round(frame.width*HUD_REGION.width),height=Math.round(frame.height*HUD_REGION.height);
  const bgraBuffer=Buffer.alloc(width*height*4);
  for(let row=0;row<height;row++)frame.bgraBuffer.copy(bgraBuffer,row*width*4,((y+row)*frame.width+x)*4,((y+row)*frame.width+x+width)*4);
  return{width,height,bgraBuffer,region:{...HUD_REGION},clientRect:{width:frame.width,height:frame.height},capturedAt:'sample-one'};
}
test('small captured HUD ROI gives the same client coordinates and canonical slots as a full image',()=>{
  const full=matchAugmentIcons(grid(),templates),cropped=matchAugmentIcons(hudCrop(grid()),templates);
  assert.deepEqual(cropped.matches.map(m=>[m.id,m.slot]),[[1,'hud:0'],[2,'hud:1']]);
  for(let i=0;i<full.matches.length;i++)for(const key of ['x','y','width','height'])assert.ok(Math.abs(full.matches[i].rect[key]-cropped.matches[i].rect[key])<.000001);
  assert.equal(cropped.complete,false);
});
test('partial HUD occlusion cannot renumber remaining icons or imply an empty loadout',()=>{
  const image=grid();paste(image,bitmap(24,24),200,540);
  const result=matchAugmentIcons(hudCrop(image),templates);
  assert.deepEqual(result.matches.map(m=>[m.id,m.slot]),[[2,'hud:1']]);
  assert.equal(result.complete,false);
  const oneRow=matchAugmentIcons(hudCrop(scene()),templates);
  assert.ok(oneRow.matches.every(m=>m.slot===null),'one row alone cannot prove its logical row number');
});
test('canonical slot replacement survives HUD movement, while unknown slots retain geometry safety',()=>{
  const tracker=new AugmentIconTracker();
  for(const observedAt of ['a','b'])tracker.observe({observedAt,matches:[{...hit(1,.25),slot:'hud:0'}]});
  for(const observedAt of ['c','d'])tracker.observe({observedAt,matches:[{...hit(2,.30),slot:'hud:0'}]});
  assert.deepEqual(tracker.snapshot().selected.map(m=>m.id),[2]);
  assert.deepEqual(tracker.snapshot().replacedIds,[1]);
});
test('worker is lazy, processes supplied ROI off-thread, refuses overlap and closes permanently',async()=>{
  const worker=new AugmentIconWorker({templates});assert.equal(worker.worker,null);
  const frame=hudCrop(grid()),original=Buffer.from(frame.bgraBuffer),pending=worker.read(frame);
  await assert.rejects(worker.read(frame),/BUSY/);
  const result=await pending;
  assert.deepEqual(result.matches.map(m=>[m.id,m.slot]),[[1,'hud:0'],[2,'hud:1']]);
  assert.equal(result.observedAt,'sample-one');assert.deepEqual(frame.bgraBuffer,original);
  const processWorker=worker.worker;await worker.read({...frame,capturedAt:'sample-two'});assert.equal(worker.worker,processWorker);
  await worker.close();await assert.rejects(worker.read(frame),/CLOSED/);
});
test('worker timeout and close reject in-flight work and terminate only the owned worker',async()=>{
  const {EventEmitter}=require('node:events');const workers=[];
  const createWorker=()=>{const fake=new EventEmitter();fake.ref=fake.unref=()=>{};fake.postMessage=()=>{};fake.terminated=0;
    fake.terminate=async()=>{fake.terminated++;};workers.push(fake);return fake;};
  const worker=new AugmentIconWorker({templates,timeoutMs:50,createWorker});
  await assert.rejects(worker.read({...hudCrop(grid()),bgraBuffer:Buffer.alloc(3)}),/BITMAP/);assert.equal(workers.length,0);
  await assert.rejects(worker.read(hudCrop(grid())),/TIMEOUT/);assert.equal(workers[0].terminated,1);
  const pending=worker.read(hudCrop(grid())),rejected=assert.rejects(pending,/CLOSED/);
  await worker.close();await rejected;assert.equal(workers[1].terminated,1);assert.equal(worker.worker,null);
});
