const path=require('node:path');
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
 const folders=await packager({dir:__dirname,name:'AeroDesk',platform:'win32',arch:'x64',out,icon:path.join(__dirname,'app.ico'),asar:{unpack:'vendor/**'},overwrite:true,ignore});
 console.log('Packaged: '+folders.join(', '));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={ignore};
