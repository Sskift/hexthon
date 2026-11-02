const {parentPort,workerData}=require('node:worker_threads');
const {matchAugmentIcons}=require('./augment-icons.cjs');
const templates=workerData.templates;
parentPort.on('message',request=>{
  try{
    const started=performance.now();
    const result=matchAugmentIcons(request.image,templates,{observedAt:request.observedAt});
    parentPort.postMessage({id:request.id,ok:true,result:{...result,durationMs:Math.round(performance.now()-started)}});
  }catch{parentPort.postMessage({id:request.id,ok:false});}
});
