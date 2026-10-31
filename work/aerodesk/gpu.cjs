const {execFile}=require('node:child_process'),{promisify}=require('node:util'),path=require('node:path');
const run=promisify(execFile),distro='Ubuntu-24.04';
function quote(s){return "'"+String(s).replaceAll("'","'\"'\"'")+"'";}
function linuxPath(value){const full=path.win32.resolve(value).replaceAll('\\','/');if(!/^[A-Za-z]:\//.test(full))throw Error('GPU cases must be on a local Windows drive.');return '/mnt/'+full[0].toLowerCase()+full.slice(2);}
function executionSpec(folder,name,args=[]){if(!/^[A-Za-z][A-Za-z0-9]*$/.test(name))throw Error('Invalid GPU command.');return {executable:'wsl.exe',args:['-d',distro,'-u','root','--','bash','/opt/aerodesk/gpu-run.sh',linuxPath(folder),name,...args]};}
async function runtime(){try{const {stdout}=await run('wsl.exe',['-d',distro,'-u','root','--','bash','/opt/aerodesk/gpu-probe.sh'],{windowsHide:true,timeout:15000});return {gpu:true,device:stdout.trim(),env:process.env};}catch{throw Error('GPU solver is unavailable. Select CPU, or finish the verified WSL CUDA installation.');}}
async function memoryInfo(){const [memory,video]=await Promise.all([run('wsl.exe',['-d',distro,'-u','root','--','cat','/proc/meminfo'],{windowsHide:true,timeout:15000}),run('wsl.exe',['-d',distro,'-u','root','--','/usr/lib/wsl/lib/nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits'],{windowsHide:true,timeout:15000})]);const total=+(/MemTotal:\s+(\d+)/.exec(memory.stdout)?.[1]),free=+(/MemAvailable:\s+(\d+)/.exec(memory.stdout)?.[1]),vram=Number(video.stdout.trim().split(/\s/)[0]);if(![total,free,vram].every(v=>Number.isFinite(v)&&v>0))throw Error('Unable to verify available GPU/WSL memory.');return {memoryGB:total/1048576,freeGB:free/1048576,vramGB:vram/1024};}
function pressureSolver(){return `solver petsc;tolerance 1e-9;relTol .05;petsc {verbose true;options {mat_type "aijcusparse";ksp_type "cg";pc_type "gamg";mg_levels_ksp_type "chebyshev";mg_levels_pc_type "jacobi";ksp_max_it "1000";} caching {matrix always;preconditioner auto;}}`;}
async function cancel(folder){await require('node:fs/promises').writeFile(path.join(folder,'.aerodesk-cancel'),'stop');await run('wsl.exe',['-d',distro,'-u','root','--','bash','/opt/aerodesk/gpu-cancel.sh',linuxPath(folder)],{windowsHide:true,timeout:15000});}
module.exports={runtime,executionSpec,linuxPath,quote,pressureSolver,distro,cancel,memoryInfo};


