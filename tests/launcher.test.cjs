const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
const windows=process.platform==='win32';
const root=path.resolve(__dirname,'..');
const key='0.4.1-0123456789ab-89abcdef';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function fixture(t,{instrument=true,folder='目录 & spaces (fixture)'}={}){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'hexthon-launcher-test-'));
  const directory=path.join(temporary,folder),appData=path.join(temporary,'isolated appdata'),dataRoot=path.join(appData,'Hexthon');
  await fs.mkdir(directory,{recursive:true});await fs.mkdir(appData,{recursive:true});
  t.after(async()=>{
    const resolved=path.resolve(temporary),tempRoot=path.resolve(os.tmpdir())+path.sep;
    assert.ok(resolved.startsWith(tempRoot)&&path.basename(resolved).startsWith('hexthon-launcher-test-'));
    // The wrapper waits for its hidden WSH resolver, not the application. Retry
    // only cleanup of our verified fixture while Windows releases file handles.
    await fs.rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  });
  for(const filename of ['HexthonLauncher.vbs','Start-Hexthon.vbs','Stop-Hexthon.vbs']){
    let source=await fs.readFile(path.join(root,filename),'utf8');
    if(filename==='HexthonLauncher.vbs'&&instrument){
      // Execute the actual VBScript resolver/validation through Windows Script
      // Host. Replace only the final process creation boundary with a recorder;
      // fixtures never run a real/custom Hexthon executable or touch the desktop.
      const boundary='  ExecuteHidden = shell.Run(value, 0, False)';
      assert.equal(source.split(boundary).length,2);
      source=source.replace(boundary,[
        '  Dim probe',
        '  If Not fso.FolderExists(dataRoot) Then fso.CreateFolder dataRoot',
        '  Set probe = fso.CreateTextFile(fso.BuildPath(dataRoot, "probe.txt"), True, True)',
        '  probe.Write value & vbLf & shell.CurrentDirectory',
        '  probe.Close',
        '  ExecuteHidden = 0',
      ].join('\r\n'));
    }
    await fs.writeFile(path.join(directory,filename),source);
  }
  const write=async(relative,value='fixture')=>{const target=path.join(directory,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,value);};
  const workspace=async()=>{for(const name of ['node_modules/electron/dist/electron.exe','package.json','src/main.cjs'])await write(name);};
  const packaged=async(base=directory)=>{
    for(const name of ['Hexthon.exe','resources/app/package.json','resources/app/src/main.cjs','resources/app/src/controller.cjs']){
      const target=path.join(base,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,'not executable: resolver fixture only');
    }
    return base;
  };
  const active=async(value=key,{valid=true}={})=>{
    const updateRoot=path.join(dataRoot,'updates');await fs.mkdir(updateRoot,{recursive:true});
    await fs.writeFile(path.join(updateRoot,'active-path.txt'),value);
    const target=path.join(updateRoot,'packages',key,'Hexthon-win32-x64');
    if(valid)await packaged(target);
    return target;
  };
  const invoke=async(filename,args=[])=>{
    await fs.unlink(path.join(dataRoot,'launcher-status.json')).catch(()=>{});
    await fs.unlink(path.join(dataRoot,'probe.txt')).catch(()=>{});
    let exitCode=0;
    try{await execute(path.join(process.env.SystemRoot||'C:\\Windows','System32','wscript.exe'),['//B','//NoLogo',path.join(directory,filename),...args],{windowsHide:true,timeout:10000,env:{...process.env,APPDATA:appData}});}
    catch(error){if(typeof error.code!=='number')throw error;exitCode=error.code;}
    let status=null;
    const until=Date.now()+5000;
    while(Date.now()<until){try{status=JSON.parse(await fs.readFile(path.join(dataRoot,'launcher-status.json'),'utf8'));break;}catch{await sleep(20);}}
    assert.ok(status,'WSH must write a status rather than silently fail compilation');
    let probe=null;
    try{probe=(await fs.readFile(path.join(dataRoot,'probe.txt'),'utf16le')).replace(/^\uFEFF/,'').split('\n');}catch{}
    return {exitCode,status,probe};
  };
  return {directory,appData,dataRoot,write,workspace,packaged,active,invoke};
}

