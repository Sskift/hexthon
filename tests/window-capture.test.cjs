const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {PassThrough,Writable} = require('node:stream');
const {WindowCapture,validateCaptureRequest,MAX_DIMENSION} = require('../src/core/window-capture.cjs');

// Protocol-only workers. No PowerShell, screen capture, input or window API is
// invoked by these tests; all BGRA pixels and client geometry are synthetic.
function fakeWorker() {
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.requests=[];child.killed=false;
  child.stdin=new Writable({write(chunk,_encoding,done){
    const length=chunk.readUInt32LE(0);assert.equal(length,chunk.length-4);
    child.requests.push(JSON.parse(chunk.subarray(4).toString('utf8')));done();
  }});
  child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit('close',0));};
  return child;
}
function workerFactory() {
  const calls=[],children=[];
  return {calls,children,spawnProcess(...args){calls.push(args);const child=fakeWorker();children.push(child);return child;}};
}
function reply(child,request,overrides={},chunks=false) {
  const clientRect={x:-1920,y:100,width:1920,height:1080};
  const region=request.region;
  const pixelRegion={x:Math.floor(region.x*1920),y:Math.floor(region.y*1080),
    width:Math.ceil((region.x+region.width)*1920)-Math.floor(region.x*1920),
    height:Math.ceil((region.y+region.height)*1080)-Math.floor(region.y*1080)};
  const aligned={x:pixelRegion.x/1920,y:pixelRegion.y/1080,width:pixelRegion.width/1920,height:pixelRegion.height/1080};
  const width=Math.min(4,request.maxWidth),height=2;
  const body=Buffer.alloc(width*height*4,42);
  const header={id:request.id,ok:true,hwnd:request.hwnd,pid:111,width,height,byteLength:body.length,
    clientRect,pixelRegion,region:aligned,dpi:144,capturedAt:'2026-11-02T00:00:00.000Z',durationMs:2,...overrides};
  const json=Buffer.from(JSON.stringify(header));const prefix=Buffer.alloc(4);prefix.writeUInt32LE(json.length);
  const packet=Buffer.concat([prefix,json,header.ok===false?Buffer.alloc(0):body]);
  if(chunks)for(let index=0;index<packet.length;index+=7)child.stdout.write(packet.subarray(index,index+7));
  else child.stdout.write(packet);
  return {header,body};
}

test('capture validates a known positive HWND and bounded normalized ROI before spawning anything',async()=>{
  const factory=workerFactory(),capture=new WindowCapture(factory);
  for(const options of [{},{hwnd:'0'},{hwnd:'0x123'},{hwnd:'9223372036854775808'},{hwnd:Number.MAX_SAFE_INTEGER+1},
    {hwnd:'42',region:{x:.8,y:0,width:.3,height:1}},{hwnd:'42',region:{x:0,y:0,width:NaN,height:1}},
    {hwnd:'42',maxWidth:MAX_DIMENSION+1},{hwnd:'42',maxWidth:0}])await assert.rejects(capture.capture(options),/WINDOW_CAPTURE_/);
  assert.equal(factory.calls.length,0);
  assert.deepEqual(validateCaptureRequest({hwnd:42}),{hwnd:'42',region:{x:0,y:0,width:1,height:1},maxWidth:1600});
  await capture.close();
});

test('a hidden worker captures only the supplied client ROI and handles fragmented binary replies',async()=>{
  const factory=workerFactory(),capture=new WindowCapture(factory);
  const expected={hwnd:'1234',region:{x:.101,y:.2,width:.31,height:.4},maxWidth:900};
  const pending=capture.capture(expected),child=factory.children[0],request=child.requests[0];
  assert.deepEqual(request,{id:1,...expected});
  assert.equal(factory.calls[0][2].windowsHide,true);
  assert.equal(factory.calls[0][0],'powershell.exe');
  assert.ok(factory.calls[0][1].some(arg=>arg.endsWith('window-capture.ps1')));
  const response=reply(child,request,{},true),result=await pending;
  assert.deepEqual(result.bgraBuffer,response.body);
  assert.equal(result.clientRect.x,-1920);
  assert.equal(result.dpi,144);
  assert.equal(result.region.x,result.pixelRegion.x/result.clientRect.width);
  assert.equal(result.region.width,result.pixelRegion.width/result.clientRect.width);
  assert.notEqual(result.region.x,expected.region.x,'Pixel alignment must be reflected in the normalized metadata');
  assert.equal(result.width,4);
  await capture.close();assert.equal(child.killed,true);
});

