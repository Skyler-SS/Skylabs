const path=require('node:path');
const fs=require('node:fs/promises');
const manifest=require('./package.json');
const shippedDirectories=new Set(['dist','vendor','fusion','gpu-runtime']);
function ignore(filename){
 const name=filename.replaceAll('\\','/').replace(/^\/+/,''),root=name.split('/')[0];
 if(!name)return false;
 if(/(^|\/)\.env(?:\.|$)|(^|\/)(credentials|secrets)(?:\/|\.)/i.test(name))return true;
 if(shippedDirectories.has(root))return false;
 if(name.includes('/'))return true;
 return !(['package.json','app.ico','LICENSE','README.txt','THIRD-PARTY-NOTICES.txt'].includes(name)||name.endsWith('.cjs')&&!/^(check-|build\.|package\.)/.test(name));
}
async function main(){
 if(process.platform!=='win32')throw Error('The distributable currently targets Windows x64. Run packaging on Windows.');
 if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version))throw Error('Invalid release version');
 const {packager}=await import('@electron/packager');
 const out=path.resolve(__dirname,'../../outputs/releases','v'+manifest.version);
 const folders=await packager({dir:__dirname,name:'AeroDesk',platform:'win32',arch:'x64',out,icon:path.join(__dirname,'app.ico'),asar:{unpackDir:'vendor'},overwrite:true,ignore});
 const {listPackage}=await import('@electron/asar');
 for(const folder of folders){
  const archive=path.join(folder,'resources/app.asar'),entries=listPackage(archive).map(name=>name.replaceAll('\\','/').replace(/^\//,''));
  for(const name of ['main.cjs','preload.cjs','dist/index.html','dist/app.js','dist/model-worker.cjs','LICENSE','THIRD-PARTY-NOTICES.txt'])if(!entries.includes(name))throw Error('Packaged app is missing '+name);
  for(const name of entries)if(ignore('/'+name))throw Error('Unexpected development/private file in package: '+name);
  for(const name of ['occt-import-js.cjs','occt-import-js.wasm','manifold.mjs','manifold.wasm','licenses/LICENSE_LGPL_21.txt','licenses/OCCT_LGPL_EXCEPTION.txt'])await fs.access(path.join(archive+'.unpacked','vendor',name));
 }
 console.log('Packaged: '+folders.join(', '));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={ignore};