test('Windows source launchers preserve spaced Unicode paths and request only assist/quit without changing paused settings',{skip:!windows,timeout:20000},async t=>{
  const f=await fixture(t);await f.workspace();await fs.mkdir(f.dataRoot,{recursive:true});
  const settings=path.join(f.dataRoot,'settings.json'),paused='{"autoScan":false,"recognitionPaused":true}';await fs.writeFile(settings,paused);
  for(const [filename,action,flag] of [['Start-Hexthon.vbs','start','--assist'],['Stop-Hexthon.vbs','stop','--quit']]){
    const result=await f.invoke(filename);
    assert.equal(result.status.status,'requested');assert.equal(result.status.source,'workspace');assert.equal(result.status.action,action);
    assert.equal(result.status.startupVerified,false);
    assert.equal(result.probe[0],`"${path.join(f.directory,'node_modules/electron/dist/electron.exe')}" "${f.directory}" ${flag}`);
    assert.equal(result.probe[1],f.directory);assert.equal(await fs.readFile(settings,'utf8'),paused);
    assert.doesNotMatch(result.probe[0],/--panel|--paused|cmd\.exe|powershell/i);
  }
});

test('a valid committed update is preferred over both packaged and workspace entries',{skip:!windows,timeout:12000},async t=>{
  const f=await fixture(t);await f.workspace();await f.packaged();const target=await f.active();
  const result=await f.invoke('HexthonLauncher.vbs',['start']);
  assert.equal(result.status.source,'update');assert.equal(result.probe[0],`"${path.join(target,'Hexthon.exe')}" --assist`);
  assert.equal(result.probe[1],target);assert.doesNotMatch(JSON.stringify(result.status),/0123456789|appdata|fixture/);
});

test('traversal, command text, newline and oversized active pointers cannot escape the package key contract',{skip:!windows,timeout:20000},async t=>{
  const f=await fixture(t);await f.packaged();
  for(const value of ['../outside',`${key}" & calc.exe`,key+'\n','x'.repeat(500),key.toUpperCase()]){
    await f.active(value);const result=await f.invoke('HexthonLauncher.vbs',['start']);
    assert.equal(result.status.source,'packaged');assert.equal(result.probe[0],`"${path.join(f.directory,'Hexthon.exe')}" --assist`);
    assert.doesNotMatch(result.probe[0],/calc|outside/);
  }
});

test('a pointer to an incomplete update falls back, and a packaged app needs its required resources',{skip:!windows,timeout:12000},async t=>{
  const f=await fixture(t);await f.workspace();await f.write('Hexthon.exe');await f.active(key,{valid:false});
  let result=await f.invoke('HexthonLauncher.vbs',['stop']);assert.equal(result.status.source,'workspace');
  await f.packaged();result=await f.invoke('HexthonLauncher.vbs',['stop']);assert.equal(result.status.source,'packaged');
});

test('only exact start/stop commands are accepted and failure diagnostics contain no supplied command text',{skip:!windows,timeout:15000},async t=>{
  const f=await fixture(t);await f.workspace();
  for(const args of [[],['start','--panel'],['START'],['start & calc.exe'],['--quit']]){
    const result=await f.invoke('HexthonLauncher.vbs',args);
    assert.equal(result.exitCode,1);assert.equal(result.status.code,'LAUNCHER_INVALID_COMMAND');assert.equal(result.probe,null);
    assert.doesNotMatch(JSON.stringify(result.status),/calc|--panel|START|--quit/);
  }
});

test('missing source and missing helper produce fixed error codes without an application launch',{skip:!windows,timeout:12000},async t=>{
  const f=await fixture(t,{instrument:false});
  let result=await f.invoke('HexthonLauncher.vbs',['start']);assert.equal(result.status.code,'LAUNCHER_SOURCE_MISSING');
  assert.equal(result.probe,null);
  await fs.unlink(path.join(f.directory,'HexthonLauncher.vbs'));
  result=await f.invoke('Start-Hexthon.vbs');assert.equal(result.status.code,'LAUNCHER_HELPER_MISSING');assert.equal(result.exitCode,1);
});

test('environment-variable syntax in a path is rejected rather than expanded into a different launch target',{skip:!windows,timeout:12000},async t=>{
  const f=await fixture(t,{folder:'literal %TEMP% folder'});await f.workspace();
  const result=await f.invoke('HexthonLauncher.vbs',['start']);
  assert.equal(result.status.code,'LAUNCHER_UNSUPPORTED_PATH');assert.equal(result.probe,null);
});
