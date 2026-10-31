import test from 'node:test';import assert from 'node:assert/strict';
import {assessmentOptions,planeShape,assessPlane,assessmentHTML} from '../src/plane-assessment.mjs';
import {BoxGeometry,SphereGeometry} from 'three';
const shape={candidate:true,extent:[.6,.1,1],spanCenter:0};
const panels=[{center:[0,0,-.2],force:[.5,5,0]},{center:[0,0,.2],force:[.5,5,0]}];
const result={engine:'openfoam',reliability:{acceptable:true,blocking:[]},converged:true,forceConvergence:{stable:true},liftCenter:{force:[1,10,0],moment:[0,0,0],pressureForce:[.7,10,0],viscousForce:[.3,0,0],panels,faces:2000}};
const base={shape,result,settings:{length:1,speed:13,yaw:0,roll:0}};
test('shape screen rejects block and sphere and is invariant to model scale',()=>{
 for(const g of [new BoxGeometry(1,1,1),new SphereGeometry(.5,24,16),new BoxGeometry(1,.1,1)])assert.equal(planeShape(g.toNonIndexed().attributes.position.array).candidate,false);
 // Narrow main wing plus fuselage; projection shape matters, not triangle count.
 const wing=new BoxGeometry(.16,.025,1).toNonIndexed(),body=new BoxGeometry(.6,.1,.08).toNonIndexed(),v=[...wing.attributes.position.array,...body.attributes.position.array];
 assert.equal(planeShape(v).candidate,true);assert.equal(planeShape(v.map(x=>x*50)).candidate,true);assert.equal(planeShape([...v,...v]).candidate,true);
});
test('no aircraft verdict or score from preview, missing loads or non-plane',()=>{
 assert.equal(assessPlane({...base,result:{engine:'preview'}}).score,null);
 assert.equal(assessPlane({...base,result:null}).score,null);
 assert.equal(assessPlane({...base,result:{...result,reliability:undefined}}).score,null,'Legacy convergence alone cannot earn a reliability-backed score');
 assert.equal(assessPlane({...base,shape:{...shape,candidate:false}}).score,null);
 assert.equal(assessPlane({...base,options:{kind:'other'}}).score,null);
 assert.equal(assessPlane({...base,shape:{...shape,candidate:false},options:{kind:'plane'}}).active,true);
});
test('unknown mass and estimated CG are excluded, not assumed favorable',()=>{
 const a=assessPlane({...base,cg:[0,0,0]});assert.equal(a.coverage,60);assert.equal(a.score,100);
 assert.equal(a.checks.find(c=>c.id==='trim').value,null);assert.equal(a.checks.find(c=>c.id==='weight').value,null);
 assert.ok(a.stability.startsWith('Not assessed'));assert.match(assessmentHTML(a),/Stability is unassessed/);
});
test('score uses native force ratio independent of reference area; target genuinely changes score',()=>{
 const a=assessPlane({...base,options:{targetLD:20}});assert.equal(a.score,58);
 assert.equal(assessPlane({...base,settings:{...base.settings,referenceArea:100},options:{targetLD:20}}).score,a.score);
 assert.equal(assessPlane({...base,result:{...result,converged:false}}).confidence,'Low · convergence not established');
 assert.equal(assessPlane({...base,result:{...result,converged:false}}).score,null);
 assert.equal(assessPlane({...base,result:{...result,reliability:{acceptable:false,blocking:['Missing layers']}}}).score,null);
});
test('mass match penalizes both excess and deficient lift and respects bank/sideslip',()=>{
 const run=(mass,settings=base.settings)=>assessPlane({...base,settings,options:{mass}}).checks.find(c=>c.id==='weight').value;
 assert.equal(run(10/9.80665),1);assert.equal(run(5/9.80665),0);assert.equal(run(20/9.80665),.5);
 assert.equal(run(10/9.80665,{...base.settings,roll:5}),null);
});
test('pitch moment is shifted to measured CG with all force components and is not a stability verdict',()=>{
 const a=assessPlane({...base,measuredCG:true,cg:[.1,.2,0],options:{mass:10/9.80665}});
 assert.ok(Math.abs(a.metrics.pitchMoment+.8)<1e-10);assert.equal(a.coverage,100);
 assert.ok(Math.abs(a.checks.find(c=>c.id==='trim').value-.2)<1e-10);assert.match(a.stability,/Not assessed/);
});
test('zero/negative loads never earn efficiency points; cancellation does not fake lift balance',()=>{
 for(const force of [[1,-10,0],[0,10,0],[-1,10,0],[0,0,0]]){const a=assessPlane({...base,result:{...result,liftCenter:{...result.liftCenter,force}}});assert.equal(a.checks[0].value,0);assert.ok(a.score>=0&&a.score<=100);}
 const a=assessPlane({...base,result:{...result,liftCenter:{...result.liftCenter,panels:[panels[0],{...panels[1],force:[0,-4,0]}]}}});assert.equal(a.checks.find(c=>c.id==='balance').value,null);
});
test('options reject corrupt input, old projects have defaults and report escapes evidence',()=>{
 assert.deepEqual(assessmentOptions(),{kind:'auto',targetLD:10,mass:null});
 for(const o of [{mass:0},{mass:-1},{mass:NaN},{targetLD:Infinity},{targetLD:0},{kind:'jet'}])assert.throws(()=>assessmentOptions(o));
 const a=assessPlane(base);a.detection='<img src=x>';assert.ok(!assessmentHTML(a).includes('<img src=x>'));assert.ok(assessmentHTML(a).includes('&lt;img'));
});
