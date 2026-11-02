const { packager } = require('@electron/packager');
const path = require('node:path');
packager({dir:path.resolve(__dirname,'..'),out:path.resolve(__dirname,'../dist'),name:'Hexthon',platform:'win32',arch:'x64',
  icon:path.resolve(__dirname,'../assets/icon.ico'),overwrite:false,asar:false,
  ignore:[/^\/\.research($|\/)/,/^\/\.qa($|\/)/,/^\/tests($|\/)/,/^\/docs($|\/)/,/^\/dist($|\/)/,/^\/\.git($|\/)/],
  executableName:'Hexthon',win32metadata:{CompanyName:'Hexthon',FileDescription:'Hexthon ARAM Mayhem Companion',ProductName:'Hexthon'},
}).then(paths=>console.log(paths.join('\n'))).catch(e=>{console.error(e.message);process.exitCode=1;});
