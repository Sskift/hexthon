const {execFile}=require('node:child_process');
function gameIsClosed({execute=execFile,platform=process.platform}={}){
  if(platform!=='win32')return Promise.resolve(false);
  const code=`$ErrorActionPreference='Stop';$hexthonGames=@(Get-CimInstance Win32_Process -Filter "Name='League of Legends.exe'" -ErrorAction Stop);ConvertTo-Json -Compress -InputObject @{count=$hexthonGames.Count}`;
  return new Promise(resolve=>execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,timeout:3000,maxBuffer:1024},(error,stdout)=>{
    if(error)return resolve(false);try{const result=JSON.parse(stdout.replace(/^\uFEFF/,''));resolve(result.count===0);}catch{resolve(false);}
  }));
}
module.exports={gameIsClosed};
