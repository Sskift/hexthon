// Adapted from Sygnano/aram-mayhem-tracker, MIT License.
// Copyright (c) 2026 Sygnano. See assets/vision/LICENSE-Sygnano.txt.
// Source commit ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1:
// crates/mayhem-core/src/layout.rs; mayhem-vision/src/{reroll,imageops,offer}.rs
// This module only examines supplied ROI pixels. It cannot capture a screen,
// infer selected augments, count rerolls, or establish that a mode is Mayhem.

const CENTERS=Object.freeze([-.3346,.0062,.3470]);
const THRESHOLD=.74,WORK_WIDTH=56,FINGERPRINT_WIDTH=32,FINGERPRINT_HEIGHT=24;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const validDimensions=(width,height)=>Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=16384&&height<=16384;
function validImage(image){return image&&validDimensions(image.width,image.height)&&(Buffer.isBuffer(image.bgraBuffer)||image.bgraBuffer instanceof Uint8Array)&&image.bgraBuffer.length===image.width*image.height*4;}
const inside=(r,w,h)=>r&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=w&&r.y+r.height<=h;
const normalized=(r,w,h)=>({x:r.x/w,y:r.y/h,width:r.width/w,height:r.height/h});
const union=rects=>{const x=Math.min(...rects.map(r=>r.x)),y=Math.min(...rects.map(r=>r.y));return{x,y,width:Math.max(...rects.map(r=>r.x+r.width))-x,height:Math.max(...rects.map(r=>r.y+r.height))-y};};
function layout(clientWidth,clientHeight){
  if(!validDimensions(clientWidth,clientHeight)||clientWidth<400||clientHeight<250)return null;
  const box=(cx,y,w,h)=>({x:Math.round(clientWidth/2+(cx-w/2)*clientHeight),y:Math.round(y*clientHeight),width:Math.max(1,Math.round(w*clientHeight)),height:Math.max(1,Math.round(h*clientHeight))});
  const cards=CENTERS.map(cx=>box(cx,.1793,.2949,.4871));
  const titles=CENTERS.map(cx=>box(cx,.348,.25,.079));
  const rerolls=CENTERS.map(cx=>box(cx,.6862,.054,.036));
  const margin=Math.max(1,Math.round(.008*clientHeight));
  const searches=rerolls.map(r=>({x:r.x-margin,y:r.y-margin,width:r.width+2*margin,height:r.height+2*margin}));
  if([...cards,...titles,...searches].some(r=>!inside(r,clientWidth,clientHeight)))return null;
  const convert=r=>normalized(r,clientWidth,clientHeight);
  return{rerollRegion:convert(union(searches)),titleRegion:convert(union(titles)),rerolls:rerolls.map(convert),titles:titles.map(convert),cards:cards.map(convert),searches:searches.map(convert)};
}
function regionOf(image){
  const region=image.region||{x:0,y:0,width:1,height:1};
  if(!['x','y','width','height'].every(k=>Number.isFinite(region[k]))||region.x<0||region.y<0||region.width<=0||region.height<=0||region.x+region.width>1.000001||region.y+region.height>1.000001)return null;
  return region;
}
function rectInImage(rect,image,region){
  const x=Math.round((rect.x-region.x)/region.width*image.width),y=Math.round((rect.y-region.y)/region.height*image.height);
  const right=Math.round((rect.x+rect.width-region.x)/region.width*image.width),bottom=Math.round((rect.y+rect.height-region.y)/region.height*image.height);
  const out={x,y,width:right-x,height:bottom-y};return inside(out,image.width,image.height)?out:null;
}
function grayCrop(image,rect){
  const values=new Float32Array(rect.width*rect.height),buffer=image.bgraBuffer;
  for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++){
    const p=((y+rect.y)*image.width+x+rect.x)*4;
    values[y*rect.width+x]=.114*buffer[p]+.587*buffer[p+1]+.299*buffer[p+2];
  }
  return{width:rect.width,height:rect.height,values};
}
function weights(source,target){
  const scale=source/target,radius=Math.max(1,scale),out=[];
  for(let d=0;d<target;d++){
    const center=(d+.5)*scale-.5,start=Math.max(0,Math.ceil(center-radius)),end=Math.min(source-1,Math.floor(center+radius));
    const taps=[];let total=0;
    for(let s=start;s<=end;s++){const value=Math.max(0,1-Math.abs(s-center)/radius);if(value){taps.push([s,value]);total+=value;}}
    out.push(taps.map(([s,value])=>[s,value/total]));
  }
  return out;
}
function resizeGray(source,width,height){
  if(source.width===width&&source.height===height)return source;
  const horizontal=weights(source.width,width),vertical=weights(source.height,height),temp=new Float32Array(width*source.height),values=new Float32Array(width*height);
  for(let y=0;y<source.height;y++)for(let x=0;x<width;x++){let value=0;for(const [sx,w]of horizontal[x])value+=source.values[y*source.width+sx]*w;temp[y*width+x]=value;}
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){let value=0;for(const [sy,w]of vertical[y])value+=temp[sy*width+x]*w;values[y*width+x]=value;}
  return{width,height,values};
}
function descriptor(gray){
  let sum=0,squared=0;for(const v of gray.values){sum+=v;squared+=v*v;}
  const n=gray.values.length,mean=sum/n,norm=Math.sqrt(Math.max(0,squared-sum*sum/n));
  if(!Number.isFinite(norm)||norm/Math.sqrt(n)<2)return null;
  return{...gray,centered:Float32Array.from(gray.values,v=>(v-mean)/norm)};
}
const preparedSizes=new WeakMap();
function prepareTemplates(images=[]){
  const result=[];
  for(const item of Array.isArray(images)?images:[]){
    const image=item?.image||item;if(!validImage(image)||image.width<6||image.height<6||image.width>512||image.height>512)continue;
    const gray=grayCrop(image,{x:0,y:0,width:image.width,height:image.height});if(descriptor(gray))result.push(gray);
  }
  preparedSizes.set(result,new Map());return result;
}
function templateAtSize(templates,width,height){
  let cache=preparedSizes.get(templates);if(!cache){cache=new Map();preparedSizes.set(templates,cache);}
  const key=`${width}x${height}`;
  if(!cache.has(key)){
    if(cache.size>=16)cache.clear();
    cache.set(key,templates.map(t=>descriptor(resizeGray(t,width,height))).filter(Boolean));
  }
  return cache.get(key);
}
function locateNcc(work,template){
  const tw=template.width,th=template.height,iw=work.width,ih=work.height,n=tw*th;if(tw>iw||th>ih)return 0;
  const stride=iw+1,sums=new Float64Array((iw+1)*(ih+1)),squares=new Float64Array(sums.length);
  for(let y=0;y<ih;y++){let sum=0,squared=0;for(let x=0;x<iw;x++){const v=work.values[y*iw+x];sum+=v;squared+=v*v;sums[(y+1)*stride+x+1]=sum+sums[y*stride+x+1];squares[(y+1)*stride+x+1]=squared+squares[y*stride+x+1];}}
  const area=(data,x,y)=>data[(y+th)*stride+x+tw]-data[y*stride+x+tw]-data[(y+th)*stride+x]+data[y*stride+x];
  let best=0;
  for(let y=0;y<=ih-th;y++)for(let x=0;x<=iw-tw;x++){
    const sum=area(sums,x,y),variance=Math.max(0,area(squares,x,y)-sum*sum/n);
    if(variance/n<4)continue;
    let dot=0;for(let row=0;row<th;row++){const offset=(y+row)*iw+x;for(let col=0;col<tw;col++)dot+=work.values[offset+col]*template.centered[row*tw+col];}
    best=Math.max(best,dot/Math.sqrt(variance));
  }
  return clamp(best,0,1);
}
function detectRerolls(image,templates,{threshold=THRESHOLD}={}){
  const none={present:false,score:0,matches:[]};
  if(!validImage(image)||!Array.isArray(templates)||!templates.length||templates.some(t=>!validDimensions(t?.width,t?.height)||!(t?.values instanceof Float32Array)||t.values.length!==t.width*t.height))return none;
  const region=regionOf(image),clientWidth=image.clientWidth??image.width,clientHeight=image.clientHeight??image.height,areas=layout(clientWidth,clientHeight);
  if(!region||!areas)return none;
  const minimum=Number.isFinite(threshold)?clamp(threshold,.60,1):THRESHOLD,matches=[];let best=0;
  for(let slot=0;slot<3;slot++){
    const search=rectInImage(areas.searches[slot],image,region),button=rectInImage(areas.rerolls[slot],image,region);
    if(!search||!button){matches.push({slot,present:false,score:0,tested:false});continue;}
    const scale=Math.min(1,WORK_WIDTH/button.width),width=Math.max(6,Math.round(button.width*scale)),height=Math.max(6,Math.round(button.height*scale));
    if(width>search.width||height>search.height)continue;
    const crop=grayCrop(image,search),work=resizeGray(crop,Math.max(1,Math.round(crop.width*scale)),Math.max(1,Math.round(crop.height*scale)));
    const score=Math.max(0,...templateAtSize(templates,width,height).map(t=>locateNcc(work,t)));
    const present=score>=minimum;matches.push({slot,present,score:Number(score.toFixed(4)),tested:true});best=Math.max(best,score);
    if(present)return{present:true,score:Number(best.toFixed(4)),matches};
  }
  return{present:false,score:Number(best.toFixed(4)),matches};
}
function fingerprint(image){
  if(!validImage(image))return null;
  const region=regionOf(image),clientWidth=image.clientWidth??image.width,clientHeight=image.clientHeight??image.height,areas=layout(clientWidth,clientHeight);
  if(!region||!areas)return null;
  const values=new Uint8Array(FINGERPRINT_WIDTH*FINGERPRINT_HEIGHT*3);let offset=0;
  for(const title of areas.titles){
    const rect=rectInImage(title,image,region);if(!rect)return null;
    const gray=resizeGray(grayCrop(image,rect),FINGERPRINT_WIDTH,FINGERPRINT_HEIGHT);
    for(const value of gray.values)values[offset++]=Math.round(clamp(value,0,255));
  }
  return{values,clientWidth,clientHeight};
}
function fingerprintDistance(a,b){
  if(!(a?.values instanceof Uint8Array)||!(b?.values instanceof Uint8Array)||a.values.length!==2304||b.values.length!==2304||a.clientWidth!==b.clientWidth||a.clientHeight!==b.clientHeight)return 255;
  let maximum=0;
  for(let start=0;start<a.values.length;start+=256){let sum=0;for(let i=start;i<start+256;i++)sum+=Math.abs(a.values[i]-b.values[i]);maximum=Math.max(maximum,sum/256);}
  return maximum;
}
function fingerprintChanged(a,b,threshold=4){return fingerprintDistance(a,b)>(Number.isFinite(threshold)?Math.max(0,threshold):4);}
module.exports={layout,prepareTemplates,detectRerolls,fingerprint,fingerprintDistance,fingerprintChanged};
