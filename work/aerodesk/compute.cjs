const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
// MSMPI_BIN is set by the Microsoft MPI installer and is the authoritative location;
// a single hardcoded Program Files path misses non-default and non-English installs.
function mpiExecutable(){
 const candidates=[];
 if(process.env.MSMPI_BIN)candidates.push(path.join(process.env.MSMPI_BIN,'mpiexec.exe'));
 for(const base of [process.env.ProgramFiles,process.env['ProgramW6432'],'C:/Program Files'])
  if(base)candidates.push(path.join(base,'Microsoft MPI/Bin/mpiexec.exe'));
 for(const dir of String(process.env.PATH||'').split(path.delimiter))
  if(dir)candidates.push(path.join(dir,'mpiexec.exe'));
 return candidates.find(p=>{try{return fs.existsSync(p);}catch{return false;}})||null;
}
// Capping at 8 wasted most of a modern desktop; these are the counts the picker offers.
const WORKER_CHOICES=[1,2,4,8,12,16,24,32];
const WORKER_CAP=WORKER_CHOICES.at(-1);
function chooseWorkers(requested='auto',logical=os.cpus().length,cells=Infinity,available=!!mpiExecutable()){
 if(!['auto',...WORKER_CHOICES.map(String)].includes(String(requested)))
  throw Error('Choose Auto or one of '+WORKER_CHOICES.join(', ')+' CPU workers.');
 if(!available)return 1;
 // Leave half the logical cores for the OS and hyperthread siblings, and keep at least
 // 50k cells per worker so decomposition overhead does not dominate.
 const maximum=Math.max(1,Math.min(WORKER_CAP,Math.floor(logical/2),Math.floor(cells/50000)));
 return requested==='auto'?maximum:Math.max(1,Math.min(Number(requested),maximum));
}
function calibrationRate(calibration,workers){
 // Never apply a fast parallel measurement to a serial run or another worker count.
 const row=calibration?.byWorkers?.[workers]||(workers===1&&(!calibration?.workers||calibration.workers===1)?calibration:null);
 return Number.isFinite(row?.cellIterationsPerSecond)&&row.cellIterationsPerSecond>0?row.cellIterationsPerSecond:null;
}
function executionSpec(rt,name,args,workers=1){
 if(workers===1)return {executable:path.join(rt.bin,name+'.exe'),args};
 // The solver binary is the same one used serially: official OpenFOAM.com Windows
 // builds link it against an MPI-enabled Pstream, so no separate parallel build exists
 // or is needed. Requiring one made 32 usable cores look unavailable.
 if(!rt.mpi)throw Error('Microsoft MPI is not installed. Select 1 CPU worker.');
 if(!rt.parallel)throw Error('This OpenFOAM build has no MPI-enabled Pstream. Select 1 CPU worker.');
 if(name!=='simpleFoam')throw Error('Unsupported parallel command.');
 return {executable:rt.mpi,args:['-n',String(workers),'-priority','1',path.join(rt.bin,name+'.exe'),...args,'-parallel']};
}
module.exports={mpiExecutable,chooseWorkers,WORKER_CHOICES,calibrationRate,executionSpec};
