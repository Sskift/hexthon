const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {WindowsOcrWorker,OcrReader}=require('../src/core/ocr.cjs');

function harness(options={}){
  const children=[],launches=[];
  const spawnProcess=(...args)=>{
    launches.push(args);
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new EventEmitter();child.writes=[];
    child.stdin.write=value=>{child.writes.push(value);return true;};
    child.stdin.destroy=()=>{child.inputDestroyed=true;};
    child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit('close',0));return true;};
    children.push(child);return child;
  };
  return {worker:new WindowsOcrWorker({spawnProcess,...options}),children,launches};
}
const pixels=()=>Buffer.alloc(8*6*4,255),size={width:8,height:6};
const header=(child,index=0)=>JSON.parse(child.writes[index*2]);
const success=(child,id,text='测试')=>child.stdout.write(JSON.stringify({id,ok:true,text,lines:[],recognitionMs:3})+'\n');

test('native OCR is lazy, hidden and reuses one process with framed BGRA requests',async()=>{
  const h=harness();assert.equal(h.launches.length,0);
  const firstPixels=pixels(),first=h.worker.recognize(firstPixels,size),child=h.children[0];
  assert.equal(h.launches[0][2].windowsHide,true);
  assert.ok(h.launches[0][1].includes('-Worker'));
  assert.deepEqual(header(child),{id:1,width:8,height:6,byteLength:firstPixels.length});
  assert.equal(child.writes[1],firstPixels);
  child.stdout.write('{"ready":true,"protocol":1}\n');success(child,1);assert.equal((await first).text,'测试');
  const second=h.worker.recognize(pixels(),size);success(child,header(child,1).id,'第二次');
  assert.equal((await second).text,'第二次');assert.equal(h.launches.length,1);
  await h.worker.close();assert.equal(child.killed,true);assert.equal(child.inputDestroyed,true);
});

test('malformed or oversized bitmap frames never launch a helper',async()=>{
  const h=harness();
  for(const [data,dimensions] of [[pixels(),{width:0,height:6}],[pixels(),{width:2201,height:6}],[pixels(),{width:8.5,height:6}],[Buffer.alloc(3),size],[new Uint8Array(192),size]]){
    await assert.rejects(h.worker.recognize(data,dimensions),/BITMAP/);
  }
  assert.equal(h.launches.length,0);await h.worker.close();
});

test('one request at a time prevents stale backlog and fragmented output is assembled',async()=>{
  const h=harness(),first=h.worker.recognize(pixels(),size),child=h.children[0];
  await assert.rejects(h.worker.recognize(pixels(),size),/BUSY/);
  child.stdout.write('{"id":1,"ok":true,"text":"');child.stdout.write('分段","lines":[]}\n');
  assert.equal((await first).text,'分段');assert.equal(child.writes.length,2);await h.worker.close();
});

test('mismatched request IDs cannot satisfy the current recognition',async()=>{
  const h=harness(),request=h.worker.recognize(pixels(),size),child=h.children[0];let resolved=false;
  request.then(()=>{resolved=true;});success(child,999,'stale');await Promise.resolve();assert.equal(resolved,false);
  success(child,1);assert.equal((await request).text,'测试');await h.worker.close();
});

test('timeout kills the helper, applies retry cooldown and allows a later clean process',async()=>{
  let now=100;const h=harness({timeoutMs:15,retryMs:1000,now:()=>now});
  await assert.rejects(h.worker.recognize(pixels(),size),/TIMEOUT/);assert.equal(h.children[0].killed,true);
  await assert.rejects(h.worker.recognize(pixels(),size),/COOLDOWN/);assert.equal(h.launches.length,1);
  now=1101;const request=h.worker.recognize(pixels(),size);h.children[0].emit('close',0);
  success(h.children[1],2);await request;assert.equal(h.worker.starts,2);await h.worker.close();
});

test('process exit and startup error reject active work without exposing native details',async()=>{
  for(const event of ['close','error']){
    const h=harness(),request=h.worker.recognize(pixels(),size);h.children[0].emit(event,new Error('private path'));
    await assert.rejects(request,error=>/NATIVE_OCR_(EXIT|START)/.test(error.message)&&!error.message.includes('private'));
    assert.equal(h.worker.pending,null);await h.worker.close();
  }
});

