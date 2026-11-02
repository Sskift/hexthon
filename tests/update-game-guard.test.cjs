const {test}=require('node:test');
const assert=require('node:assert/strict');
const {gameIsClosed}=require('../src/core/update-game-guard.cjs');
test('update guard allows only an explicit zero game-process count and stays hidden and bounded',async()=>{
  for(const [stdout,expected] of [['{"count":0}',true],['{"count":1}',false],['{"count":-1}',false],['{}',false],['not json',false]]){
    const result=await gameIsClosed({platform:'win32',execute:(exe,args,options,callback)=>{
      assert.equal(exe,'powershell.exe');assert.equal(options.windowsHide,true);assert.ok(options.timeout>0&&options.timeout<=3000);
      assert.ok(args.includes('-NoProfile')&&args.includes('-NonInteractive'));callback(null,stdout);
    }});assert.equal(result,expected);
  }
});
test('query failures and unsupported platforms cannot authorize applying an update',async()=>{
  assert.equal(await gameIsClosed({platform:'win32',execute:(_exe,_args,_options,callback)=>callback(new Error('timeout'),'')}),false);
  assert.equal(await gameIsClosed({platform:'linux',execute:()=>{throw new Error('must not spawn');}}),false);
});
