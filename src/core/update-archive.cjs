// Portable releases are extracted into a new directory, never over a running app.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createReadStream,createWriteStream}=require('node:fs');
const {pipeline}=require('node:stream/promises');
const {Transform}=require('node:stream');
const {createInflateRaw}=require('node:zlib');
const LIMITS={archive:600*1024*1024,total:1500*1024*1024,file:300*1024*1024,files:10000,manifest:3*1024*1024};
const ROOT='Hexthon-win32-x64/';
function safePath(name){
  if(typeof name!=='string'||name.length>500||name.includes('\\')||!name.startsWith(ROOT))throw new Error('UPDATE_UNSAFE_PATH');
  const parts=name.replace(/\/$/,'').split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f<>:"|?*]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw new Error('UPDATE_UNSAFE_PATH');
  return name;
}
async function readAt(handle,length,position){const b=Buffer.alloc(length);const {bytesRead}=await handle.read(b,0,length,position);if(bytesRead!==length)throw new Error('UPDATE_TRUNCATED_ZIP');return b;}
async function inspectArchive(filename){
  const handle=await fs.open(filename,'r');
  try{
    const {size}=await handle.stat();if(size<22||size>LIMITS.archive)throw new Error('UPDATE_ARCHIVE_SIZE');
    const tail=await readAt(handle,Math.min(size,65557),Math.max(0,size-65557));let end=-1;
    for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
    if(end<0)throw new Error('UPDATE_ZIP_DIRECTORY');
    const count=tail.readUInt16LE(end+10),length=tail.readUInt32LE(end+12),offset=tail.readUInt32LE(end+16);
    if(tail.readUInt16LE(end+4)||tail.readUInt16LE(end+6)||count!==tail.readUInt16LE(end+8)||!count||count>LIMITS.files||length>4*1024*1024||offset+length!==size-tail.length+end)throw new Error('UPDATE_ZIP_DIRECTORY');
    const directory=await readAt(handle,length,offset),entries=[],seen=new Set();let at=0,total=0;
    for(let i=0;i<count;i++){
      if(at+46>directory.length||directory.readUInt32LE(at)!==0x02014b50)throw new Error('UPDATE_ZIP_DIRECTORY');
      const flags=directory.readUInt16LE(at+8),method=directory.readUInt16LE(at+10),compressed=directory.readUInt32LE(at+20),bytes=directory.readUInt32LE(at+24),n=directory.readUInt16LE(at+28),extra=directory.readUInt16LE(at+30),comment=directory.readUInt16LE(at+32),start=directory.readUInt32LE(at+42),unixMode=directory.readUInt32LE(at+38)>>>16;
      if(at+46+n+extra+comment>directory.length||flags&~0x808||![0,8].includes(method)||(unixMode&0xf000)===0xa000||directory.readUInt16LE(at+34))throw new Error('UPDATE_UNSUPPORTED_ZIP');
      const name=safePath(directory.subarray(at+46,at+46+n).toString('utf8')),key=name.toLowerCase().replace(/\/$/,'');
      if(seen.has(key)||bytes>LIMITS.file||(total+=bytes)>LIMITS.total||start+30>offset)throw new Error('UPDATE_ARCHIVE_LIMIT');seen.add(key);
      const local=await readAt(handle,30,start);
      if(local.readUInt32LE(0)!==0x04034b50||local.readUInt16LE(6)!==flags||local.readUInt16LE(8)!==method)throw new Error('UPDATE_ZIP_HEADER');
      const localName=await readAt(handle,local.readUInt16LE(26),start+30);
      if(localName.toString('utf8')!==name)throw new Error('UPDATE_ZIP_HEADER');
      const data=start+30+local.readUInt16LE(26)+local.readUInt16LE(28);
      if(data+compressed>offset||(!compressed&&bytes)||name.endsWith('/')&&(bytes||compressed))throw new Error('UPDATE_ZIP_HEADER');
      entries.push({name,method,compressed,bytes,data,start});at+=46+n+extra+comment;
    }
    if(at!==directory.length)throw new Error('UPDATE_ZIP_DIRECTORY');
    const ranges=[...entries].sort((a,b)=>a.start-b.start);
    for(let i=1;i<ranges.length;i++)if(ranges[i].start<ranges[i-1].data+ranges[i-1].compressed)throw new Error('UPDATE_ZIP_OVERLAP');
    return entries;
  }finally{await handle.close();}
}
async function extractArchive(filename,target,{isCurrent=()=>true}={}){
  const entries=await inspectArchive(filename);
  await fs.mkdir(target,{recursive:false});
  for(const entry of entries){
    if(!isCurrent())throw new Error('UPDATE_GAME_ACTIVE');
    const destination=path.join(target,entry.name);
    if(entry.name.endsWith('/')){await fs.mkdir(destination,{recursive:true});continue;}
    await fs.mkdir(path.dirname(destination),{recursive:true});
    if(entry.bytes===0){await fs.writeFile(destination,'',{flag:'wx'});continue;}
    let written=0;const bound=new Transform({transform(chunk,_encoding,done){written+=chunk.length;done(written>entry.bytes?new Error('UPDATE_INFLATE_LIMIT'):null,chunk);}});
    const streams=[createReadStream(filename,{start:entry.data,end:entry.data+entry.compressed-1})];
    if(entry.method===8)streams.push(createInflateRaw());
    streams.push(bound,createWriteStream(destination,{flags:'wx'}));await pipeline(...streams);
    if(written!==entry.bytes)throw new Error('UPDATE_TRUNCATED_FILE');
  }
  return path.join(target,'Hexthon-win32-x64');
}
async function sha256(filename){const h=crypto.createHash('sha256');for await(const chunk of createReadStream(filename))h.update(chunk);return h.digest('hex');}
async function verifyDirectory(directory,version,{isCurrent=()=>true,expectedManifestSha256}={}){
  if(expectedManifestSha256!==undefined&&(typeof expectedManifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedManifestSha256)))throw new Error('UPDATE_MANIFEST_HASH');
  const file=path.join(directory,'manifest.json'),handle=await fs.open(file,'r');let bytes;
  try{
    const {size}=await handle.stat();if(size>LIMITS.manifest)throw new Error('UPDATE_MANIFEST_SIZE');
    bytes=await readAt(handle,size,0);if((await handle.stat()).size!==size)throw new Error('UPDATE_MANIFEST_SIZE');
  }finally{await handle.close();}
  // Freeze the exact downloaded manifest, not only its self-declared file hashes.
  // This protects cached-package continuity; it is not a publisher signature.
  const manifestSha256=crypto.createHash('sha256').update(bytes).digest('hex');
  if(expectedManifestSha256!==undefined&&manifestSha256!==expectedManifestSha256)throw new Error('UPDATE_MANIFEST_HASH');
  const manifest=JSON.parse(bytes.toString('utf8'));
  if(manifest.schemaVersion!==1||manifest.version!==version||manifest.platform!=='win32-x64'||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>LIMITS.files)throw new Error('UPDATE_MANIFEST_SCHEMA');
  const expected=new Set(),actual=[];let total=0;
  for(const row of manifest.files){
    safePath(ROOT+row.path);
    if(row.path.endsWith('/')||expected.has(row.path.toLowerCase())||!Number.isSafeInteger(row.size)||row.size<0||row.size>LIMITS.file||(total+=row.size)>LIMITS.total||!/^[a-f0-9]{64}$/.test(row.sha256))throw new Error('UPDATE_MANIFEST_SCHEMA');
    expected.add(row.path.toLowerCase());
  }
  async function visit(dir,prefix=''){for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    if(entry.isSymbolicLink())throw new Error('UPDATE_SYMLINK');
    if(entry.isDirectory())await visit(path.join(dir,entry.name),prefix+entry.name+'/');
    else if(entry.isFile())actual.push(prefix+entry.name);else throw new Error('UPDATE_FILE_TYPE');
  }}await visit(directory);
  if(actual.length!==expected.size+1||actual.some(name=>name!=='manifest.json'&&!expected.has(name.toLowerCase())))throw new Error('UPDATE_UNLISTED_FILE');
  for(const name of ['Hexthon.exe','resources/app/package.json','resources/app/src/main.cjs','resources/app/src/controller.cjs','resources/app/data/seed/index.json'])if(!expected.has(name.toLowerCase()))throw new Error('UPDATE_MISSING_FILE');
  for(const row of manifest.files){if(!isCurrent())throw new Error('UPDATE_GAME_ACTIVE');const filename=path.join(directory,row.path);if((await fs.stat(filename)).size!==row.size||await sha256(filename)!==row.sha256)throw new Error('UPDATE_FILE_HASH');}
  const pkg=JSON.parse(await fs.readFile(path.join(directory,'resources/app/package.json'),'utf8'));
  if(pkg.name!=='hexthon'||pkg.version!==version)throw new Error('UPDATE_PACKAGE_IDENTITY');
  return {version,files:expected.size,totalBytes:total,manifestSha256};
}
module.exports={LIMITS,ROOT,safePath,inspectArchive,extractArchive,sha256,verifyDirectory};
