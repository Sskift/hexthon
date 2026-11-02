const {normalize}=require('./matching.cjs');
// Windows zh-Hans OCR occasionally emits the traditional form of the same
// character. These explicit one-character equivalents are not edit-distance or
// radical guesses; both catalog and reading use the mapping and collisions
// below still abstain. The original OCR text remains unchanged in the result.
const TITLE_CHAR_VARIANTS=Object.freeze({'疊':'叠','鯊':'鲨','獄':'狱','贈':'赠','龍':'龙','療':'疗'});
function normalizeTitle(text){return normalize(text).replace(/[疊鯊獄贈龍療]/g,char=>TITLE_CHAR_VARIANTS[char]);}
// OCR coordinates belong to the captured title strip. Restore client coordinates
// before assigning words to cards; do not guess by dictionary substring matches.
function titleOffer(result,region,geometry,augments,capturedAt) {
  const recognized=[],unknownSlots=[];
  const none=reason=>({cards:[],recognized,unknownSlots:unknownSlots.length?unknownSlots:[0,1,2],confidence:0,reason,observedAt:capturedAt});
  if(!geometry?.titles?.length||geometry.titles.length!==3||!geometry.cards?.length)return none('卡片布局不可用');
  const words=(result?.lines||[]).flatMap(line=>line.words?.length?line.words.map(word=>({...word,rowY:line.y,rowHeight:line.height})):[line]).filter(w=>
    typeof w.text==='string'&&[w.x,w.y,w.width,w.height].every(Number.isFinite)&&w.width>0&&w.height>0)
    .map(w=>({...w,x:region.x+w.x*region.width,y:region.y+w.y*region.height,width:w.width*region.width,height:w.height*region.height,
      rowY:region.y+(Number.isFinite(w.rowY)?w.rowY:w.y)*region.height,rowHeight:(Number.isFinite(w.rowHeight)?w.rowHeight:w.height)*region.height}));
  const names=new Map();
  for(const augment of augments||[]) {
    const key=normalizeTitle(augment.name);if(!key)continue;
    if(!names.has(key))names.set(key,augment);else if(names.get(key)?.id!==augment.id)names.set(key,null);
  }
  const cards=[];
  for(let i=0;i<3;i++) {
    const title=geometry.titles[i],rect=geometry.cards[i];
    const inside=words.filter(w=>{const x=w.x+w.width/2,y=w.y+w.height/2;return x>=title.x&&x<=title.x+title.width&&y>=title.y&&y<=title.y+title.height;});
    // Preserve line order; minor character-box vertical differences inside a
    // line must not reorder Chinese words. Wrapped titles are joined exactly.
    const rows=[];
    for(const word of inside.sort((a,b)=>a.rowY-b.rowY||a.x-b.x)) {
      let row=rows.find(r=>Math.abs(r.y-word.rowY)<Math.min(r.height,word.rowHeight)*.55);
      if(!row){row={y:word.rowY,height:word.rowHeight,words:[]};rows.push(row);}row.words.push(word);
    }
    const key=normalizeTitle(rows.sort((a,b)=>a.y-b.y).map(r=>r.words.sort((a,b)=>a.x-b.x).map(w=>w.text).join('')).join(''));
    const augment=names.get(key);if(!augment){unknownSlots.push(i);continue;}
    recognized.push({slot:i,id:augment.id});
    const x=Math.min(...inside.map(w=>w.x)),y=Math.min(...inside.map(w=>w.y));
    const titleRect={x,y,width:Math.max(...inside.map(w=>w.x+w.width))-x,height:Math.max(...inside.map(w=>w.y+w.height))-y};
    cards.push({id:augment.id,name:augment.name,confidence:100,titleRect,rect,
      selectionRect:{x:rect.x+rect.width*.06,y:rect.y+rect.height*.06,width:rect.width*.88,height:rect.height*.72},
      estimated:true,geometrySource:'reroll-gated-title-layout'});
  }
  if(unknownSlots.length)return none('标题未能精确匹配，暂不显示推荐');
  if(new Set(cards.map(c=>c.id)).size!==3)return none('候选标题重复，等待清晰画面');
  return {cards,recognized,unknownSlots:[],confidence:100,reason:'按钮图形与三个完整标题匹配',observedAt:capturedAt};
}
module.exports={titleOffer,normalizeTitle};
