// Pixel-only matching of the player's visible augment HUD. No process memory,
// inputs, or card-click evidence is used by this recognizer.
const HUD_REGION=Object.freeze({x:.14,y:.76,width:.32,height:.24});
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function validImage(image){return image&&Number.isInteger(image.width)&&Number.isInteger(image.height)&&image.width>0&&image.height>0&&image.bgraBuffer?.length>=image.width*image.height*4;}
const samplers=new WeakMap();
function sampler(image){
  if(samplers.has(image))return samplers.get(image);
  const frame=image.width>400&&image.height>250;
  const x0=frame?Math.max(0,Math.floor(image.width*HUD_REGION.x)-8):0,y0=frame?Math.max(0,Math.floor(image.height*HUD_REGION.y)-8):0;
  const x1=frame?Math.min(image.width,Math.ceil(image.width*(HUD_REGION.x+HUD_REGION.width))+8):image.width;
  const width=x1-x0,height=image.height-y0,stride=width+1,table=new Float64Array((width+1)*(height+1)),b=image.bgraBuffer;
  for(let y=0;y<height;y++){let sum=0;for(let x=0;x<width;x++){const p=((y+y0)*image.width+x+x0)*4;sum+=.114*b[p]+.587*b[p+1]+.299*b[p+2];table[(y+1)*stride+x+1]=sum+table[y*stride+x+1];}}
  const at=(x,y)=>{x=clamp(x-x0,0,width);y=clamp(y-y0,0,height);const a=Math.floor(x),c=Math.floor(y),d=Math.min(a+1,width),e=Math.min(c+1,height),dx=x-a,dy=y-c;return table[c*stride+a]*(1-dx)*(1-dy)+table[c*stride+d]*dx*(1-dy)+table[e*stride+a]*(1-dx)*dy+table[e*stride+d]*dx*dy;};
  const average=(x,y,w,h)=>(at(x+w,y+h)-at(x,y+h)-at(x+w,y)+at(x,y))/(w*h);
  samplers.set(image,average);return average;
}
function descriptor(image,rect,size=24){
  const values=new Float32Array(size*size),average=sampler(image);let sum=0,sum2=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const v=average(rect.x+x*rect.width/size,rect.y+y*rect.height/size,rect.width/size,rect.height/size);
    values[y*size+x]=v;sum+=v;sum2+=v*v;
  }
  const mean=sum/values.length,norm=Math.sqrt(Math.max(0,sum2-sum*sum/values.length));
  if(norm/Math.sqrt(values.length)<7)return null;
  for(let i=0;i<values.length;i++)values[i]=(values[i]-mean)/norm;
  return values;
}
function correlation(a,b){let sum=0;for(let i=0;i<a.length;i++)sum+=a[i]*b[i];return sum;}
function prepareTemplates(templates=[]){
  const groups=[];
  for(const template of templates){
    if(!validImage(template.image)||!Number.isInteger(template.id)||!template.name)continue;
    const rect={x:0,y:0,width:template.image.width,height:template.image.height};
    const fine=descriptor(template.image,rect),coarse=descriptor(template.image,rect,12);if(!fine||!coarse)continue;
    // Some OP.GG entries share exactly the same generic icon. Such groups may
    // locate an icon, but cannot identify a specific augment and must abstain.
    const same=groups.find(group=>correlation(group.fine,fine)>.9995);
    if(same){if(!same.entries.some(entry=>entry.id===template.id))same.entries.push({id:template.id,name:template.name});}
    else groups.push({entries:[{id:template.id,name:template.name}],fine,coarse});
  }
  return groups;
}
function findHudSquares(image,region=HUD_REGION){
  if(!validImage(image))return [];
  const step=Math.max(1,Math.round(image.height/720));
  const left=Math.floor(image.width*region.x),top=Math.floor(image.height*region.y);
  const columns=Math.floor(image.width*region.width/step),rows=Math.floor(image.height*region.height/step);
  const mask=new Uint8Array(columns*rows),data=image.bgraBuffer;
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const px=Math.min(image.width-1,left+x*step),py=Math.min(image.height-1,top+y*step),p=(py*image.width+px)*4;
    const b=data[p],g=data[p+1],r=data[p+2];
    if(r<74&&g<86&&b<73&&g>=b*.85&&g>=r*.8)mask[y*columns+x]=1;
  }
  const result=[],queue=new Int32Array(mask.length);
  for(let index=0;index<mask.length;index++){
    if(mask[index]!==1)continue;
    let start=0,end=1,minX=index%columns,maxX=minX,minY=Math.floor(index/columns),maxY=minY,count=0;
    queue[0]=index;mask[index]=2;
    while(start<end){
      const pos=queue[start++],x=pos%columns,y=Math.floor(pos/columns);count++;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const nx=x+dx,ny=y+dy;if(nx<0||nx>=columns||ny<0||ny>=rows)continue;
        const next=ny*columns+nx;if(mask[next]===1){mask[next]=2;queue[end++]=next;}
      }
    }
    const width=(maxX-minX+1)*step,height=(maxY-minY+1)*step,area=(maxX-minX+1)*(maxY-minY+1);
    if(width<image.height*.018||width>image.height*.065||height<image.height*.018||height>image.height*.065||width/height<.78||width/height>1.28||count/area<.3)continue;
    result.push({x:left+minX*step,y:top+minY*step,width,height,fill:count/area});
  }
  // Slots appear in rows in the player's augment tray. Requiring a similarly
  // sized horizontal neighbor rejects isolated buff/item tooltips and scenery.
  return result.filter(a=>result.some(b=>a!==b&&Math.abs(a.y-b.y)<Math.max(a.height,b.height)*.18&&b.width/a.width>.75&&b.width/a.width<1.33&&Math.abs(a.x-b.x)>a.width*.8&&Math.abs(a.x-b.x)<a.width*2.6))
    .sort((a,b)=>b.y-a.y||a.x-b.x).slice(0,12);
}
function matchAugmentIcons(image,templates,{observedAt=new Date().toISOString(),minScore=.94,minMargin=.032}={}){
  const none={matches:[],observedAt};if(!validImage(image)||!templates?.length)return none;
  const candidates=findHudSquares(image),matches=[];
  for(const candidate of candidates){
    const delta=Math.max(1,Math.round(image.height/720));
    const size=Math.round((candidate.width+candidate.height)/2),rough=[];
    for(const scale of [-delta,0,delta])for(const dx of [-delta,0,delta])for(const dy of [-delta,0,delta]){
      const rect={x:candidate.x+dx,y:candidate.y+dy,width:size+scale,height:size+scale};
      if(rect.x<0||rect.y<0||rect.x+rect.width>image.width||rect.y+rect.height>image.height)continue;
      const vector=descriptor(image,rect,12);if(!vector)continue;
      for(let t=0;t<templates.length;t++)rough.push({t,score:correlation(vector,templates[t].coarse),rect});
    }
    rough.sort((a,b)=>b.score-a.score);const short=[];
    for(const hit of rough){if(!short.some(value=>value.t===hit.t))short.push(hit);if(short.length===8)break;}
    if(!short.length||short[0].score<.78)continue;
    const refined=[];
    for(const hit of short){let best={t:hit.t,score:-1,rect:hit.rect};
      for(let scale=-delta;scale<=delta;scale++)for(let dx=-delta;dx<=delta;dx++)for(let dy=-delta;dy<=delta;dy++){
        const rect={x:hit.rect.x+dx,y:hit.rect.y+dy,width:hit.rect.width+scale,height:hit.rect.height+scale};
        if(rect.x<0||rect.y<0||rect.x+rect.width>image.width||rect.y+rect.height>image.height)continue;
        const vector=descriptor(image,rect);if(!vector)continue;
        const score=correlation(vector,templates[hit.t].fine);if(score>best.score)best={t:hit.t,score,rect};
      }refined.push(best);
    }
    refined.sort((a,b)=>b.score-a.score);const best=refined[0],margin=best.score-(refined[1]?.score??0),group=templates[best.t];
    if(best.score<minScore||margin<minMargin||group.entries.length!==1)continue;
    const entry=group.entries[0];if(matches.some(match=>match.id===entry.id))continue;
    matches.push({...entry,score:Number(best.score.toFixed(4)),margin:Number(margin.toFixed(4)),confidence:'visual',
      rect:{x:best.rect.x/image.width,y:best.rect.y/image.height,width:best.rect.width/image.width,height:best.rect.height/image.height},
      evidence:'己方底部强化栏图标与 OP.GG 模板像素匹配'});
  }
  return {matches:matches.sort((a,b)=>a.rect.y-b.rect.y||a.rect.x-b.rect.x),observedAt};
}
class AugmentIconTracker{
  constructor({stableReads=2,maxGapMs=8000,now=()=>Date.now()}={}){this.stableReads=stableReads;this.maxGapMs=maxGapMs;this.now=now;this.reset();}
  reset(){this.candidates=new Map();this.selected=new Map();this.lastSample=null;this.lastAt=null;this.matches=[];this.replacedIds=[];return this.snapshot();}
  invalidate(){this.candidates.clear();this.matches=[];this.lastAt=null;return this.snapshot();}
  snapshot(){return{selected:[...this.selected.values()],pending:[...this.candidates.values()].filter(c=>c.reads<this.stableReads).map(c=>c.match),matches:this.matches.slice(),replacedIds:this.replacedIds.slice()};}
  observe(detection,{active=true}={}){
    if(!active)return this.invalidate();const stamp=detection?.observedAt;if(stamp==null||stamp===this.lastSample)return this.snapshot();
    const now=this.now();if(this.lastAt!==null&&now-this.lastAt>this.maxGapMs)this.candidates.clear();this.lastAt=now;this.lastSample=stamp;
    this.replacedIds=[];
    this.matches=(detection.matches||[]).filter(m=>Number.isInteger(m.id)&&m.confidence==='visual'&&Number.isFinite(m.score)&&m.score>=.94&&m.score<=1.001&&Number.isFinite(m.margin)&&m.margin>=.032&&m.rect&&[m.rect.x,m.rect.y,m.rect.width,m.rect.height].every(Number.isFinite)&&m.rect.width>0&&m.rect.height>0&&m.rect.x>=HUD_REGION.x&&m.rect.x+m.rect.width<=HUD_REGION.x+HUD_REGION.width&&m.rect.y>=HUD_REGION.y&&m.rect.y+m.rect.height<=1.001);
    const next=new Map();
    for(const match of this.matches){const old=this.candidates.get(match.id),same=old&&Math.abs(old.match.rect.x-match.rect.x)<.02&&Math.abs(old.match.rect.y-match.rect.y)<.02;
      const value={match,reads:same?old.reads+1:1};next.set(match.id,value);
      if(value.reads>=this.stableReads){
        for(const [id,previous] of this.selected){
          if(id!==match.id&&Math.abs(previous.rect.x-match.rect.x)<Math.min(previous.rect.width,match.rect.width)*.45&&Math.abs(previous.rect.y-match.rect.y)<Math.min(previous.rect.height,match.rect.height)*.45){this.selected.delete(id);this.replacedIds.push(id);}
        }
        this.selected.set(match.id,{...match,evidence:'连续两帧己方强化栏图标与 OP.GG 模板像素匹配',detectedAt:this.selected.get(match.id)?.detectedAt||new Date(now).toISOString()});
      }
    }
    this.candidates=next;return this.snapshot();
  }
}
module.exports={HUD_REGION,prepareTemplates,matchAugmentIcons,findHudSquares,AugmentIconTracker,descriptor,correlation};
