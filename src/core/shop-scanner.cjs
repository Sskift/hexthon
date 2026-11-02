const engine=require('./light-shop.cjs');
class LightShopScanner{
  constructor({now=Date.now,detector=engine,budgetMs=750}={}){this.now=now;this.detector=detector;this.budgetMs=budgetMs;this.reset();}
  reset(){this.scope=null;this.cursor=0;this.lock=null;this.nextAt=0;}
  async scan({width,height,scope,capture,read,isCurrent=()=>true,urgent=false}){
    if(scope!==this.scope){this.reset();this.scope=scope;}
    if(this.now()<this.nextAt&&!urgent)return {skipped:true,observation:null};
    const started=this.now(),stats={captures:0,pixels:0,ocrReads:0};
    const check=()=>{if(!isCurrent())throw new Error('STALE_SHOP_SCAN');if(this.now()-started>this.budgetMs)throw new Error('SHOP_SCAN_BUDGET');};
    const sample=async(region)=>{
      check();const frame=await capture(region);check();stats.captures++;stats.pixels+=frame.width*frame.height;
      return {frame,gate:this.detector.pixelGate(frame)};
    };
    const recognize=async(frame)=>{
      check();stats.ocrReads++;const out=await read(frame);check();return {...out,capturedAt:frame.capturedAt};
    };
    const finish=observation=>{
      if(!isCurrent())throw new Error('STALE_SHOP_SCAN');this.nextAt=this.now()+(observation.visible?650:900);
      return {observation,stats:{...stats,totalMs:this.now()-started}};
    };
    const none=()=>({visible:false,rect:null,evidence:[],observedAt:new Date(this.now()).toISOString()});
    const candidates=this.detector.headerRegions(width,height);
    let headers=this.lock?[this.lock.headerRegion]:candidates.slice(0,1);
    if(!this.lock&&candidates.length>=2){
      const [a,b]=candidates,x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
      headers=[{x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y}];
      if(candidates.length>2)headers.push(candidates[2+(this.cursor++%(candidates.length-2))]);
    }
    const count=headers.length;let footerReads=0;
    try{for(let i=0;i<count;i++){
      const region=headers[i];
      const {frame,gate}=await sample(region);
      if(!gate.candidate)continue;
      const header=this.detector.headerEvidence(await recognize(frame),frame.region);
      if(!header.candidate)continue;
      const footers=this.lock?[this.lock.footerRegion]:this.detector.footerRegions(header).slice(0,3);
      for(const footerRegion of footers){
        if(footerReads++>=3)break;
        const footer=await sample(footerRegion);
        if(!footer.gate.candidate)continue;
        const detection=this.detector.shopFromStrips(header,await recognize(footer.frame),footer.frame.region,{now:this.now()});
        if(detection.visible){this.lock={headerRegion:detection.headerRegion,footerRegion:detection.footerRegion};return finish(detection);}
      }
      if(footerReads>=3)break;
    }}catch(error){if(error.message!=='SHOP_SCAN_BUDGET')throw error;stats.budgetExceeded=true;}
    this.lock=null;return finish(none());
  }
}
module.exports={LightShopScanner};
