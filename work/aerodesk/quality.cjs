const {environment}=require('./environment.cjs');
const modes={
 draft:{label:'Draft',description:'Screen ideas; coarse loads',level:4,volumeLevel:2,maxCells:450000,layers:4,wallYPlus:30,iterations:2500,minIterations:200,window:100,residual:1e-5,relative:.02,absolute:.0002},
 standard:{label:'Standard',description:'Balanced detail and convergence',level:5,volumeLevel:3,maxCells:1500000,layers:10,wallYPlus:1,iterations:6000,minIterations:400,window:150,residual:1e-6,relative:.01,absolute:.0001},
 detailed:{label:'Detailed',description:'Fine surfaces and wall layers',level:6,volumeLevel:3,maxCells:2500000,layers:14,wallYPlus:.7,iterations:9000,minIterations:600,window:200,residual:5e-7,relative:.005,absolute:.00005},
 reference:{label:'Reference',description:'Less diffusive velocity numerics and three meshes; allow several hours or overnight',numerics:'accuracy',level:6,volumeLevel:3,maxCells:3500000,layers:16,wallYPlus:.5,iterations:12000,minIterations:800,window:250,residual:3e-7,relative:.003,absolute:.00003}
};
function qualityMode(s){const id=s?.qualityMode??'standard';if(!Object.hasOwn(modes,id))throw Error('Choose Draft, Standard, Detailed or Reference quality.');return id;}
function meshLimitReached(log){return /maximum number of cells|reached[^\n]*(?:maximum|maxGlobalCells)|stopping[^\n]*max[^\n]*cell|exceed[^\n]*maxGlobalCells/i.test(log);}
function checkMeshMemory(cells,hw,gpu=false){
 const memoryGB=1.5+cells*3000/1e9,vramGB=1+cells*1800/1e9;
 if(!Number.isSafeInteger(cells)||cells<1)throw Error('The generated mesh has no valid cell count.');
 if(memoryGB>hw.freeGB*.85)throw Error('The generated mesh has '+cells.toLocaleString()+' cells and needs about '+memoryGB.toFixed(1)+' GB free. Close other apps or use a lower quality. The native mesh has been retained.');
 if(gpu&&Number.isFinite(hw.vramGB)&&vramGB>hw.vramGB*.85)throw Error('The generated mesh needs about '+vramGB.toFixed(1)+' GB free GPU memory. Use CPU solving or a lower quality. The native mesh has been retained.');
 return {memoryGB,vramGB};
}
function qualityStages(s){const id=qualityMode(s),p=modes[id];return (id==='reference'?[{level:4,volumeLevel:2,maxCells:700000,wallScale:2},{level:5,volumeLevel:3,maxCells:1500000,wallScale:Math.SQRT2},{level:6,volumeLevel:3,maxCells:3500000,wallScale:1}]:[{}]).map((stage,i)=>({...p,...stage,qualityMode:id,index:i,wallScale:stage.wallScale||1,criteria:{window:p.window,minIterations:p.minIterations,residual:p.residual,relative:p.relative,absolute:p.absolute}}));}
function wallPlan(s,p){
 const resolved=p.qualityMode!=='draft'&&!(s.roughness>0),re=Math.max(100,s.speed*s.length/s.nu),cf=.026/Math.pow(re,1/7),frictionVelocity=s.speed*Math.sqrt(cf/2),targetYPlus=(resolved?p.wallYPlus:30)*p.wallScale;
 const estimated=2*targetYPlus*s.nu/frictionVelocity,maximum=.3*s.length*.25/2**(p.level+1),firstThickness=Math.max(s.length*1e-8,Math.min(maximum,estimated));
 return {resolved,targetYPlus,firstThickness,spacingCapped:estimated>maximum,growth:1.22,layers:p.layers,method:'Flat-plate skin-friction estimate, capped by surface cell size; actual y+ is checked after solving.'};
}
// Which wall treatment the MESH can actually support, as opposed to the one the
// quality level asked for.
//
// A low-Re treatment (k = 0 at the wall, nutLowReWallFunction) is only valid when the
// boundary layer is genuinely resolved to y+ ~ 1. snappyHexMesh frequently cannot grow
// the requested layers on a complex or shrink-wrapped surface: one real run here asked
// for 10 layers and got 0.9, at 21.9% of the wanted thickness. Applying low-Re
// boundary conditions to that mesh drove omega negative on the first iteration and let
// k grow unbounded until the momentum equation diverged.
//
// The thresholds match the ones preflightWarning already reports on, so the decision
// and the warning can never disagree.
function wallTreatment(preflight,wall,qualityMode){
 if(qualityMode==='draft'||!wall.resolved)
  return {mode:'wall-functions',adapted:false,reason:null};
 const coverage=preflight?.coverage,mean=preflight?.mean;
 if(!Number.isFinite(coverage)||!Number.isFinite(mean))
  return {mode:'wall-functions',adapted:true,
   reason:'Wall-layer coverage could not be measured, so the resolved (y+ 1) wall '
    +'treatment cannot be trusted. Wall functions were used instead.'};
 if(coverage<.9||mean<wall.layers*.7)
  return {mode:'wall-functions',adapted:true,
   reason:'The mesher built '+mean.toFixed(1)+' of '+wall.layers+' requested wall layers '
    +'over '+(coverage*100).toFixed(0)+'% of the surface, which cannot support a '
    +'resolved y+ 1 boundary layer. Wall functions were used instead; near-wall detail '
    +'is approximated rather than resolved.'};
 return {mode:'resolved',adapted:false,reason:null};
}

