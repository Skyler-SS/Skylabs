const {execFile}=require('node:child_process'),{promisify}=require('node:util'),path=require('node:path');
const run=promisify(execFile);

// WSL registers Ubuntu under different names depending on how it was installed:
// the Microsoft Store image appears as 'Ubuntu', a versioned install as
// 'Ubuntu-24.04'. Hardcoding one name made every GPU call on a machine with the
// other fail with WSL_E_DISTRO_NOT_FOUND, which surfaced only as "GPU solver is
// unavailable" with no way to tell a naming mismatch from a missing runtime.
const PREFERRED_DISTRO='Ubuntu-24.04';
let distro=PREFERRED_DISTRO;
function currentDistro(){return distro;}

const NUL=String.fromCharCode(0),LF=String.fromCharCode(10);
function stripNul(t){return t.split(NUL).join('');}

async function listDistros(){
  const {stdout}=await run('wsl.exe',['--list','--quiet'],{windowsHide:true,timeout:15000});
  // wsl.exe writes UTF-16LE, so NUL bytes survive the utf8 decode.
  return stripNul(stdout).split(LF).map(x=>x.trim()).filter(Boolean);
}

// Resolved once per process and cached, because executionSpec is synchronous and
// runs only after runtime() has probed.
async function resolveDistro(){
  const names=await listDistros();
  if(names.includes(PREFERRED_DISTRO))return distro=PREFERRED_DISTRO;
  const ubuntu=names.find(n=>/^ubuntu/i.test(n));
  if(!ubuntu)throw Error('No Ubuntu WSL distribution is installed'
    +(names.length?' (WSL reports: '+names.join(', ')+')':'')+'.');
  return distro=ubuntu;
}
function quote(s){return "'"+String(s).replaceAll("'","'\"'\"'")+"'";}
function linuxPath(value){const full=path.win32.resolve(value).replaceAll('\\','/');if(!/^[A-Za-z]:\//.test(full))throw Error('GPU cases must be on a local Windows drive.');return '/mnt/'+full[0].toLowerCase()+full.slice(2);}
function executionSpec(folder,name,args=[]){if(!/^[A-Za-z][A-Za-z0-9]*$/.test(name))throw Error('Invalid GPU command.');return {executable:'wsl.exe',args:['-d',distro,'-u','root','--','bash','/opt/aerodesk/gpu-run.sh',linuxPath(folder),name,...args]};}
async function runtime(){
  // Report WHICH step failed. Collapsing every cause into one sentence made a
  // distro-name mismatch indistinguishable from an absent CUDA runtime.
  let name;
  try{name=await resolveDistro();}
  catch(e){throw Error('GPU solver is unavailable: '+e.message
    +' It needs WSL2 Ubuntu with the SkyLabs GPU runtime installed in /opt/aerodesk.');}
  try{
    const {stdout}=await run('wsl.exe',['-d',name,'-u','root','--','bash','/opt/aerodesk/gpu-probe.sh'],{windowsHide:true,timeout:15000});
    return {gpu:true,device:stdout.trim(),env:process.env};
  }catch(e){
    const detail=stripNul(String(e&&(e.stderr||e.message)||'')).trim();
    throw Error('GPU solver is unavailable in WSL distribution "'+name+'": '
      +(/No such file or directory/i.test(detail)
        ? 'the SkyLabs GPU runtime is not installed there (/opt/aerodesk is missing).'
        : (detail.split(LF)[0]||'the GPU probe failed.'))
      +' Select CPU, or finish the verified WSL CUDA installation.');
  }
}
async function memoryInfo(){await resolveDistro();const [memory,video]=await Promise.all([run('wsl.exe',['-d',distro,'-u','root','--','cat','/proc/meminfo'],{windowsHide:true,timeout:15000}),run('wsl.exe',['-d',distro,'-u','root','--','/usr/lib/wsl/lib/nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits'],{windowsHide:true,timeout:15000})]);const total=+(/MemTotal:\s+(\d+)/.exec(memory.stdout)?.[1]),free=+(/MemAvailable:\s+(\d+)/.exec(memory.stdout)?.[1]),vram=Number(video.stdout.trim().split(/\s/)[0]);if(![total,free,vram].every(v=>Number.isFinite(v)&&v>0))throw Error('Unable to verify available GPU/WSL memory.');return {memoryGB:total/1048576,freeGB:free/1048576,vramGB:vram/1024};}
function pressureSolver(){return `solver petsc;tolerance 1e-9;relTol .05;petsc {verbose true;options {mat_type "aijcusparse";ksp_type "cg";pc_type "gamg";mg_levels_ksp_type "chebyshev";mg_levels_pc_type "jacobi";ksp_max_it "1000";} caching {matrix always;preconditioner auto;}}`;}
async function cancel(folder){await require('node:fs/promises').writeFile(path.join(folder,'.aerodesk-cancel'),'stop');await run('wsl.exe',['-d',distro,'-u','root','--','bash','/opt/aerodesk/gpu-cancel.sh',linuxPath(folder)],{windowsHide:true,timeout:15000});}
module.exports={runtime,executionSpec,linuxPath,quote,pressureSolver,currentDistro,resolveDistro,listDistros,cancel,memoryInfo};


