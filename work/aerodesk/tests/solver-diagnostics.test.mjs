import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {readResidualLine,divergenceVerdict,DIVERGENCE}=require('../solver-diagnostics.cjs');
const {wallTreatment}=require('../quality.cjs');

const feed=(job,lines)=>{for(const line of lines)readResidualLine(job,line);return job;};
const fresh=()=>({residuals:{},residual:1,iteration:0});
const iteration=(n,residual)=>['Time = '+n,
 ...['Ux','Uy','Uz'].map(u=>`smoothSolver:  Solving for ${u}, Initial residual = ${residual}, Final residual = 1e-7, No Iterations 2`),
 `GAMG:  Solving for p, Initial residual = ${residual}, Final residual = 1e-7, No Iterations 1`,
 ...['omega','k'].map(t=>`smoothSolver:  Solving for ${t}, Initial residual = ${residual}, Final residual = 1e-7, No Iterations 1`)];

test('the FPE banner printed by every healthy run is not read as a fatal error',()=>{
 // OpenFOAM prints this line on startup when FPE trapping is ENABLED. Matching a bare
 // /Floating point exception/ flagged every run as diverged at iteration 0.
 const job=feed(fresh(),['trapFpe: Floating point exception trapping enabled (FOAM_SIGFPE).']);
 assert.equal(divergenceVerdict(job).diverged,false);
 assert.equal(job.fatalLine,undefined);
 // A real handler firing is still caught.
 assert.equal(divergenceVerdict(feed(fresh(),['#1  Foam::sigFpe::sigHandler(int) at ??:?'])).diverged,true);
});

test('a healthy falling-residual run is never called diverged',()=>{
 const job=fresh();
 let residual=1;
 for(let n=1;n<=60;n++){residual*=.8;feed(job,iteration(n,residual.toExponential(6)));}
 assert.equal(divergenceVerdict(job).diverged,false);
});

test('bounding that settles at a new level is not divergence',()=>{
 // k rising once and then holding is normal early transient behaviour.
 const job=fresh();
 for(let n=1;n<=20;n++)feed(job,['Time = '+n,'bounding k, min: 0 max: '+(n<3?0.06*n:0.2)+' average: 0.05']);
 assert.equal(divergenceVerdict(job).diverged,false);
});

test('runaway turbulence is caught even when its growth is not monotonic',()=>{
 // The real failure did not double every step: it paused at 205 -> 298 (1.45x). A
 // consecutive-streak counter reset there and missed the blow-up entirely, so growth
 // is judged cumulatively across a window instead.
 const maxima=[0.06,0.3,1.43,5.92,17.1,63.9,205,298,503,1093];
 const job=fresh();
 maxima.forEach((max,i)=>feed(job,['Time = '+(i+1),`bounding k, min: 0 max: ${max} average: 0.1`]));
 const verdict=divergenceVerdict(job);
 assert.equal(verdict.diverged,true);
 assert.match(verdict.reason,/Turbulence is diverging: k/);
 assert.match(verdict.reason,/wall treatment/,'the reason points at the actual cause');
});

test('a catastrophic continuity error ends the run',()=>{
 const job=feed(fresh(),['Time = 30',
  'time step continuity errors : sum local = 4.28014677996e+36, global = 1.9e+30, cumulative = 1.9e+30']);
 const verdict=divergenceVerdict(job);
 assert.equal(verdict.diverged,true);
 assert.match(verdict.reason,/Mass conservation/);
 // A normal small error is left alone.
 assert.equal(divergenceVerdict(feed(fresh(),['Time = 3',
  'time step continuity errors : sum local = 0.000276, global = -1.1e-05, cumulative = -1.1e-05'])).diverged,false);
});

test('residuals that climb over a window are caught',()=>{
 const job=fresh();
 let residual=0.001;
 for(let n=1;n<=DIVERGENCE.residualWindow+2;n++){residual*=2.2;feed(job,iteration(n,residual.toExponential(6)));}
 const verdict=divergenceVerdict(job);
 assert.equal(verdict.diverged,true);
 assert.match(verdict.reason,/growing rather than falling/);
});

test('wall treatment follows the mesh that was built, not the one requested',()=>{
 const wall={resolved:true,layers:10};
 // The real case: 0.919 of 10 layers over a fraction of the surface.
 const bad=wallTreatment({coverage:0.09,mean:0.919},wall,'standard');
 assert.equal(bad.mode,'wall-functions');
 assert.equal(bad.adapted,true);
 assert.match(bad.reason,/0\.9 of 10 requested wall layers/);

 // A properly built layer mesh keeps the resolved treatment it asked for.
 const good=wallTreatment({coverage:0.97,mean:9.4},wall,'standard');
 assert.equal(good.mode,'resolved');
 assert.equal(good.adapted,false);
 assert.equal(good.reason,null);

 // Draft never claims to resolve the wall, so nothing is "adapted".
 assert.deepEqual(wallTreatment({coverage:0.2,mean:1},{resolved:false,layers:4},'draft'),
  {mode:'wall-functions',adapted:false,reason:null});

 // An unmeasurable preflight must not be treated as success.
 assert.equal(wallTreatment(null,wall,'standard').mode,'wall-functions');
 assert.equal(wallTreatment({coverage:NaN,mean:NaN},wall,'standard').adapted,true);

 // Right at the threshold the resolved treatment is still allowed.
 assert.equal(wallTreatment({coverage:0.9,mean:7},wall,'standard').mode,'resolved');
 assert.equal(wallTreatment({coverage:0.89,mean:9},wall,'standard').mode,'wall-functions');
});

test('the y+ criterion follows the wall model that was applied, not the one requested',()=>{
 const {qualityEvidence}=require('../quality.cjs');
 // Measured on the validated TriBot run: mean y+ 39.5, max 297 - correct for wall
 // functions, and nowhere near the low-Re target of 2. Judging an adapted run against
 // y+ <= 2 reported a failure for a criterion that did not apply to it.
 const panels=Array.from({length:100},()=>({area:1,yPlus:39.5}));
 const base={converged:true,loadAgreement:{passed:true},flowCheck:{passed:true},
  liftCenter:{panels}};
 const settings={qualityMode:'standard'};
 const layers={coverage:.95,mean:9.5};

 const adapted=qualityEvidence({...base,wallTreatment:{mode:'wall-functions',adapted:true}},
  settings,{resolved:true,layers:10},layers);
 assert.ok(!adapted.blocking.some(b=>/y\+/.test(b)),
  'an adapted wall-function run at y+ 39.5 must not be faulted on y+: '+adapted.blocking);

 // A run that really did resolve the wall is still held to y+ <= 2.
 const resolved=qualityEvidence({...base,wallTreatment:{mode:'resolved',adapted:false}},
  settings,{resolved:true,layers:10},layers);
 assert.ok(resolved.blocking.some(b=>/y\+ ≤ 2/.test(b)),
  'a resolved run at y+ 39.5 is genuinely under-resolved');

 // Wall functions are only valid in 30-300; outside it the run is still faulted.
 const tooFine=qualityEvidence({...base,liftCenter:{panels:panels.map(p=>({...p,yPlus:3}))},
  wallTreatment:{mode:'wall-functions',adapted:true}},settings,{resolved:true,layers:10},layers);
 assert.ok(tooFine.blocking.some(b=>/30–300/.test(b)));

 // With no wallTreatment recorded (older results) the requested mode still decides.
 const legacy=qualityEvidence(base,settings,{resolved:false,layers:10},layers);
 assert.ok(!legacy.blocking.some(b=>/y\+/.test(b)));
});