function residualConvergence(samples,tolerance,count=10){const rows=samples.slice(-count),equations=['p','Ux','Uy','Uz','k','omega'];return {passed:rows.length===count&&rows.every(r=>equations.every(k=>Number.isFinite(r[k])&&r[k]<=tolerance)),count:rows.length,target:tolerance};}
function loadConvergence(history,s,criteria){
 const rows=history.slice(-criteria.window),q=.5*s.density*s.speed*s.speed,forceScale=q*s.referenceArea,momentScale=forceScale*s.length,stats={};
 for(const key of ['cd','cy','cz','mx','my','mz']){const scale=key.startsWith('m')?momentScale:1,values=rows.map(r=>r[key]/scale),finite=values.length===criteria.window&&values.every(Number.isFinite),mean=finite?values.reduce((a,b)=>a+b,0)/values.length:null,range=finite?Math.max(...values)-Math.min(...values):null,tolerance=finite?Math.max(criteria.absolute,Math.abs(mean)*criteria.relative):null;stats[key]={mean,range,tolerance,stable:finite&&range<=tolerance};}
 return {stable:history.length>=criteria.minIterations&&Object.values(stats).every(x=>x.stable),count:rows.length,window:criteria.window,...stats};
}
function compareMeshes(results,s){
 if(results.length<2)return {passed:false,reason:'A finer-mesh result is required.',pairs:[]};
 const qA=.5*s.density*s.speed**2*s.referenceArea,pairs=[];
 for(let i=1;i<results.length;i++){const a=results[i-1],b=results[i],fa=a.liftCenter?.force,fb=b.liftCenter?.force,ma=a.liftCenter?.moment,mb=b.liftCenter?.moment;
  if(!fa||!fb||!ma||!mb){pairs.push({passed:false,reason:'Missing native surface loads.'});continue;}
  const force=fa.map((v,k)=>{const change=Math.abs(fb[k]-v),tolerance=Math.max(qA*.0002,Math.max(Math.abs(v),Math.abs(fb[k]))*.02);return {change,tolerance,passed:change<=tolerance};}),moment=ma.map((v,k)=>{const change=Math.abs(mb[k]-v),tolerance=Math.max(qA*s.length*.0002,Math.max(Math.abs(v),Math.abs(mb[k]))*.03);return {change,tolerance,passed:change<=tolerance};}),growth=b.cells/Math.max(a.cells,1),settled=!!(a.converged&&b.converged&&a.forceConvergence?.stable&&b.forceConvergence?.stable);
  const ca=a.liftCenter.center,cb=b.liftCenter.center,centerUsable=[a,b].every(r=>Math.abs(r.liftCenter.force[1])>qA*.0002&&Math.abs(r.liftCenter.force[1])/Math.max(r.liftCenter.absoluteLift||Infinity,1e-30)>.01)&&ca?.every(Number.isFinite)&&cb?.every(Number.isFinite);
  const liftCenter=centerUsable?{frontBack:Math.abs(cb[0]-ca[0]),span:Math.abs(cb[2]-ca[2]),tolerance:s.length*.005,passed:Math.hypot(cb[0]-ca[0],cb[2]-ca[2])<=s.length*.005}:null;
  const wallChecksPassed=[a,b].every(r=>r.layerCoverage?.coverage>=.9&&r.layerCoverage?.mean>=.7*r.layerCoverage?.requested&&r.reliability?.wall?.sampledAreaFraction>=.99&&r.reliability?.wall?.areaFractionInTarget>=.9),nativeLoadsVerified=[a,b].every(r=>r.loadAgreement?.passed&&r.flowCheck?.passed&&!r.meshLimitReached&&(environment(s).groundMode==='none'||r.groundCheck?.passed));
  pairs.push({from:a.cells,to:b.cells,growth,settled,force,moment,liftCenter,wallChecksPassed,nativeLoadsVerified,reason:!wallChecksPassed?'A mesh failed or is missing its wall-layer/y+ checks.':!nativeLoadsVerified?'A mesh has unverified loads or truncated refinement.':undefined,passed:settled&&wallChecksPassed&&nativeLoadsVerified&&growth>=1.25&&force.every(x=>x.passed)&&moment.every(x=>x.passed)&&(!liftCenter||liftCenter.passed)});
 }
 return {passed:results.length>=3&&pairs.every(p=>p.passed),pairs,reason:results.length<3?'Three completed meshes are required.':pairs.every(p=>p.passed)?'Loads agree across three converged meshes with verified wall resolution.':pairs.find(p=>p.reason)?.reason||'Mesh changes or convergence exceed the acceptance limits.',method:'Three-mesh sensitivity check, not a formal GCI or experimental validation.'};
}
function loadAgreement(loads,last,s){
 if(!loads?.force||!loads?.moment||!last)return {passed:false,reason:'Native forces or moments missing.'};
 const qA=.5*s.density*s.speed*s.speed*s.referenceArea,force=[last.drag,last.cy*qA,last.cz*qA],moment=[last.mx,last.my,last.mz],checks=[];
 for(const [name,actual,expected,scale] of [['force',loads.force,force,qA],['moment',loads.moment,moment,qA*s.length]])for(let k=0;k<3;k++){const error=Math.abs(actual[k]-expected[k]),tolerance=Math.max(scale*1e-6,Math.abs(expected[k])*.005);checks.push({quantity:name,axis:k,error,tolerance,passed:Number.isFinite(error)&&error<=tolerance});}
 return {passed:checks.every(c=>c.passed),checks};
}
function parseLayerCoverage(text,panels,requested){
 const boundary=text.slice(text.indexOf('boundaryField')),body=/\bmodel\s*\{([^}]*)\}/.exec(boundary)?.[1];if(!body)return null;
 const uniform=/\bvalue\s+uniform\s+([\deE+.-]+)/.exec(body),nonuniform=/\bvalue\s+nonuniform\s+List<scalar>\s+(\d+)\s*\(([^)]*)\)/s.exec(body);
 const values=uniform?panels.map(()=>+uniform[1]):nonuniform?nonuniform[2].trim().split(/\s+/).map(Number):null;
 if(!values||values.length!==panels.length||values.some(v=>!Number.isFinite(v)||v<0||v>requested))return null;
 const area=panels.reduce((a,p)=>a+p.area,0);if(!area)return null;
 return {requested,mean:values.reduce((a,n,i)=>a+n*panels[i].area,0)/area,coverage:values.reduce((a,n,i)=>a+(n>0?panels[i].area:0),0)/area,fullCoverage:values.reduce((a,n,i)=>a+(n===requested?panels[i].area:0),0)/area};
}
function qualityEvidence(result,s,wall,layers,meshComparison=null){
// The y+ band depends on the wall model that was ACTUALLY applied. When the layer mesh
// is too thin, the solve adapts to wall functions on purpose - judging that run against
// the low-Re y+ <= 2 target reports a failure for a criterion that does not apply to it.
// A validated TriBot run sat at mean y+ 39.5, max 297 (correct for wall functions) and
// was still flagged "Less than 90% of the surface meets y+ <= 2".
 const p=modes[qualityMode(s)],panels=result.liftCenter?.panels||[],area=panels.reduce((a,x)=>a+x.area,0),sampled=panels.filter(x=>Number.isFinite(x.yPlus)),sampleArea=sampled.reduce((a,x)=>a+x.area,0),resolvedWall=(result.wallTreatment?.mode||(wall.resolved?'resolved':'wall-functions'))==='resolved',covered=sampled.reduce((a,x)=>a+(resolvedWall?x.yPlus<=2:x.yPlus>=30&&x.yPlus<=300?true:false)*x.area,0),wallFraction=area?covered/area:0,blocking=[],warnings=[];
 if(!result.converged)blocking.push('Residual and load convergence targets were not both met.');
 if(!result.loadAgreement?.passed)blocking.push('Surface force/moment integration is unverified or inconsistent.');
 if(!result.flowCheck?.passed)blocking.push('Native flow conservation is unverified or outside tolerance.');
 if(result.meshLimitReached)blocking.push('Meshing reached its cell limit before completing requested refinement.');
 if(qualityMode(s)==='draft')warnings.push('Draft is for screening; near-wall accuracy is not established.');
 else {if(sampleArea<area*.99||wallFraction<.9)blocking.push(resolvedWall?'Less than 90% of the surface meets y+ ≤ 2.':'Less than 90% of the surface lies in the wall-function y+ range (30–300).');if(!layers||layers.coverage<.9||layers.mean<p.layers*.7)blocking.push('Boundary-layer coverage or layer count is below target.');}
 if(environment(s).groundMode!=='none'){if(qualityMode(s)!=='draft'&&!result.groundCheck?.passed)blocking.push('Ground wall resolution or layer coverage is below target or unverified.');warnings.push('Ground clearance is held to the lowest rotated model point; angle sweeps are not fixed-height CG sweeps.');}
 if(environment(s).fluidMedium==='water')warnings.push('Fully submerged single-phase water: no free surface, hydrostatic buoyancy or cavitation. Reported forces are flow-induced.');
 if(qualityMode(s)==='reference'&&!meshComparison?.passed)blocking.push(meshComparison?.reason||'Three-mesh sensitivity check has not passed.');
 if(qualityMode(s)!=='reference')warnings.push('No automatic mesh-sensitivity comparison at this quality level.');
 warnings.push('Fully turbulent steady SST; transition and unsteady stall are not modeled.','Numerical checks do not establish accuracy against experiments.');
 return {status:blocking.length?'needs-review':qualityMode(s)==='draft'?'screening':'numerical-checks-passed',acceptable:!blocking.length&&qualityMode(s)!=='draft',blocking,warnings,wall:{...wall,areaFractionInTarget:wallFraction,sampledAreaFraction:area?sampleArea/area:0},layers,ground:result.groundCheck,meshComparison};
}
module.exports={wallTreatment,modes,qualityMode,qualityStages,wallPlan,residualConvergence,loadConvergence,compareMeshes,qualityEvidence,loadAgreement,parseLayerCoverage,meshLimitReached,checkMeshMemory};
