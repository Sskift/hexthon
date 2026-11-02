const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {deflateRawSync}=require('node:zlib');
const {ROOT,LIMITS,safePath,inspectArchive,extractArchive,verifyDirectory}=require('../src/core/update-archive.cjs');
const {AppUpdates,API,REPO,installDirectory}=require('../src/core/app-updates.cjs');
const {runUpdateTransaction}=require('../src/core/update-transaction.cjs');
const VERSION='0.4.1';
function crc32(bytes){let sum=0xffffffff;for(const byte of bytes){sum^=byte;for(let i=0;i<8;i++)sum=(sum>>>1)^((sum&1)?0xedb88320:0);}return(sum^0xffffffff)>>>0;}
function zip(rows){
  const local=[],central=[];let offset=0;
  for(const row of rows){
    const name=Buffer.from(row.name),data=Buffer.from(row.data||''),method=row.method||0,compressed=method===8?deflateRawSync(data):data,bytes=row.bytes??data.length;
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(method,8);
    h.writeUInt32LE(crc32(data),14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(bytes,22);h.writeUInt16LE(name.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(0x0314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(method,10);
    c.writeUInt32LE(crc32(data),16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(bytes,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(((row.mode??0x81a4)<<16)>>>0,38);c.writeUInt32LE(offset,42);
    local.push(h,name,compressed);central.push(c,name);offset+=h.length+name.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(rows.length,8);end.writeUInt16LE(rows.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
async function isolated(run){
  const tempRoot=path.resolve(os.tmpdir()),directory=await fs.mkdtemp(path.join(tempRoot,'hexthon-archive-test-'));
  try{return await run(directory);}finally{
    assert.equal(path.dirname(path.resolve(directory)),tempRoot);assert.ok(path.basename(directory).startsWith('hexthon-archive-test-'));
    await fs.rm(directory,{recursive:true,force:true});
  }
}
function packageRows(){
  const files={
    'Hexthon.exe':Buffer.from('fixture executable bytes, never executed'),
    'resources/app/package.json':Buffer.from(JSON.stringify({name:'hexthon',version:VERSION})),
    'resources/app/src/main.cjs':Buffer.from('// fixture main'),
    'resources/app/src/controller.cjs':Buffer.from('// fixture controller'),
    'resources/app/data/seed/index.json':Buffer.from('{"champions":[]}'),
    'resources/app/assets/图标.txt':Buffer.from('local fixture'),
    'empty.txt':Buffer.alloc(0),
  };
  const manifest={schemaVersion:1,version:VERSION,platform:'win32-x64',files:Object.entries(files).map(([name,data])=>({path:name,size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')}))};
  return [...Object.entries(files).map(([name,data],i)=>({name:ROOT+name,data,method:i%2?8:0})),{name:ROOT+'manifest.json',data:JSON.stringify(manifest),method:8}];
}
test('release paths reject traversal, Windows aliases, streams and cross-platform separators',()=>{
  assert.equal(safePath(ROOT+'resources/app/data.json'),ROOT+'resources/app/data.json');assert.equal(safePath(ROOT),ROOT);
  for(const name of ['../escape','other/file',ROOT+'../escape',ROOT+'./x',ROOT+'a//b',ROOT+'a\\..\\b',ROOT+'C:/x',ROOT+'item:stream',ROOT+'NUL.txt',ROOT+'con',ROOT+'LPT1.json',ROOT+'file.',ROOT+'file ',ROOT+'bad\u0000name'])assert.throws(()=>safePath(name),/UPDATE_UNSAFE_PATH/);
});
test('stored and compressed package files extract into a fresh directory and match the manifest',async()=>isolated(async directory=>{
  const file=path.join(directory,'release.zip');await fs.writeFile(file,zip(packageRows()));const entries=await inspectArchive(file);assert.equal(entries.length,8);
  const output=await extractArchive(file,path.join(directory,'fresh'));const result=await verifyDirectory(output,VERSION);
  assert.equal(result.files,7);assert.equal(await fs.readFile(path.join(output,'resources/app/assets/图标.txt'),'utf8'),'local fixture');
  assert.equal((await fs.stat(path.join(output,'empty.txt'))).size,0);
}));
test('archive inspection refuses duplicate case-insensitive paths, symlinks and advertised oversized files',async()=>isolated(async directory=>{
  const cases=[
    [{name:ROOT+'File',data:'a'},{name:ROOT+'file',data:'b'}],
    [{name:ROOT+'link',data:'../outside',mode:0xa1ff}],
    [{name:ROOT+'huge',data:'a',bytes:LIMITS.file+1}],
    [{name:ROOT+'../outside',data:'x'}],
  ];
  for(let i=0;i<cases.length;i++){const file=path.join(directory,`bad-${i}.zip`);await fs.writeFile(file,zip(cases[i]));await assert.rejects(inspectArchive(file),/UPDATE_/);}
}));
test('local and central filename disagreement is rejected before filesystem extraction',async()=>isolated(async directory=>{
  const data=zip([{name:ROOT+'file',data:'a'}]);data[30+ROOT.length]='X'.charCodeAt(0);
  const file=path.join(directory,'disagree.zip');await fs.writeFile(file,data);await assert.rejects(inspectArchive(file),/UPDATE_ZIP_HEADER/);
}));
test('inflated bytes exceeding the declared size fail without producing a verified package',async()=>isolated(async directory=>{
  const file=path.join(directory,'bomb.zip');await fs.writeFile(file,zip([{name:ROOT+'small',data:Buffer.alloc(100000,7),bytes:1,method:8}]));
  await assert.rejects(extractArchive(file,path.join(directory,'fresh')),/UPDATE_INFLATE_LIMIT/);
}));
test('an existing target directory is never overwritten and a cancelled extraction cannot start files',async()=>isolated(async directory=>{
  const file=path.join(directory,'release.zip'),target=path.join(directory,'old');await fs.writeFile(file,zip(packageRows()));await fs.mkdir(target);await fs.writeFile(path.join(target,'sentinel'),'retain');
  await assert.rejects(extractArchive(file,target),error=>error.code==='EEXIST');assert.equal(await fs.readFile(path.join(target,'sentinel'),'utf8'),'retain');
  const aborted=path.join(directory,'aborted');await assert.rejects(extractArchive(file,aborted,{isCurrent:()=>false}),/UPDATE_GAME_ACTIVE/);assert.deepEqual(await fs.readdir(aborted),[]);
}));
test('post-extraction changes, unlisted files and wrong package versions cannot pass verification',async()=>isolated(async directory=>{
  const file=path.join(directory,'release.zip');await fs.writeFile(file,zip(packageRows()));
  const changed=await extractArchive(file,path.join(directory,'changed'));await fs.writeFile(path.join(changed,'resources/app/src/main.cjs'),'// corrupt main');await assert.rejects(verifyDirectory(changed,VERSION),/UPDATE_FILE_HASH/);
  const extra=await extractArchive(file,path.join(directory,'extra'));await fs.writeFile(path.join(extra,'unlisted.dll'),'injected');await assert.rejects(verifyDirectory(extra,VERSION),/UPDATE_UNLISTED_FILE/);
  const wrong=await extractArchive(file,path.join(directory,'wrong'));await assert.rejects(verifyDirectory(wrong,'0.4.2'),/UPDATE_MANIFEST_SCHEMA/);
}));
test('rewriting both cached files and their manifest cannot bypass the digest frozen from a verified download',async()=>isolated(async directory=>{
  const root=path.join(directory,'updates'),data=zip(packageRows()),name=`Hexthon-${VERSION}-win32-x64.zip`,hash=crypto.createHash('sha256').update(data).digest('hex');
  const published={tag_name:`v${VERSION}`,draft:false,prerelease:false,assets:[{name,state:'uploaded',size:data.length,digest:'sha256:'+hash,browser_download_url:`https://github.com/${REPO}/releases/download/v${VERSION}/${name}`}]};
  const updates=new AppUpdates({root,currentVersion:'0.4.0',fetcher:async url=>new Response(url===API?JSON.stringify(published):data)});
  assert.equal((await updates.check()).status,'available');assert.equal((await updates.stage()).status,'ready');
  const output=installDirectory(root,updates.staged.key),frozen=updates.staged.manifestSha256;
  assert.match(frozen,/^[a-f0-9]{64}$/);assert.equal(frozen,(await verifyDirectory(output,VERSION)).manifestSha256);
  const previous={version:'0.4.0',exe:path.join(directory,'old','Hexthon.exe'),cwd:path.join(directory,'old'),args:[]};
  const prepared=await updates.prepare({parentPid:100,previous}),plan=JSON.parse(await fs.readFile(prepared.filename,'utf8'));
  assert.equal(plan.target.manifestSha256,frozen);

  const target='resources/app/src/main.cjs',changed=Buffer.from('// changed cached application');await fs.writeFile(path.join(output,target),changed);
  const manifestFile=path.join(output,'manifest.json'),manifest=JSON.parse(await fs.readFile(manifestFile,'utf8')),row=manifest.files.find(row=>row.path===target);
  row.size=changed.length;row.sha256=crypto.createHash('sha256').update(changed).digest('hex');await fs.writeFile(manifestFile,JSON.stringify(manifest));
  // Self-consistency alone would accept these two matching changes.
  assert.notEqual((await verifyDirectory(output,VERSION)).manifestSha256,frozen);
  await assert.rejects(verifyDirectory(output,VERSION,{expectedManifestSha256:frozen}),/UPDATE_MANIFEST_HASH/);
  const restarted=new AppUpdates({root,currentVersion:'0.4.0'});assert.equal((await restarted.init()).status,'ready');
  await assert.rejects(restarted.prepare({parentPid:100,previous}),/UPDATE_MANIFEST_HASH/);
  const launched=[];const result=await runUpdateTransaction({root,plan,isAlive:()=>false,spawnApp:descriptor=>{
    launched.push(descriptor);const child=new EventEmitter();child.pid=201;child.exitCode=null;child.unref=()=>{};return child;
  },observe:async()=>true});
  assert.equal(result.status,'rolled-back');assert.equal(launched.length,1);assert.equal(launched[0].exe,previous.exe);
}));
test('expected manifest digest is checked before parsing any changed manifest or walking its entries',async()=>isolated(async directory=>{
  const file=path.join(directory,'release.zip');await fs.writeFile(file,zip(packageRows()));const output=await extractArchive(file,path.join(directory,'fresh'));
  const {manifestSha256}=await verifyDirectory(output,VERSION);await fs.writeFile(path.join(output,'manifest.json'),'{invalid');
  await assert.rejects(verifyDirectory(output,VERSION,{expectedManifestSha256:manifestSha256}),/UPDATE_MANIFEST_HASH/);
  await assert.rejects(verifyDirectory(path.join(directory,'absent'),VERSION,{expectedManifestSha256:'invalid'}),/UPDATE_MANIFEST_HASH/);
}));