test('one worker is reused and concurrent capture requests are rejected instead of queued',async()=>{
  const factory=workerFactory(),capture=new WindowCapture(factory);
  const first=capture.capture({hwnd:'1234'}),child=factory.children[0];
  await assert.rejects(capture.capture({hwnd:'1234'}),/BUSY/);
  reply(child,child.requests[0]);await first;
  const second=capture.capture({hwnd:'1234',region:{x:.2,y:.2,width:.5,height:.5}});
  reply(child,child.requests[1]);await second;
  assert.equal(factory.children.length,1);assert.equal(capture.starts,1);
  await capture.close();
});

test('foreground and visibility rejection returns no pixels and keeps the helper reusable',async()=>{
  const factory=workerFactory(),capture=new WindowCapture(factory);
  const first=capture.capture({hwnd:'1234'}),child=factory.children[0];
  reply(child,child.requests[0],{ok:false,error:'NOT_FOREGROUND',byteLength:0});
  await assert.rejects(first,/WINDOW_CAPTURE_NOT_FOREGROUND/);
  assert.equal(child.killed,false);
  const second=capture.capture({hwnd:'1234'});reply(child,child.requests[1]);await second;
  assert.equal(factory.children.length,1);await capture.close();
});

test('corrupt dimensions, IDs and ROI metadata are rejected and cannot deliver pixels',async()=>{
  for(const override of [{id:999},{hwnd:'777'},{byteLength:999999999},{width:0},{dpi:0},
    {clientRect:{x:0,y:0,width:0,height:1080}},{pixelRegion:{x:0,y:0,width:1,height:1}},
    {region:{x:0,y:0,width:100,height:1}}]){
    const factory=workerFactory(),capture=new WindowCapture(factory);
    const pending=capture.capture({hwnd:'1234'}),child=factory.children[0];reply(child,child.requests[0],override);
    await assert.rejects(pending,/WINDOW_CAPTURE_PROTOCOL/);assert.equal(child.killed,true);await capture.close();
  }
});

test('oversized frame headers fail before any image allocation',async()=>{
  const factory=workerFactory(),capture=new WindowCapture(factory);
  const pending=capture.capture({hwnd:'1234'}),child=factory.children[0];
  const prefix=Buffer.alloc(4);prefix.writeUInt32LE(1000000000);child.stdout.write(prefix);
  await assert.rejects(pending,/PROTOCOL/);assert.equal(child.killed,true);await capture.close();
});

test('timeout kills the owned helper, enforces a cooldown and ignores its late close',async()=>{
  let now=100;const factory=workerFactory(),capture=new WindowCapture({...factory,timeoutMs:50,retryMs:10,now:()=>now});
  const pending=capture.capture({hwnd:'1234'}),old=factory.children[0];
  await assert.rejects(pending,/TIMEOUT/);assert.equal(old.killed,true);
  await assert.rejects(capture.capture({hwnd:'1234'}),/COOLDOWN/);
  now=111;const next=capture.capture({hwnd:'1234'}),child=factory.children[1];
  old.emit('close',0);reply(child,child.requests[0]);await next;
  assert.equal(child.killed,false);await capture.close();
});

test('close rejects in-flight work and permanently prevents new capture',async()=>{
  const factory=workerFactory(),capture=new WindowCapture(factory);
  const pending=capture.capture({hwnd:'1234'}),rejected=assert.rejects(pending,/CLOSED/);
  await capture.close();await rejected;
  await assert.rejects(capture.capture({hwnd:'1234'}),/CLOSED/);
  assert.equal(factory.children[0].killed,true);
});

test('helper diagnostics and extra response fields are not copied into the result',async()=>{
  const factory=workerFactory(),capture=new WindowCapture(factory);
  const pending=capture.capture({hwnd:'1234'}),child=factory.children[0];
  reply(child,child.requests[0],{secret:'private-token',clientRect:{x:-1920,y:100,width:1920,height:1080,name:'private-name'}});
  assert.doesNotMatch(JSON.stringify(await pending),/private-/);
  const failed=capture.capture({hwnd:'1234'});reply(child,child.requests[1],{ok:false,error:'private-path-and-token',byteLength:0});
  await assert.rejects(failed,error=>error.message==='WINDOW_CAPTURE_CAPTURE_FAILED');await capture.close();
});
