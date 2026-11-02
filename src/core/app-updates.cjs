const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {extractArchive,verifyDirectory,LIMITS}=require('./update-archive.cjs');
const REPO='Sskift/hexthon',API=`https://api.github.com/repos/${REPO}/releases/latest`;
const VERSION=/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
const KEY=/^\d+\.\d+\.\d+-[a-f0-9]{12}-[a-f0-9]{8}$/;
function compareVersions(a,b){if(!VERSION.test(a)||!VERSION.test(b))throw new Error('UPDATE_VERSION');const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return Math.sign(x[i]-y[i]);return 0;}
function releaseCandidate(release,current){
  const version=typeof release?.tag_name==='string'?release.tag_name.replace(/^v/,''):'';
  if(release?.draft!==false||release?.prerelease!==false||!VERSION.test(version)||release.tag_name!==`v${version}`)throw new Error('UPDATE_RELEASE_SCHEMA');
  if(compareVersions(version,current)<=0)return null;
  const name=`Hexthon-${version}-win32-x64.zip`,assets=(release.assets||[]).filter(a=>a.name===name);
  if(assets.length!==1)throw new Error('UPDATE_ASSET_MISSING');const asset=assets[0];
  const url=`https://github.com/${REPO}/releases/download/v${version}/${name}`;
  if(asset.state!=='uploaded'||asset.browser_download_url!==url||!Number.isSafeInteger(asset.size)||asset.size<22||asset.size>LIMITS.archive||!/^sha256:[a-f0-9]{64}$/.test(asset.digest))throw new Error('UPDATE_ASSET_UNVERIFIED');
  return {version,name,url,size:asset.size,sha256:asset.digest.slice(7),releaseUrl:`https://github.com/${REPO}/releases/tag/v${version}`};
}
function allowedUrl(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))throw new Error('UPDATE_REDIRECT_REJECTED');
  return u.href;
}
async function request(url,{signal,fetcher=fetch}={}){
  for(let i=0;i<6;i++){
    const r=await fetcher(allowedUrl(url),{redirect:'manual',signal,headers:{Accept:'application/vnd.github+json','User-Agent':'Hexthon-Updater','X-GitHub-Api-Version':'2022-11-28'}});
    if([301,302,303,307,308].includes(r.status)){const next=r.headers.get('location');await r.body?.cancel();if(!next)throw new Error('UPDATE_REDIRECT_REJECTED');url=new URL(next,url).href;continue;}
    return r;
  }throw new Error('UPDATE_REDIRECT_LIMIT');
}
async function jsonResponse(response){
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw new Error('UPDATE_METADATA_SIZE');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function atomicJson(filename,value){await fs.mkdir(path.dirname(filename),{recursive:true});const tmp=filename+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2),{flag:'wx'});await fs.rename(tmp,filename);}
async function readJson(filename,max=65536){try{if((await fs.stat(filename)).size>max)return null;return JSON.parse(await fs.readFile(filename,'utf8'));}catch{return null;}}
function installDirectory(root,key){if(!KEY.test(key))throw new Error('UPDATE_PACKAGE_KEY');return path.join(root,'packages',key,'Hexthon-win32-x64');}
function idleForUpdate(game){return !game?.liveConnected&&['Disconnected','None','Lobby','EndOfGame'].includes(game?.phase);}
function publicError(error){return /^UPDATE_[A-Z_]+$/.test(error?.message)?error.message:'UPDATE_NETWORK_OR_DISK';}
class AppUpdates{
  constructor({root,currentVersion,onChange=()=>{},fetcher=fetch,extract=extractArchive,verify=verifyDirectory}){
    this.root=root;this.currentVersion=currentVersion;this.onChange=onChange;this.fetcher=fetcher;this.extract=extract;this.verify=verify;this.busy=false;this.candidate=null;this.staged=null;
    this.state={status:'idle',currentVersion,version:null,downloadedBytes:0,totalBytes:0,error:null};
  }
  emit(patch){this.state={...this.state,...patch};this.onChange(this.snapshot());return this.snapshot();}
  snapshot(){return {...this.state};}
  async init(){
    const journal=await readJson(path.join(this.root,'result.json'));
    if(journal&&['updated','rolled-back','rollback-failed','parent-still-running'].includes(journal.status))this.emit({lastResult:{status:journal.status,version:VERSION.test(journal.version)?journal.version:null}});
    const staged=await readJson(path.join(this.root,'staged.json'));
    if(staged&&KEY.test(staged.key)&&VERSION.test(staged.version)&&compareVersions(staged.version,this.currentVersion)>0&&/^[a-f0-9]{64}$/.test(staged.sha256)&&typeof staged.manifestSha256==='string'&&/^[a-f0-9]{64}$/.test(staged.manifestSha256)&&staged.key.startsWith(`${staged.version}-${staged.sha256.slice(0,12)}-`)){
      this.staged={key:staged.key,version:staged.version,sha256:staged.sha256,manifestSha256:staged.manifestSha256};
      this.emit({status:'ready',version:staged.version});
    }
    return this.snapshot();
  }
  async check(){
    if(this.busy)throw new Error('UPDATE_BUSY');this.busy=true;
    this.emit({status:'checking',error:null});
    try{
      const response=await request(API,{fetcher:this.fetcher,signal:AbortSignal.timeout(15000)});
      if(response.status===404){this.candidate=null;return this.emit({status:'unpublished',version:null});}
      if(!response.ok)throw new Error(response.status===403||response.status===429?'UPDATE_RATE_LIMIT':'UPDATE_SERVER');
      this.candidate=releaseCandidate(await jsonResponse(response),this.currentVersion);
      return this.emit({status:this.candidate?'available':'current',version:this.candidate?.version||null,totalBytes:this.candidate?.size||0});
    }catch(error){this.candidate=null;return this.emit({status:'error',error:publicError(error)});}finally{this.busy=false;}
  }
  async stage({isCurrent=()=>true}={}){
    if(this.busy)throw new Error('UPDATE_BUSY');if(!this.candidate)throw new Error('UPDATE_CHECK_REQUIRED');if(!isCurrent())throw new Error('UPDATE_GAME_ACTIVE');
    this.busy=true;this.staged=null;this.emit({status:'downloading',downloadedBytes:0,error:null});
    const candidate={...this.candidate},key=`${candidate.version}-${candidate.sha256.slice(0,12)}-${crypto.randomBytes(4).toString('hex')}`;
    const folder=path.join(this.root,'packages'),archive=path.join(this.root,`${key}.zip`),destination=path.join(folder,key);
    let handle;
    try{
      await fs.mkdir(folder,{recursive:true});handle=await fs.open(archive,'wx');
      const response=await request(candidate.url,{fetcher:this.fetcher,signal:AbortSignal.timeout(180000)});
      if(!response.ok)throw new Error('UPDATE_DOWNLOAD_FAILED');
      let count=0,last=0;const hash=crypto.createHash('sha256');
      for await(const chunk of response.body){
        if(!isCurrent())throw new Error('UPDATE_GAME_ACTIVE');count+=chunk.length;if(count>candidate.size)throw new Error('UPDATE_DOWNLOAD_SIZE');
        hash.update(chunk);await handle.writeFile(chunk);if(Date.now()-last>250){last=Date.now();this.emit({downloadedBytes:count});}
      }
      await handle.close();handle=null;
      if(count!==candidate.size||hash.digest('hex')!==candidate.sha256)throw new Error('UPDATE_DOWNLOAD_HASH');
      if(!isCurrent())throw new Error('UPDATE_GAME_ACTIVE');this.emit({status:'verifying',downloadedBytes:count});
      const directory=await this.extract(archive,destination,{isCurrent}),verified=await this.verify(directory,candidate.version,{isCurrent});
      if(!isCurrent())throw new Error('UPDATE_GAME_ACTIVE');
      if(typeof verified?.manifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(verified.manifestSha256))throw new Error('UPDATE_MANIFEST_HASH');
      const staged={key,version:candidate.version,sha256:candidate.sha256,manifestSha256:verified.manifestSha256};
      await atomicJson(path.join(this.root,'staged.json'),staged);this.staged=staged;
      return this.emit({status:'ready',version:candidate.version});
    }catch(error){return this.emit({status:'error',error:publicError(error)});}finally{if(handle)await handle.close().catch(()=>{});this.busy=false;}
  }
  async prepare({previous,parentPid,isCurrent=()=>true}={}){
    if(this.busy||!this.staged)throw new Error('UPDATE_NOT_READY');if(!isCurrent())throw new Error('UPDATE_GAME_ACTIVE');this.busy=true;
    try{
      if(typeof this.staged.manifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(this.staged.manifestSha256))throw new Error('UPDATE_MANIFEST_HASH');
      await this.verify(installDirectory(this.root,this.staged.key),this.staged.version,{isCurrent,expectedManifestSha256:this.staged.manifestSha256});
      if(!isCurrent())throw new Error('UPDATE_GAME_ACTIVE');
      const token=crypto.randomUUID(),plan={schemaVersion:1,token,createdAt:Date.now(),parentPid,target:this.staged,previous};
      const filename=path.join(this.root,`plan-${token}.json`);await atomicJson(filename,plan);return {filename,token};
    }finally{this.busy=false;}
  }
}
module.exports={AppUpdates,VERSION,KEY,REPO,API,compareVersions,releaseCandidate,allowedUrl,request,atomicJson,readJson,installDirectory,idleForUpdate,publicError};
