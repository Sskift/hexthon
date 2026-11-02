const {titleOffer}=require('./light-offer.cjs');
function relativeRect(rect,region){
  const x=Math.max(0,(rect.x-region.x)/region.width),y=Math.max(0,(rect.y-region.y)/region.height);
  const right=Math.min(1,(rect.x+rect.width-region.x)/region.width),bottom=Math.min(1,(rect.y+rect.height-region.y)/region.height);
  return {x,y,width:right-x,height:bottom-y};
}
function flattened(lines){return (lines||[]).flatMap(line=>line.words?.length?line.words:[line]);}
function replaceSlot(lines,replacement,rect){
  return [...flattened(lines).filter(w=>{const x=w.x+w.width/2,y=w.y+w.height/2;return !(x>=rect.x&&x<=rect.x+rect.width&&y>=rect.y&&y<=rect.y+rect.height);}),...flattened(replacement)];
}
// A retry reads only an unresolved title from the same pixels, with a strict
// budget. Never turn fuzzy text into an exact catalog name or fetch a model.
async function readOfferTitles({ocr,image,region,geometry,augments,capturedAt,isCurrent=()=>true,maxExtraReads=3}){
  const started=performance.now();let reads=0;
  async function read(rect,options={}){
    if(!isCurrent())throw new Error('STALE_TITLE_READING');
    reads++;const out=await ocr.read(image,rect,augments,{allowSmall:true,allowFallback:false,...options});
    if(!isCurrent())throw new Error('STALE_TITLE_READING');return out;
  }
  let result=await read({x:0,y:0,width:1,height:1});
  let offer=titleOffer(result,region,geometry,augments,capturedAt);
  const limit=1+Math.max(0,Math.min(3,maxExtraReads));
  const slots=offer.unknownSlots.slice();
  for(const invert of [false,true]){
    for(const slot of slots){
      if(reads>=limit||offer.cards.length===3)break;
      if(!offer.unknownSlots.includes(slot))continue;
      const rect=relativeRect(geometry.titles[slot],region);
      if(rect.width<=0||rect.height<=0)continue;
      const retry=await read(rect,{scale:3,invert});
      const candidate={...result,lines:replaceSlot(result.lines,retry.lines,rect)};
      const next=titleOffer(candidate,region,geometry,augments,capturedAt);
      if(next.recognized.some(r=>r.slot===slot)){
        result=candidate;offer=next;
      }
    }
  }
  if(offer.cards.length!==3&&reads<limit&&typeof image.getSize==='function'){
    const retry=await read({x:0,y:0,width:1,height:1},{scale:2200/image.getSize().width});
    const candidate=titleOffer(retry,region,geometry,augments,capturedAt);
    if(candidate.cards.length===3){result=retry;offer=candidate;}
  }
  return {result,offer,reads,durationMs:Math.round(performance.now()-started)};
}
module.exports={readOfferTitles,relativeRect,replaceSlot};
