const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{pipeline}=require('node:stream/promises'),{Readable,Transform}=require('node:stream'),{createReadStream,createWriteStream}=require('node:fs'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),manifest=require('../work/aerodesk/package.json'),sources=require('./third-party-sources.json');
async function digest(file){const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function sourceArchive(row,directory){
 const file=path.join(directory,row.file);if(await digest(file).then(h=>h===row.sha256,()=>false))return;
 const response=await fetch(row.url,{signal:AbortSignal.timeout(300000)});if(!response.ok||!response.body)throw Error('Source download failed: '+row.file+' ('+response.status+')');
 let count=0;const limit=new Transform({transform(chunk,encoding,callback){count+=chunk.length;callback(count>200*1024*1024?Error('Source download exceeds limit'):null,chunk);}});
 const temporary=file+'.download';try{await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(temporary));if(await digest(temporary)!==row.sha256)throw Error('Source checksum mismatch: '+row.file);await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
}
async function main(){
 if(process.platform!=='win32')throw Error('Release packaging currently requires Windows.');
 if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version))throw Error('Invalid release version');
 const releases=path.join(root,'outputs/releases'),stage=path.join(releases,'v'+manifest.version),app=path.join(stage,'AeroDesk-win32-x64');
 await fs.access(path.join(app,'AeroDesk.exe'));const thirdParty=path.join(stage,'Third-party-source');await fs.mkdir(thirdParty,{recursive:true});
 for(const row of sources){console.log('Checking corresponding source: '+row.file);await sourceArchive(row,thirdParty);}
 await fs.copyFile(path.join(root,'docs/THIRD_PARTY_SOURCE.md'),path.join(thirdParty,'README.md'));
 await fs.copyFile(path.join(root,'docs/RUNTIME.md'),path.join(stage,'RUNTIME.md'));
 await fs.copyFile(path.join(root,'work/aerodesk/src/manual.html'),path.join(stage,'AeroDesk-user-manual.html'));
 await fs.copyFile(path.join(root,'LICENSE'),path.join(stage,'LICENSE'));
 await fs.writeFile(path.join(stage,'START-HERE.txt'),'AeroDesk '+manifest.version+' for Windows x64\r\n\r\nOpen AeroDesk-win32-x64\\AeroDesk.exe.\r\nThe app is unsigned. OpenFOAM and GPU runtimes are not included.\r\nRead RUNTIME.md to configure a compatible solver. Import/viewing work without it.\r\nThe ? button opens the manual. Keep Third-party-source with redistributed copies.\r\n');
 const zip=path.join(releases,'AeroDesk-'+manifest.version+'-win32-x64.zip');
 // Both paths are derived only from this repository and the validated version.
 await fs.rm(zip,{force:true});
 execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:AERODESK_ZIP_SOURCE, $env:AERODESK_ZIP_DESTINATION)'],{windowsHide:true,env:{...process.env,AERODESK_ZIP_SOURCE:stage,AERODESK_ZIP_DESTINATION:zip},stdio:'inherit'});
 await fs.writeFile(path.join(releases,'SHA256SUMS.txt'),await digest(zip)+'  '+path.basename(zip)+'\n');console.log('Ready to share: '+zip);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
