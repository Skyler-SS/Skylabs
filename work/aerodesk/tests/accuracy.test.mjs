import test from 'node:test';
import assert from 'node:assert/strict';
import {projectedArea} from '../src/reference-area.mjs';
import diagnostics from '../solver-diagnostics.cjs';
test('projected area unions overlapping surfaces and scales with length squared',()=>{
 const square=[0,0,0,1,0,0,1,0,1,0,0,0,1,0,1,0,0,1];
 assert.equal(projectedArea(square,1,128),1);assert.equal(projectedArea([...square,...square],1.37,128),1.37**2);
 assert.equal(projectedArea([0,0,0,0,1,0,0,0,1],1,128),0);
});
test('residual keeps first pressure solve, includes turbulence and resets per iteration',()=>{
 const job={residuals:{}};for(const line of ['Time = 1','Solving for Ux, Initial residual = 0.002','Solving for p, Initial residual = 0.004','Solving for p, Initial residual = 0.000001','Solving for omega, Initial residual = 0.003'])diagnostics.readResidualLine(job,line);
 assert.equal(job.residual,.004);assert.equal(job.residuals.p,.004);diagnostics.readResidualLine(job,'Time = 2');diagnostics.readResidualLine(job,'Solving for Ux, Initial residual = 0.00002');assert.equal(job.residual,.00002);
});
test('steady drag alone cannot certify drifting lift',()=>{
 const history=Array.from({length:80},(_,i)=>({cd:.03,cy:.2+i*.001}));assert.equal(diagnostics.forceConvergence(history).stable,false);assert.equal(diagnostics.forceConvergence(history.map(r=>({...r,cy:0}))).stable,true);assert.equal(diagnostics.forceConvergence(history.slice(0,20)).stable,false);
});
