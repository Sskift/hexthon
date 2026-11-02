// Package validation and integrity manifest. Hashes do not replace code signing.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createReadStream}=require('node:fs');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const directory=process.env.HEXTHON_BUILD_DIRECTORY||version;
if(!/^\d+\.\d+\.\d+(?:-[a-z0-9]+)?$/.test(directory))throw new Error('Invalid build directory name');
const release=path.join(root,'dist',directory,'Hexthon-win32-x64');
async function list(directory,prefix=''){
  const out=[];
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const name=prefix+entry.name;
    if(entry.isSymbolicLink())throw new Error('Release contains a symbolic link');
    if(entry.isDirectory())out.push(...await list(path.join(directory,entry.name),name+'/'));else if(entry.isFile())out.push(name);
  }return out.sort();
}
async function hash(filename){const sum=crypto.createHash('sha256');for await(const chunk of createReadStream(filename))sum.update(chunk);return sum.digest('hex');}
(async()=>{
  const files=await list(release);
  const base='resources/app/';
  // npm dependencies can ship their public tests.js or .github metadata;
  // reject our workspace/private files, without mislabelling dependency files.
  const disallowed=files.filter(name=>name.startsWith(base)&&!name.startsWith(base+'node_modules/')&&/(^|\/)(?:\.qa|\.research|\.git|\.github|experiments|tests|\.env)(?:\/|$|\.)/.test(name));
  if(disallowed.length)throw new Error('Release includes development or private files');
  for(const required of ['Hexthon.exe',base+'src/main.cjs',base+'src/controller.cjs',base+'src/native/window-capture.ps1',base+'src/native/ocr.ps1',base+'data/seed/index.json',base+'data/static/riot.json']){
    if(!files.includes(required))throw new Error(`Missing required release file: ${required}`);
  }
  const pkg=JSON.parse(await fs.readFile(path.join(release,base,'package.json'),'utf8'));
  if(pkg.version!==version)throw new Error('Package version mismatch');
  const manifest=JSON.parse(await fs.readFile(path.join(release,base,'assets/manifest.json'),'utf8'));
  for(const filename of Object.values(manifest)){
    if(typeof filename!=='string'||filename.includes('..')||path.isAbsolute(filename)||!files.includes(base+'assets/opgg/'+filename.replaceAll('\\','/')))throw new Error('Missing or unsafe packaged asset');
  }
  const entries=[];
  for(const name of files){const filename=path.join(release,name);entries.push({path:name,size:(await fs.stat(filename)).size,sha256:await hash(filename)});}
  const output=path.join(root,'dist',directory,'manifest.json');
  await fs.writeFile(output,JSON.stringify({schemaVersion:1,version,platform:'win32-x64',codeSigning:'not-configured',autoUpdate:false,
    note:'SHA-256 verifies file integrity only. Do not bypass Windows application-control policy. Keep a previous version for manual rollback.',files:entries},null,2));
  console.log(JSON.stringify({passed:true,version,files:entries.length,totalBytes:entries.reduce((sum,row)=>sum+row.size,0),manifest:output,codeSigning:'not-configured'}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
