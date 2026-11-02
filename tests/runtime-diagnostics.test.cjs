const test=require('node:test'),assert=require('node:assert/strict');
const {compatibility,ScanBudget,diagnosticReport}=require('../src/core/runtime-diagnostics.cjs');
test('known patch mismatch suspends static attribute advice and native sync',()=>{
  const result=compatibility({gameVersion:'16.22.123.456',catalogPatch:'16.21',staticVersion:'16.21.1'});
  assert.equal(result.status,'mismatch');assert.equal(result.staticRulesEnabled,false);assert.equal(result.itemSetSyncEnabled,false);
  assert.equal(compatibility({catalogPatch:'16.21',staticVersion:'16.21.1'}).status,'unknown');
  assert.equal(compatibility({gameVersion:'16.21.123',catalogPatch:'16.21',staticVersion:'16.21.1'}).status,'matched');
});
test('slow work backs off and healthy reads recover without a growing queue',()=>{
  const budget=new ScanBudget();assert.equal(budget.delay(),900);
  budget.record(10);budget.record(1000);assert.equal(budget.snapshot().p95Ms,1000);
  for(let i=0;i<4;i++)budget.record(600);
  assert.equal(budget.delay(),2400);assert.equal(budget.delay({scene:'cards'}),1600);
  assert.equal(budget.snapshot().throttled,true);
  for(let i=0;i<4;i++)budget.record(20);
  assert.equal(budget.delay(),900);assert.equal(budget.delay({hint:true}),400);
  for(let i=0;i<100;i++)budget.record(1);assert.equal(budget.snapshot().samples,30);
  budget.record(2,{failed:true});budget.record(2,{failed:true});assert.equal(budget.delay(),3000);
  budget.record(2);assert.equal(budget.delay(),900);
});
test('diagnostic export cannot echo arbitrary live fields or error text',()=>{
  const sensitive='SECRET-NEVER-EXPORT';
  const report=diagnosticReport({version:'0.4.0',recognitionMode:'api',settings:{leaguePath:sensitive},game:{riotId:sensitive,connection:{password:sensitive},ownItems:[{id:1,name:sensitive}],team:[{name:sensitive,items:[]}],opponents:[]},
    error:sensitive,ocr:{text:sensitive},monitor:{game:{title:sensitive}},selectedAugments:[{name:sensitive}],nativeItemSets:{status:'written',accountId:sensitive}});
  assert.equal(JSON.stringify(report).includes(sensitive),false);assert.equal(report.coverage.knownSelectedAugments,1);assert.equal(report.coverage.completeSelectedAugments,false);
});