test('invalid JSON, protocol failures and output floods kill a confused helper',async()=>{
  for(const output of ['{broken}\n',JSON.stringify({id:1,ok:false,error:'private path'})+'\n','x'.repeat(512001)]){
    const h=harness(),request=h.worker.recognize(pixels(),size);h.children[0].stdout.write(output);
    await assert.rejects(request,/NATIVE_OCR_(PROTOCOL|FAILED|OUTPUT_LIMIT)/);assert.equal(h.children[0].killed,true);await h.worker.close();
  }
});

test('closing an in-flight reader rejects it and never restarts the helper',async()=>{
  const h=harness(),request=h.worker.recognize(pixels(),size);const rejected=assert.rejects(request,/CLOSED/);
  await h.worker.close();await rejected;await h.worker.close();
  await assert.rejects(h.worker.recognize(pixels(),size),/CLOSED/);assert.equal(h.launches.length,1);
});

test('native OcrReader hot path does not encode a PNG or touch the image cache', {skip:process.platform!=='win32'},async()=>{
  let closed=false,calls=0;
  const nativeWorker={starts:1,recognize:async(bitmap,dimensions)=>{calls++;assert.equal(bitmap.length,dimensions.width*dimensions.height*4);return {text:'魔法飞弹',lines:[],recognitionMs:2};},close:async()=>{closed=true;}};
  const image={getSize:()=>({width:640,height:360}),crop(){return this;},resize(){return this;},toBitmap:()=>Buffer.alloc(640*360*4),toPNG(){throw new Error('PNG encoding must not run');}};
  const reader=new OcrReader('uncreated-test-image-cache',()=>{},null,{nativeWorker});
  const result=await reader.read(image,{x:0,y:0,width:1,height:1},[{id:1,name:'魔法飞弹'}]);
  assert.equal(result.engine,'windows');assert.equal(result.timings.engineMs,2);assert.equal(calls,1);assert.equal(reader.busy,false);
  await reader.close();assert.equal(closed,true);await assert.rejects(reader.read(image,{},[]),/关闭/);
});

test('closing OcrReader during native recognition prevents a Tesseract fallback', {skip:process.platform!=='win32'},async()=>{
  let rejectNative;
  const nativeWorker={recognize:()=>new Promise((_,reject)=>{rejectNative=reject;}),close:async()=>rejectNative(new Error('NATIVE_OCR_CLOSED'))};
  const image={getSize:()=>({width:640,height:360}),crop(){return this;},resize(){return this;},toBitmap:()=>Buffer.alloc(640*360*4)};
  const reader=new OcrReader('uncreated-test-image-cache',()=>{},null,{nativeWorker});
  reader.init=async()=>{assert.fail('Tesseract must not initialize after close');};
  const result=reader.read(image,{x:0,y:0,width:1,height:1},[]),rejected=assert.rejects(result,/关闭/);
  await reader.close();await rejected;assert.equal(reader.busy,false);
});

test('the light title path accepts a thin strip and never initializes fallback on native failure', {skip:process.platform!=='win32'},async()=>{
  let calls=0;
  const nativeWorker={recognize:async()=>{calls++;throw new Error('NATIVE_OCR_COOLDOWN');},close:async()=>{}};
  const image={getSize:()=>({width:1200,height:85}),crop(){return this;},resize(){return this;},toBitmap:()=>Buffer.alloc(1200*85*4),toPNG(){assert.fail('light path must not encode PNG');}};
  const reader=new OcrReader('uncreated-test-image-cache',()=>{},null,{nativeWorker});
  reader.init=async()=>{assert.fail('light path must not initialize Tesseract');};
  await assert.rejects(reader.read(image,{x:0,y:0,width:1,height:1},[],{allowSmall:true,allowFallback:false}),/轻量模式等待恢复/);
  assert.equal(calls,1);assert.equal(reader.busy,false);await reader.close();
});
