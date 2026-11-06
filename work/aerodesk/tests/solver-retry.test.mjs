import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url);
const {Job}=require('../openfoam.cjs');

// attemptSolve re-runs a diverged solve once. createCase makes system/ and 0/ with a
// NON-recursive mkdir, so retrying over the same folder threw EEXIST and the recovery
// never actually ran - the retry looked implemented but could not work. These tests
// drive attemptSolve directly with a stubbed runSingle; a real solve takes an hour.
const harness=async(behaviour)=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'aerodesk-retry-'));
 await fs.mkdir(path.join(folder,'system'),{recursive:true});
 await fs.writeFile(path.join(folder,'system','controlDict'),'first attempt');
 const calls=[];
 const job=Object.create(Job.prototype);
 Object.assign(job,{folder,cancelled:false,diverged:{reason:'stale'},notices:[],
  notify(n){job.notices.push(n);}});
 job.runSingle=async(v,s,p,rt,opts={})=>{
  calls.push({firstOrder:!!p.firstOrder,relaxation:p.relaxation,opts});
  return behaviour(calls.length);
 };
 return {job,folder,calls};
};
const diverged=reason=>Object.assign(Error(reason),{diverged:true,reason});

test('a diverged solve retries into a clean folder instead of dying on EEXIST',async()=>{
 const {job,folder,calls}=await harness(n=>{
  if(n===1)throw diverged('Turbulence is diverging: k grew 18000x');
  return {cd:1.27,reliability:{status:'acceptable',blocking:[]}};
 });
 const result=await job.attemptSolve([],{},{},{});

 assert.equal(calls.length,2,'the retry must actually run');
 assert.equal(result.cd,1.27);

 // The second attempt is strongly damped and forced onto wall functions.
 assert.equal(calls[1].opts.forceWallFunctions,true);
 assert.equal(calls[1].opts.firstOrder,true);
 assert.deepEqual(calls[1].relaxation,{p:.3,U:.5,k:.3,omega:.3});

 // The failed attempt is preserved, not deleted: its log is the evidence.
 assert.equal(result.recovered.divergedCase,folder+'-diverged');
 assert.equal(await fs.readFile(path.join(folder+'-diverged','system','controlDict'),'utf8'),
  'first attempt');
 // ...and the live folder is out of the way so createCase can rebuild it.
 await assert.rejects(fs.access(folder),'the retry folder must not pre-exist');

 // The result says plainly that it is not accuracy-grade.
 assert.match(result.recovered.from,/Turbulence is diverging/);
 assert.match(result.recovered.note,/indicative/);
 assert.equal(result.reliability.acceptable,false);
 assert.equal(result.reliability.status,'needs-review');
 assert.ok(result.reliability.blocking.some(b=>/first-order/.test(b)));
 assert.equal(job.diverged,null,'stale divergence state must be cleared before retrying');
 assert.ok(job.notices.some(n=>/retrying with damped numerics/.test(n.stage||'')));

 await fs.rm(folder+'-diverged',{recursive:true,force:true});
});

test('it retries only once, and never after a cancel or a non-divergence fault',async()=>{
 const always=await harness(()=>{throw diverged('still diverging');});
 await assert.rejects(always.job.attemptSolve([],{},{},{}),/still diverging/);
 assert.equal(always.calls.length,2,'exactly one retry, then give up');

 const other=await harness(()=>{throw Error('snappyHexMesh ran out of memory');});
 await assert.rejects(other.job.attemptSolve([],{},{},{}),/out of memory/);
 assert.equal(other.calls.length,1,'a non-divergence failure is not retried');

 const stopped=await harness(()=>{throw diverged('diverging');});
 stopped.job.cancelled=true;
 await assert.rejects(stopped.job.attemptSolve([],{},{},{}),/diverging/);
 assert.equal(stopped.calls.length,1,'a cancelled run is not retried');
});
