const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/renderer/recommendation-details.js'),'utf8'),context);
const details=context.window.hexthonDetails;
const hostile='<img src=x onerror="alert(1)">&\'测试';

test('item fit shows its limiting condition even when positive reasons fill the display budget',()=>{
  const html=details.fit({benefits:['收益一','收益二','收益三','收益四'],cautions:['需要确认攻击特效能否触发']});
  assert.match(html,/需要确认攻击特效能否触发/);assert.match(html,/fit-caution/);
  assert.ok((html.match(/<p /g)||[]).length<=3);assert.match(html,/fit-benefit/);
});

test('item and route explanations escape external names and keep blocked equipment reasons',()=>{
  const fit=details.fit({benefits:[hostile],cautions:['现有记录不完整']});
  assert.match(fit,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp;&#39;测试/);
  assert.doesNotMatch(fit,/<img|<script/);
  const html=details.buildRow({items:[{name:hostile,blocked:true,reasons:['终极技能已被禁用']},{name:'纳什之牙',blocked:false,fit:{benefits:['可提供攻击特效']}}],fitCautions:['记录待确认','记录待确认']});
  assert.match(html,/终极技能已被禁用/);assert.match(html,/纳什之牙：可提供攻击特效/);
  assert.equal((html.match(/记录待确认/g)||[]).length,1);assert.doesNotMatch(html,/<img/);
  assert.equal(details.buildRow({items:[]}), '');
});

test('draft decision identifies the candidate and tradeoff while distinguishing rule score from win rate',()=>{
  const html=details.draft({recommendation:{action:'consider-swap',championId:54,label:'可以考虑交换',scoreDelta:8,confidence:'medium',reasons:['补充前排'],tradeoffs:['会减少远程持续输出']},coverage:{rolesKnown:4,teammates:4}},{champions:[{id:54,name:'墨菲特'}]});
  assert.match(html,/可以考虑交换 · 墨菲特/);assert.match(html,/参考指数 \+8/);
  assert.match(html,/补充前排/);assert.match(html,/会减少远程持续输出/);
  assert.match(html,/队友职业已知 4\/4/);assert.match(html,/指数不代表胜率/);
  const unknown=details.draft({recommendation:{action:'keep',label:hostile,scoreDelta:null,confidence:'low'},coverage:{}},{});
  assert.match(unknown,/信息有限/);assert.doesNotMatch(unknown,/<img|参考指数/);
  assert.equal(details.draft(null,{}),'');
});

test('build style exposes tentative conversion evidence and does not assert an unknown build direction',()=>{
  const html=details.style({label:'当前构筑线索',directions:[],mechanisms:[{tentative:true,augmentName:'魔法转物理',effect:hostile}],notice:'未计算转换数值和结算顺序'});
  assert.match(html,/现有信息还不足以确定路线/);assert.match(html,/待确认记录 · 魔法转物理/);
  assert.match(html,/未计算转换数值和结算顺序/);assert.doesNotMatch(html,/<img/);
  assert.equal(details.style(null),'');
});
