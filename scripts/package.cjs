const { packager } = require('@electron/packager');
const path = require('node:path');
const fs = require('node:fs/promises');
const version = require('../package.json').version;
const directory=process.env.HEXTHON_BUILD_DIRECTORY||version;
if(!/^\d+\.\d+\.\d+(?:-[a-z0-9]+)?$/.test(directory))throw new Error('Invalid build directory name');
packager({dir:path.resolve(__dirname,'..'),out:path.resolve(__dirname,'../dist',directory),name:'Hexthon',platform:'win32',arch:'x64',
  icon:path.resolve(__dirname,'../assets/icon.ico'),overwrite:false,asar:false,
  ignore:[/^\/\.research($|\/)/,/^\/\.qa($|\/)/,/^\/experiments($|\/)/,/^\/tests($|\/)/,/^\/docs($|\/)/,/^\/dist($|\/)/,/^\/\.git($|\/)/,/^\/\.github($|\/)/,/^\/\.env($|\.)/],
  executableName:'Hexthon',win32metadata:{CompanyName:'Hexthon',FileDescription:'Hexthon ARAM Mayhem Companion',ProductName:'Hexthon'},
}).then(async paths=>{for(const directory of paths)for(const name of ['Start-Hexthon.vbs','Stop-Hexthon.vbs','HexthonLauncher.vbs'])await fs.copyFile(path.resolve(__dirname,'..',name),path.join(directory,name));console.log(paths.join('\n'));}).catch(e=>{console.error(e.message);process.exitCode=1;});
