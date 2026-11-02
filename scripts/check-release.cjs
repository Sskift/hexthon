// Real public release check; optional download/extraction stays in ignored QA.
// Never installs, changes the active entry point, or launches the package.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {AppUpdates}=require('../src/core/app-updates.cjs');
const {gameIsClosed}=require('../src/core/update-game-guard.cjs');
const version=require('../package.json').version;
(async()=>{
  const root=path.resolve(__dirname,'../.qa/release-download',crypto.randomUUID());
  const updater=new AppUpdates({root,currentVersion:'0.0.0'}),checked=await updater.check();
  if(checked.status!=='available'||checked.version!==version)throw new Error('Expected current release is not available');
  const report={version,metadataVerified:true,downloadVerified:false,actualInstallation:false,actualPackageLaunch:false};
  if(process.argv.includes('--stage')){
    if(!await gameIsClosed())throw new Error('Game state could not be verified idle; download check deferred');
    const staged=await updater.stage();if(staged.status!=='ready')throw new Error(staged.error||'Release could not be staged');
    report.downloadVerified=true;report.bytes=staged.downloadedBytes;report.archiveSha256=updater.staged.sha256;report.manifestSha256=updater.staged.manifestSha256;
  }
  await fs.mkdir(path.resolve(__dirname,'../.qa'),{recursive:true});await fs.writeFile(path.resolve(__dirname,`../.qa/release-${version}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
