const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8');
const start=code.indexOf('function recognitionView('),end=code.indexOf('\nfunction tier(',start);
assert.ok(start>=0&&end>start);
const recognitionView=vm.runInNewContext(code.slice(start,end)+'\nrecognitionView;');
const runtimeWarnings=vm.runInNewContext(code.slice(start,end)+'\nruntimeWarnings;');
const snapshot={recognitionMode:'visual-light',settings:{autoScan:true,autoOverlay:true},ocr:{status:'idle'},autoStatus:'已连接对局，自动监测强化卡片'};

test('pause status takes precedence over a generic poll status and disables manual scan',()=>{
  const view=recognitionView({...snapshot,settings:{autoScan:false,autoOverlay:true},overlayEnabled:true});
  assert.equal(view.paused,true);assert.equal(view.scanDisabled,true);assert.equal(view.chip,'PAUSED');
  assert.equal(view.toggleLabel,'恢复识别与提示');assert.match(view.status,/已暂停/);assert.doesNotMatch(view.status,/自动监测/);
});
test('hiding overlays cannot invert the running recognition toggle',()=>{
  const view=recognitionView({...snapshot,settings:{autoScan:true,autoOverlay:false},overlayEnabled:false});
  assert.equal(view.paused,false);assert.equal(view.toggleLabel,'暂停自动识别');assert.equal(view.scanDisabled,false);
  assert.equal(recognitionView({...snapshot,settings:{autoScan:false,autoOverlay:false}}).toggleLabel,'恢复自动识别');
});

test('legacy visual mode describes its overlay-only toggle without claiming to pause recognition',()=>{
  assert.equal(recognitionView({...snapshot,recognitionMode:'visual',overlayEnabled:true}).toggleLabel,'隐藏场景提示');
  assert.equal(recognitionView({...snapshot,recognitionMode:'visual',overlayEnabled:false}).toggleLabel,'显示场景提示');
});
test('an OCR error remains visible despite a generic API success message and clears on recovery',()=>{
  const failed=recognitionView({...snapshot,ocr:{status:'error',message:'NATIVE_OCR_COOLDOWN'}});
  assert.equal(failed.failure,true);assert.equal(failed.chip,'RETRY');assert.match(failed.status,/Windows 文字识别暂不可用/);
  const recovered=recognitionView(snapshot);assert.equal(recovered.failure,false);assert.equal(recovered.error,'');assert.equal(recovered.chip,'AUTO');
});
test('API mode and a deliberate pause never present a stale OCR failure as an active retry',()=>{
  for(const state of [{...snapshot,recognitionMode:'api'},{...snapshot,settings:{autoScan:false}}]){
    const view=recognitionView({...state,ocr:{status:'error',message:'WINDOW_CAPTURE_TIMEOUT'}});
    assert.equal(view.failure,false);assert.equal(view.error,'');assert.equal(view.scanDisabled,true);
  }
  const running=recognitionView({...snapshot,ocr:{status:'running'}});assert.equal(running.scanDisabled,true);
});
test('connection, monitor and persistence failures are surfaced independently and disappear after state recovery',()=>{
  const warnings=runtimeWarnings({...snapshot,connectionError:'本地接口暂不可用',monitorError:'窗口监控无法启动',selectionRecovery:{saveFailed:true}});
  assert.ok(warnings.includes('本地接口暂不可用'));assert.ok(warnings.includes('窗口监控无法启动'));
  assert.ok(warnings.some(message=>message.includes('记录保存失败')));
  assert.equal(runtimeWarnings(snapshot).length,0);
  assert.equal(runtimeWarnings({...snapshot,error:'重复错误',connectionError:'重复错误'}).length,1);
});
