import test from 'node:test';import assert from 'node:assert/strict';import compute from '../compute.cjs';
test('worker selection reserves CPU capacity and avoids overpartitioning small meshes',()=>{
 assert.equal(compute.chooseWorkers('auto',28,585182,true),8);
 assert.equal(compute.chooseWorkers('auto',28,45000,true),1);
 assert.equal(compute.chooseWorkers('8',4,585182,true),2);
 assert.equal(compute.chooseWorkers('4',28,100000,true),2);
 assert.equal(compute.chooseWorkers('auto',28,585182,false),1);
 assert.throws(()=>compute.chooseWorkers('gpu',28,585182,true));
});
test('parallel command keeps paths and arguments separate and preserves serial execution',()=>{
 const rt={bin:'C:/original runtime/bin',parallelBin:'C:/parallel runtime',mpi:'C:/Microsoft MPI/mpiexec.exe'};
 const p=compute.executionSpec(rt,'simpleFoam',[],4);assert.equal(p.executable,rt.mpi);assert.deepEqual(p.args.slice(0,4),['-n','4','-priority','1']);assert.equal(p.args.at(-1),'-parallel');assert.match(p.args[4],/parallel runtime[\\/]simpleFoam.exe$/);
 assert.equal(compute.executionSpec(rt,'simpleFoam',[],1).args.length,0);assert.throws(()=>compute.executionSpec({bin:'none'},'simpleFoam',[],4));
});
test('calibration never confuses single-worker and multicore throughput',()=>{
 const old={cellIterationsPerSecond:123};assert.equal(compute.calibrationRate(old,1),123);assert.equal(compute.calibrationRate(old,8),null);
 const c={...old,byWorkers:{4:{cellIterationsPerSecond:456}}};assert.equal(compute.calibrationRate(c,4),456);assert.equal(compute.calibrationRate(c,8),null);
});
