import test from 'node:test';import assert from 'node:assert/strict';import q from '../quality.cjs';
const s={length:1,speed:20,density:1,nu:1.5e-5,referenceArea:.5},criteria=q.qualityStages({qualityMode:'standard'})[0].criteria;
const verifiedMesh={layerCoverage:{coverage:1,mean:16,requested:16},reliability:{wall:{sampledAreaFraction:1,areaFractionInTarget:1}},loadAgreement:{passed:true},flowCheck:{passed:true},meshLimitReached:false};
const steady=()=>Array.from({length:500},(_,iteration)=>({iteration,cd:.1,cy:.5,cz:0,mx:0,my:0,mz:.1,drag:10}));
test('four explicit quality levels do not depend on a time budget',()=>{
 assert.deepEqual(Object.keys(q.modes),['draft','standard','detailed','reference']);assert.equal(q.qualityMode({minutes:2}),'standard');assert.equal(q.qualityMode({minutes:240}),'standard');assert.throws(()=>q.qualityMode({qualityMode:'magic'}));
 const levels=Object.keys(q.modes).map(id=>q.qualityStages({qualityMode:id}).at(-1));assert.ok(levels.every((x,i)=>!i||x.level>=levels[i-1].level&&x.layers>levels[i-1].layers));
 const reference=q.qualityStages({qualityMode:'reference'});assert.equal(reference.length,3);assert.deepEqual(reference.map(x=>x.level),[4,5,6]);assert.ok(reference[0].wallScale>reference[2].wallScale);
});
test('convergence requires all force and moment components and sufficient history',()=>{
 assert.equal(q.loadConvergence(steady(),s,criteria).stable,true);assert.equal(q.loadConvergence(steady().slice(-20),s,criteria).stable,false);
 for(const key of ['cy','cz','mx','my','mz']){const rows=steady();for(let i=350;i<500;i++)rows[i][key]+=(i-350)*.001;assert.equal(q.loadConvergence(rows,s,criteria).stable,false,key);}
 const rows=steady();rows[499].mx=NaN;assert.equal(q.loadConvergence(rows,s,criteria).stable,false);
 const residuals=Array.from({length:10},()=>({p:1e-8,Ux:1e-8,Uy:1e-8,Uz:1e-8,k:1e-8,omega:1e-8}));assert.equal(q.residualConvergence(residuals,1e-6).passed,true);residuals[0].Uz=1e-4;assert.equal(q.residualConvergence(residuals,1e-6).passed,false);
});
test('wall spacing scales with viscosity and preserves rough-wall treatment',()=>{
 const p=q.qualityStages({qualityMode:'detailed'})[0],a=q.wallPlan(s,p),b=q.wallPlan({...s,speed:40},p);assert.ok(a.firstThickness>b.firstThickness);assert.equal(a.resolved,true);assert.equal(q.wallPlan({...s,roughness:.001},p).resolved,false);
});
test('mesh comparison cannot pass with two meshes, unconverged loads or unchanged cells',()=>{
 const result=(cells,d=10)=>({...verifiedMesh,cells,converged:true,forceConvergence:{stable:true},liftCenter:{force:[d,30,0],moment:[0,0,1]}});
 const a=result(100000),b=result(200000,10.1),c=result(400000,10.15);assert.equal(q.compareMeshes([a,b],s).passed,false);assert.equal(q.compareMeshes([a,b,c],s).passed,true);
 assert.equal(q.compareMeshes([a,b,{...c,converged:false}],s).passed,false);assert.equal(q.compareMeshes([a,b,{...c,cells:200000}],s).passed,false);assert.equal(q.compareMeshes([a,b,result(400000,13)],s).passed,false);
 assert.equal(q.compareMeshes([{...a,layerCoverage:{coverage:.3,mean:3,requested:16}},b,c],s).passed,false,'Matching forces cannot hide poor wall layers on a coarser mesh');
 assert.equal(q.compareMeshes([a,{...b,loadAgreement:{passed:false}},c],s).passed,false);
 assert.equal(q.compareMeshes([a,{...b,flowCheck:{passed:false}},c],s).passed,false);
});
test('layer checks are area weighted and missing layers cannot be certified',()=>{
 const panels=[{area:1,yPlus:1},{area:3,yPlus:8}],text='boundaryField { model { type fixedValue; value nonuniform List<scalar> 2 (10 0); }}',layers=q.parseLayerCoverage(text,panels,10);
 assert.equal(layers.coverage,.25);assert.equal(layers.mean,2.5);assert.equal(q.parseLayerCoverage(text,panels.slice(0,1),10),null);
 const p=q.qualityStages({qualityMode:'standard'})[0],r=q.qualityEvidence({converged:true,loadAgreement:{passed:true},liftCenter:{panels}}, {...s,qualityMode:'standard'},q.wallPlan(s,p),layers);assert.equal(r.acceptable,false);assert.equal(r.wall.areaFractionInTarget,.25);assert.ok(r.blocking.length>=2);
});
test('independent native force and moment mismatch blocks acceptance',()=>{
 const last=steady().at(-1),l={force:[10,50,0],moment:[0,0,.1]};assert.equal(q.loadAgreement(l,last,s).passed,true);l.moment[0]=1;assert.equal(q.loadAgreement(l,last,s).passed,false);
});

test('numerical acceptance also requires measured flow conservation',()=>{
 const p=q.qualityStages({qualityMode:'standard'})[0],wall=q.wallPlan(s,p),result={...verifiedMesh,converged:true,liftCenter:{panels:[{area:1,yPlus:1}]}},layers={requested:10,mean:10,coverage:1};
 assert.equal(q.qualityEvidence(result,{...s,qualityMode:'standard'},wall,layers).acceptable,true);
 assert.equal(q.qualityEvidence({...result,flowCheck:undefined},{...s,qualityMode:'standard'},wall,layers).acceptable,false);
 assert.equal(q.qualityEvidence({...result,flowCheck:{passed:false}},{...s,qualityMode:'standard'},wall,layers).acceptable,false);
});
test('cell-limit truncation and actual post-layer memory demand are detected',()=>{
 assert.equal(q.meshLimitReached('No cells marked for refinement'),false);
 assert.equal(q.meshLimitReached('Reached maximum number of cells 3500000.'),true);
 assert.equal(q.meshLimitReached('Stopping refinement since maxGlobalCells exceeded'),true);
 assert.ok(q.checkMeshMemory(1000000,{freeGB:20,vramGB:10},true));
 assert.throws(()=>q.checkMeshMemory(6000000,{freeGB:16}),/native mesh has been retained/);
 assert.throws(()=>q.checkMeshMemory(3000000,{freeGB:24,vramGB:4},true),/GPU memory/);
});
test('mesh sensitivity reports lift location changes and rejects drifting markers',()=>{
 const make=(cells,center)=>({...verifiedMesh,cells,converged:true,forceConvergence:{stable:true},liftCenter:{force:[10,30,0],moment:[0,0,1],absoluteLift:60,center}});
 const a=make(100000,[0,0,0]),b=make(200000,[.002,0,.001]),c=make(400000,[.003,0,.001]);
 const comparison=q.compareMeshes([a,b,c],s);assert.equal(comparison.passed,true);assert.equal(comparison.pairs[0].liftCenter.frontBack,.002);
 assert.equal(q.compareMeshes([a,b,make(400000,[.003,0,.02])],s).passed,false);
});
