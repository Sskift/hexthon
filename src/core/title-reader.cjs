const {titleOffer}=require('./light-offer.cjs');
const {brightTextBitmap}=require('./ocr.cjs');
function relativeRect(rect,region){
  const x=Math.max(0,(rect.x-region.x)/region.width),y=Math.max(0,(rect.y-region.y)/region.height);
  const right=Math.min(1,(rect.x+rect.width-region.x)/region.width),bottom=Math.min(1,(rect.y+rect.height-region.y)/region.height);
  return {x,y,width:right-x,height:bottom-y};
}
function flattened(lines){return (lines||[]).flatMap(line=>line.words?.length?line.words.map(word=>({...word,rowY:line.y,rowHeight:line.height})):[line]);}
function replaceSlot(lines,replacement,rect){
  return [...flattened(lines).filter(w=>{const x=w.x+w.width/2,y=w.y+w.height/2;return !(x>=rect.x&&x<=rect.x+rect.width&&y>=rect.y&&y<=rect.y+rect.height);}),...flattened(replacement)];
}
function tightTitleRect(image,rect){
  if(typeof image.getSize!=='function'||typeof image.toBitmap!=='function')return rect;
  const size=image.getSize(),pixels=image.toBitmap();
  if(!size.width||!size.height||pixels.length!==size.width*size.height*4)return rect;
  const left=Math.max(0,Math.floor(rect.x*size.width)),top=Math.max(0,Math.floor(rect.y*size.height));
  const right=Math.min(size.width,Math.ceil((rect.x+rect.width)*size.width)),bottom=Math.min(size.height,Math.ceil((rect.y+rect.height)*size.height));
  let minX=right,minY=bottom,maxX=left,maxY=top,count=0;
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
    const p=(y*size.width+x)*4,luma=.114*pixels[p]+.587*pixels[p+1]+.299*pixels[p+2];
    if(luma<160)continue;count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }
  // A bright/animated background is not evidence of a text bounding box.
  if(count<12||count>(right-left)*(bottom-top)*.4||maxY-minY<5)return rect;
  const pad=Math.max(4,Math.round((maxY-minY+1)*.25));
  const x=Math.max(left,minX-pad),y=Math.max(top,minY-pad),x2=Math.min(right,maxX+pad+1),y2=Math.min(bottom,maxY+pad+1);
  return {x:x/size.width,y:y/size.height,width:(x2-x)/size.width,height:(y2-y)/size.height};
}
function titleInkGuard(image,region,geometry){
  if(typeof image.getSize!=='function'||typeof image.toBitmap!=='function'||geometry?.titles?.length!==3)return ()=>true;
  const size=image.getSize(),raw=image.toBitmap();
  if(!size.width||!size.height||raw.length!==size.width*size.height*4)return ()=>true;
  const mask=brightTextBitmap(raw,.7);if(!mask)return ()=>true;
  const areas=geometry.titles.map(title=>{
    const rect=relativeRect(title,region),pixels=[];
    const left=Math.max(0,Math.floor(rect.x*size.width)),top=Math.max(0,Math.floor(rect.y*size.height));
    const right=Math.min(size.width,Math.ceil((rect.x+rect.width)*size.width)),bottom=Math.min(size.height,Math.ceil((rect.y+rect.height)*size.height));
    for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)if(mask[(y*size.width+x)*4]===0)pixels.push([x,y]);
    return {rect,pixels};
  });
  // A partial OCR reading can accidentally equal another valid, shorter name.
  // Reject it when bright strokes remain outside its word boxes. This supplies
  // rejection evidence only; pixels never select a catalog ID.
  return (lines,slot)=>{
    const area=areas[slot];if(!area?.pixels.length)return true;
    const boxes=flattened(lines).filter(w=>{const x=w.x+w.width/2,y=w.y+w.height/2;return [x,y,w.width,w.height].every(Number.isFinite)&&x>=area.rect.x&&x<=area.rect.x+area.rect.width&&y>=area.rect.y&&y<=area.rect.y+area.rect.height;})
      .map(w=>({left:w.x*size.width-2,top:w.y*size.height-2,right:(w.x+w.width)*size.width+2,bottom:(w.y+w.height)*size.height+2}));
    const covered=area.pixels.reduce((sum,[x,y])=>sum+Number(boxes.some(b=>x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom)),0);
    return covered/area.pixels.length>=.9;
  };
}
// Retry unresolved titles from the same captured strip: two bounded contrast
// alternatives, then a local crop if budget remains. Preserve exact earlier
// slots; never fetch pixels/models, merge guesses or exceed four OCR reads.
async function readOfferTitles({ocr,image,region,geometry,augments,capturedAt,isCurrent=()=>true,maxExtraReads=3}){
  const started=performance.now();let reads=0;
  const inkGuard=titleInkGuard(image,region,geometry);
  function recognize(result){
    const out=titleOffer(result,region,geometry,augments,capturedAt),rejected=out.recognized.filter(row=>!inkGuard(result.lines,row.slot)).map(row=>row.slot);
    return rejected.length?{...out,cards:[],recognized:out.recognized.filter(row=>!rejected.includes(row.slot)),unknownSlots:[...new Set([...out.unknownSlots,...rejected])].sort(),confidence:0,reason:'标题仍有未覆盖的笔画，等待完整文字'}:out;
  }
  async function read(rect,options={}){
    if(!isCurrent())throw new Error('STALE_TITLE_READING');
    reads++;const out=await ocr.read(image,rect,augments,{allowSmall:true,allowFallback:false,...options});
    if(!isCurrent())throw new Error('STALE_TITLE_READING');return out;
  }
  let result=await read({x:0,y:0,width:1,height:1});
  let offer=recognize(result);
  const limit=1+(Number.isFinite(maxExtraReads)?Math.max(0,Math.min(3,Math.floor(maxExtraReads))):3);
  if(!geometry?.titles||geometry.titles.length!==3)return {result,offer,reads,durationMs:Math.round(performance.now()-started)};
  function merge(retry,slot){
    const rect=relativeRect(geometry.titles[slot],region);
    const replacement=flattened(retry.lines).filter(w=>{const x=w.x+w.width/2,y=w.y+w.height/2;return x>=rect.x&&x<=rect.x+rect.width&&y>=rect.y&&y<=rect.y+rect.height;});
    const candidate={...result,lines:replaceSlot(result.lines,replacement,rect)};
    const next=recognize(candidate);
    if(next.recognized.some(r=>r.slot===slot)){result=candidate;offer=next;}
  }
  if(offer.unknownSlots.length&&reads<limit&&typeof image.getSize==='function'&&typeof image.toBitmap==='function'){
    const retry=await read({x:0,y:0,width:1,height:1},{scale:2,brightText:.86});
    for(const slot of offer.unknownSlots.slice())merge(retry,slot);
  }
  if(offer.unknownSlots.length&&reads<limit&&typeof image.getSize==='function'&&typeof image.toBitmap==='function'){
    const retry=await read({x:0,y:0,width:1,height:1},{scale:2,brightText:.75});
    for(const slot of offer.unknownSlots.slice())merge(retry,slot);
  }
  for(const invert of [false,true]){
    for(const slot of offer.unknownSlots.slice()){
      if(reads>=limit||offer.cards.length===3)break;
      if(!offer.unknownSlots.includes(slot))continue;
      const rect=relativeRect(geometry.titles[slot],region);
      if(rect.width<=0||rect.height<=0)continue;
      const retry=await read(typeof image.getSize==='function'&&image.getSize().height<70?tightTitleRect(image,rect):rect,{scale:3,invert});
      merge(retry,slot);
    }
    if(!invert&&offer.unknownSlots.length&&reads<limit){
      const size=typeof image.getSize==='function'?image.getSize():null;
      const retry=await read({x:0,y:0,width:1,height:1},{scale:size?.height>=70?2200/size.width:1});
      for(const slot of offer.unknownSlots.slice())merge(retry,slot);
    }
  }
  return {result,offer,reads,durationMs:Math.round(performance.now()-started)};
}
module.exports={readOfferTitles,relativeRect,replaceSlot,tightTitleRect,titleInkGuard};
