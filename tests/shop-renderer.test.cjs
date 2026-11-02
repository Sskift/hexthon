const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function setup(){
  const elements=new Map();let render;
  const get=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,title:''});return elements.get(id);};
  const context={document:{getElementById:get},window:{hexthon:{onState:fn=>{render=fn;},getState:()=>({then:()=>{}})}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/renderer/shop.js'),'utf8'),context);
  return {get,render};
}
const base={selectedChampion:{id:103,name:'阿狸'},game:{ownItems:[]},buildSuggestions:[],selectedAugments:[]};
test('shop rerenders when only matchup evidence changes and presents the reason separately from OP.GG route',()=>{
  const ui=setup();ui.render(base);assert.match(ui.get('shop-advice').innerHTML,/暂无/);
  ui.render({...base,matchup:{recommendations:[{item:{id:3135,name:'虚空之杖'},reason:'已读到对手装备提供魔抗',kind:'matchup',source:'Riot 装备资料'}]}});
  assert.match(ui.get('shop-advice').innerHTML,/虚空之杖/);assert.match(ui.get('shop-advice').innerHTML,/对手装备提供魔抗/);
  assert.match(ui.get('shop-hero').innerHTML,/优先查看/);assert.match(ui.get('shop-data-status').textContent,/未知/);
});
test('shop bounds advice to two different items and escapes source text',()=>{
  const ui=setup(),rec={item:{id:3031,name:'<script>bad</script>'},reason:'<img onerror="bad">',kind:'upgrade',tentative:true,source:'OP.GG 路线'};
  ui.render({...base,matchup:{recommendations:[rec,rec,{...rec,item:{id:3157,name:'中娅沙漏'}},{...rec,item:{id:3089,name:'死亡之帽'}}]}});
  const html=ui.get('shop-advice').innerHTML;
  assert.equal((html.match(/<article /g)||[]).length,2);assert.doesNotMatch(html,/<script>|<img onerror/);
  assert.match(html,/&lt;script&gt;/);assert.match(html,/待确认/);assert.equal(ui.get('shop-inventory-section').hidden,true);
});
test('shop shows an inventory unknown state and the reason a static route is blocked',()=>{
  const ui=setup();
  ui.render({...base,game:{ownItems:null},buildSuggestions:[{name:'核心装备',rows:[{items:[{id:3118,name:'残疫',blocked:true,reasons:['终极技能条件冲突']}],next:null,reasons:['终极技能条件冲突']}]}]});
  assert.match(ui.get('shop-advice').innerHTML,/装备未读取/);assert.match(ui.get('shop-items').innerHTML,/暂不补购/);
  assert.equal(ui.get('shop-context-note').textContent,'终极技能条件冲突');
});
