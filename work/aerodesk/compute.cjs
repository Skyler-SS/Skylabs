const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function mpiExecutable(){const candidates=[path.join(process.env.ProgramFiles||'C:/Program Files','Microsoft MPI/Bin/mpiexec.exe')];return candidates.find(p=>fs.existsSync(p))||null;}
function chooseWorkers(requested='auto',logical=os.cpus().length,cells=Infinity,available=!!mpiExecutable()){
 if(!['auto','1','2','4','8'].includes(String(requested)))throw Error('Choose Auto, 1, 2, 4 or 8 CPU workers.');
 if(!available)return 1;
 const maximum=Math.max(1,Math.min(8,Math.floor(logical/2),Math.floor(cells/50000)));
 return requested==='auto'?maximum:Math.max(1,Math.min(Number(requested),maximum));
}
function calibrationRate(calibration,workers){
 // Never apply a fast parallel measurement to a serial run or another worker count.
 const row=calibration?.byWorkers?.[workers]||(workers===1&&(!calibration?.workers||calibration.workers===1)?calibration:null);
 return Number.isFinite(row?.cellIterationsPerSecond)&&row.cellIterationsPerSecond>0?row.cellIterationsPerSecond:null;
}
function executionSpec(rt,name,args,workers=1){
 if(workers===1)return {executable:path.join(rt.bin,name+'.exe'),args};
 if(!rt.mpi||!rt.parallelBin)throw Error('Microsoft MPI or the parallel OpenFOAM runtime is missing. Select 1 CPU worker.');
 if(name!=='simpleFoam')throw Error('Unsupported parallel command.');
 return {executable:rt.mpi,args:['-n',String(workers),'-priority','1',path.join(rt.parallelBin,name+'.exe'),...args,'-parallel']};
}
module.exports={mpiExecutable,chooseWorkers,calibrationRate,executionSpec};
