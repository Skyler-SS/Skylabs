import test from 'node:test';import assert from 'node:assert/strict';import compute from '../compute.cjs';
test('worker selection reserves CPU capacity and avoids overpartitioning small meshes',()=>{
 // The ceiling is the machine's real core count, not a fixed 8: 585182 cells at the
 // 50k-per-worker floor allows 11, which is under half of 28 logical cores.
 assert.equal(compute.chooseWorkers('auto',28,585182,true),11);
 // Half the logical cores stays the ceiling once the mesh is large enough.
 assert.equal(compute.chooseWorkers('auto',32,1e9,true),16);
 assert.equal(compute.chooseWorkers('32',64,1e9,true),32,'the largest offered count is reachable');
 assert.equal(compute.chooseWorkers('auto',28,45000,true),1);
 assert.equal(compute.chooseWorkers('8',4,585182,true),2);
 assert.equal(compute.chooseWorkers('4',28,100000,true),2);
 assert.equal(compute.chooseWorkers('auto',28,585182,false),1);
 assert.throws(()=>compute.chooseWorkers('gpu',28,585182,true));
 assert.throws(()=>compute.chooseWorkers('7',28,585182,true),/Choose Auto or one of/);
});
test('parallel command keeps paths and arguments separate and preserves serial execution',()=>{
 // Official OpenFOAM.com Windows builds link the ordinary bin/simpleFoam.exe against an
 // MPI-enabled Pstream, so a parallel run uses the SAME binary as a serial one.
 // Demanding a separate parallel build made working multi-core hardware look unusable.
 const rt={bin:'C:/original runtime/bin',parallel:true,mpi:'C:/Microsoft MPI/mpiexec.exe'};
 const p=compute.executionSpec(rt,'simpleFoam',[],4);
 assert.equal(p.executable,rt.mpi);
 assert.deepEqual(p.args.slice(0,4),['-n','4','-priority','1']);
 assert.equal(p.args.at(-1),'-parallel');
 assert.match(p.args[4],/original runtime[\\/]bin[\\/]simpleFoam\.exe$/);
 assert.equal(compute.executionSpec(rt,'simpleFoam',[],1).args.length,0);
 assert.match(compute.executionSpec(rt,'simpleFoam',[],1).executable,/bin[\\/]simpleFoam\.exe$/);
 // Missing MPI and a non-MPI OpenFOAM build are different problems and say so.
 assert.throws(()=>compute.executionSpec({bin:'none',parallel:true},'simpleFoam',[],4),/Microsoft MPI is not installed/);
 assert.throws(()=>compute.executionSpec({bin:'none',mpi:'mpiexec.exe'},'simpleFoam',[],4),/no MPI-enabled Pstream/);
 // Only the solver runs under mpiexec; decomposePar and friends stay serial.
 assert.throws(()=>compute.executionSpec(rt,'decomposePar',[],4),/Unsupported parallel command/);
});
test('calibration never confuses single-worker and multicore throughput',()=>{
 const old={cellIterationsPerSecond:123};assert.equal(compute.calibrationRate(old,1),123);assert.equal(compute.calibrationRate(old,8),null);
 const c={...old,byWorkers:{4:{cellIterationsPerSecond:456}}};assert.equal(compute.calibrationRate(c,4),456);assert.equal(compute.calibrationRate(c,8),null);
});

test('the worker list is identical in the planner, the validator and the picker',async()=>{
 // Three copies exist: compute.cjs (planning), src/app.js (settings validation) and the
 // #cpuWorkers <select> (the UI). A 16-worker run failed at the validator alone while
 // the other two allowed it, so drift between them is checked here rather than found
 // at the end of an hour-long solve.
 const {readFile}=await import('node:fs/promises');
 const fromCompute=['auto',...compute.WORKER_CHOICES.map(String)];

 const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const declared=/const WORKER_CHOICES=\[([^\]]+)\]/.exec(app);
 assert.ok(declared,'src/app.js must declare WORKER_CHOICES');
 const fromApp=declared[1].split(',').map(x=>x.trim().replace(/^'|'$/g,''));
 assert.deepEqual(fromApp,fromCompute,'src/app.js validator disagrees with compute.cjs');

 const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
 const select=/<select id="cpuWorkers">([\s\S]*?)<\/select>/.exec(html);
 assert.ok(select,'index.html must contain the #cpuWorkers picker');
 const fromHtml=[...select[1].matchAll(/value="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(fromHtml,fromCompute,'the picker offers a different set from compute.cjs');
});
