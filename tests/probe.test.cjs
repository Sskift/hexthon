const {test} = require('node:test');
const assert = require('node:assert/strict');
const {classifyMayhemUpdate,createSdkDiagnostics} = require('../experiments/overwolf-probe/diagnostics.cjs');
const catalog=[{id:1,name:'测试一',englishName:'First'},{id:2,name:'测试二',englishName:'Second'},{id:3,name:'测试三',englishName:'Third'}];
const update=(key,value)=>({gameId:5426,feature:'augments',category:'me',key,value});

test('reset and malformed field updates are notifications, never successful Mayhem content',()=>{
  for(const value of [null,'','{}','[]','{bad',{},[],{augment_1:{name:null}},{augment_1:{name:3}}]){
    const result=classifyMayhemUpdate(5426,update('augments',value),catalog);
    assert.equal(result.fieldUpdate,true);
    assert.equal(result.validContent,false);
    assert.equal(result.mappedCandidates,false);
  }
  for(const value of [null,'',{},'\n',17])assert.equal(classifyMayhemUpdate(5426,update('picked_augment',value),catalog).validContent,false);
});

test('wrong game IDs, unrelated categories and arbitrary fields cannot count as Mayhem notifications',()=>{
  for(const [id,data] of [[22848,update('picked_augment','First')],[5426,{...update('picked_augment','First'),gameId:22848}],
    [5426,{...update('picked_augment','First'),category:'enemy'}],[5426,update('shop_visible',true)]]){
    assert.deepEqual(classifyMayhemUpdate(id,data,catalog),{fieldUpdate:false,validContent:false,mappedCandidates:false,mappedPick:false});
  }
});

test('valid names and successfully mapped names are separate evidence levels',()=>{
  assert.deepEqual(classifyMayhemUpdate(5426,update('picked_augment','Unknown'),catalog),{
    fieldUpdate:true,validContent:true,mappedCandidates:false,mappedPick:false});
  assert.equal(classifyMayhemUpdate(5426,update('picked_augment','First'),catalog).mappedPick,true);
  const three=JSON.stringify({augment_1:{name:'First'},augment_2:{name:'Second'},augment_3:{name:'Third'}});
  assert.deepEqual(classifyMayhemUpdate(5426,update('augments',three),catalog),{
    fieldUpdate:true,validContent:true,mappedCandidates:true,mappedPick:false});
  assert.equal(classifyMayhemUpdate(5426,update('augments',{augment_1:{name:'First'}}),catalog).mappedCandidates,false);
});

test('SDK diagnostics retain only fixed boolean classifications, including split messages',()=>{
  const diagnostics=createSdkDiagnostics();
  diagnostics.observe('player private-name#123 secret-token path=C:\\private\\account\nNo dev cred');
  diagnostics.observe('entials found. Dev mode authentication failed.');
  const state=diagnostics.snapshot();
  assert.deepEqual(state,{missingCredentials:true,validationFailure:true});
  assert.doesNotMatch(JSON.stringify(state),/private|secret|account|player/);
  state.missingCredentials=false;
  assert.equal(diagnostics.snapshot().missingCredentials,true);
});
