const path=require('node:path');
const {Worker}=require('node:worker_threads');
// This worker receives only already captured HUD pixels and prepared template
// descriptors. It has no capture/input APIs and never writes images to disk.
class AugmentIconWorker{
  constructor({templates=[],timeoutMs=10000,createWorker=(file,options)=>new Worker(file,options)}={}){
    this.templates=templates;this.timeoutMs=Math.max(50,Math.min(30000,timeoutMs));this.createWorker=createWorker;
    this.worker=null;this.pending=null;this.closed=false;this.sequence=0;
  }
  fail(worker,code){
    if(this.worker!==worker)return;
    this.worker=null;const pending=this.pending;this.pending=null;
    if(pending){clearTimeout(pending.timer);pending.reject(new Error(code));}
    worker.terminate().catch(()=>{});
  }
  launch(){
    if(this.worker)return this.worker;
    const worker=this.createWorker(path.join(__dirname,'augment-icon-worker-thread.cjs'),
      {workerData:{templates:this.templates},resourceLimits:{maxOldGenerationSizeMb:128}});
    this.worker=worker;
    worker.on('message',reply=>{
      if(this.worker!==worker||!this.pending||reply?.id!==this.pending.id)return;
      if(reply.ok!==true||!Array.isArray(reply.result?.matches)){this.fail(worker,'AUGMENT_WORKER_FAILED');return;}
      const pending=this.pending;this.pending=null;clearTimeout(pending.timer);worker.unref();pending.resolve(reply.result);
    });
    worker.on('error',()=>this.fail(worker,'AUGMENT_WORKER_FAILED'));
    worker.on('exit',()=>this.fail(worker,'AUGMENT_WORKER_EXIT'));
    worker.unref();return worker;
  }
  async read(frame){
    if(this.closed)throw new Error('AUGMENT_WORKER_CLOSED');
    if(this.pending)throw new Error('AUGMENT_WORKER_BUSY');
    if(!frame||![frame.width,frame.height].every(n=>Number.isInteger(n)&&n>0&&n<=2200)||
       frame.width*frame.height>2200*1000||!(Buffer.isBuffer(frame.bgraBuffer)||frame.bgraBuffer instanceof Uint8Array)||
       frame.bgraBuffer.length!==frame.width*frame.height*4)throw new Error('AUGMENT_WORKER_BITMAP');
    const r=frame.region;
    if(!r||!['x','y','width','height'].every(k=>Number.isFinite(r[k]))||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1.000001||r.y+r.height>1.000001)throw new Error('AUGMENT_WORKER_REGION');
    const worker=this.launch(),id=++this.sequence,pixels=Uint8Array.from(frame.bgraBuffer);
    const image={width:frame.width,height:frame.height,bgraBuffer:pixels,region:{x:r.x,y:r.y,width:r.width,height:r.height}};
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.fail(worker,'AUGMENT_WORKER_TIMEOUT'),this.timeoutMs);
      this.pending={id,timer,resolve,reject};worker.ref();
      try{worker.postMessage({id,image,observedAt:frame.capturedAt||frame.observedAt||new Date().toISOString()},[pixels.buffer]);}
      catch{this.fail(worker,'AUGMENT_WORKER_FAILED');}
    });
  }
  async close(){
    if(this.closed)return;this.closed=true;
    const worker=this.worker;this.worker=null;
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('AUGMENT_WORKER_CLOSED'));this.pending=null;}
    if(worker)await worker.terminate();
  }
}
module.exports={AugmentIconWorker};
