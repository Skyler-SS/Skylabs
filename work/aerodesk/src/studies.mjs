import {sameEnvironment,freeFlight} from '../environment.cjs';
import {assessPlane} from './plane-assessment.mjs';
import {sweepSample,stabilityFindings,modelRotation} from './plane-diagnostics.mjs';
import {Vector3} from 'three';
export function angleList(text){const values=String(text).split(/[ ,;]+/).filter(Boolean).map(Number);if(!values.length||values.length>15||values.some(v=>!Number.isFinite(v)||Math.abs(v)>30))throw Error('Enter 1–15 angles from −30° to +30°, separated by commas.');return [...new Set(values)].sort((a,b)=>a-b);}
export function studyPlan(pitch,yaw,grid=false){const a=angleList(pitch),b=angleList(yaw),rows=grid?a.flatMap(p=>b.map(y=>({pitch:p,yaw:y}))):[...a.map(p=>({pitch:p,yaw:0})),...b.map(y=>({pitch:0,yaw:y}))];const out=[...new Map(rows.map(r=>[r.pitch+','+r.yaw,r])).values()];if(out.length>49)throw Error('Limit the study set to 49 conditions.');return out;}
const keys=['length','speed','density','nu','referenceArea','roughness','turbulenceRatio','intensity','roll'];
export function sameCondition(a,b){return sameEnvironment(a,b)&&keys.every(k=>Math.abs((a[k]??0)-(b[k]??0))<=Math.max(1e-10,Math.abs(b[k]||0)*1e-8));}
export function comparisonRows(rows,settings){return rows.filter(r=>r.summary?.liftCenter?.force&&sameCondition(r.settings,settings));}
export function restorableStudy(rows,selected,settings){const matches=r=>r.resultId&&sameCondition(r.settings,settings)&&Math.abs((r.settings.pitch||0)-(settings.pitch||0))<1e-8&&Math.abs((r.settings.yaw||0)-(settings.yaw||0))<1e-8&&(r.settings.qualityMode||'standard')===(settings.qualityMode||'standard');return rows.find(r=>r.id===selected&&matches(r))||rows.find(matches);}
export function summarizeStudy(result,settings){
 const l=result.liftCenter,halves=[{center:[0,0,-settings.length],force:[0,0,0]},{center:[0,0,settings.length],force:[0,0,0]}];
 // Use body-frame span, not wind-frame Z, when grouping a yawed aircraft.
 const inverse=modelRotation(settings).invert();for(const p of l?.panels||[]){const z=new Vector3(...p.center).applyMatrix4(inverse).z;for(let k=0;k<3;k++)halves[z<0?0:1].force[k]+=p.force[k];}
 return {engine:result.engine,reliability:result.reliability,converged:!!result.converged,forceConvergence:result.forceConvergence,cells:result.cells,iteration:result.iteration,elapsed:result.elapsed,execution:result.execution,history:result.history.slice(-50),liftCenter:l?{force:l.force,moment:l.moment,pressureForce:l.pressureForce,viscousForce:l.viscousForce,faces:l.faces,absoluteLift:l.absoluteLift,cancellationRatio:l.cancellationRatio,panels:halves}:null};
}
export function validateStudies(input){if(!Array.isArray(input)||input.length>100)throw Error('Invalid project study set.');return input.map(r=>{if(typeof r.id!=='string'||r.id.length>80||!r.settings||!Number.isFinite(r.settings.pitch)||!Number.isFinite(r.settings.yaw)||Math.abs(r.settings.pitch)>180||Math.abs(r.settings.yaw)>180||!['queued','complete','failed','stopped'].includes(r.status)||r.resultId&&!/^[a-f0-9-]{36}$/.test(r.resultId))throw Error('Invalid saved study row.');if(r.summary?.liftCenter&&(!r.summary.liftCenter.force?.every(Number.isFinite)||!r.summary.liftCenter.moment?.every(Number.isFinite)))throw Error('Invalid saved forces.');return {...r,status:r.status,include:r.include!==false};});}
export function assessStudySet(rows,{shape,options,settings,cg,measuredCG}){
 const identity=assessPlane({shape,options,settings});if(!identity.active||!freeFlight(settings))return identity;
 const selected=rows.filter(r=>r.include!==false&&sameCondition(r.settings,settings)),done=selected.filter(r=>r.status==='complete'&&r.summary?.liftCenter?.panels?.length),usable=done.filter(r=>r.summary.converged&&r.summary.forceConvergence?.stable&&r.summary.reliability?.acceptable);
 const checks=[],tips=[],angles=done.map(r=>[r.settings.pitch,r.settings.yaw]);let score=null,coverage=0;
 const assessments=usable.map(r=>assessPlane({shape,options,result:r.summary,settings:r.settings,cg:cg?new Vector3(...cg).applyMatrix4(modelRotation(r.settings)).toArray():null,measuredCG}));
 const valid=assessments.filter(a=>a.score!==null),average=valid.length?valid.reduce((s,a)=>s+a.score,0)/valid.length:null;
 checks.push({id:'envelope',label:'Requested flight conditions',weight:60,value:average===null?null:average/100,detail:usable.length+'/'+selected.length+' selected conditions passed their recorded numerical checks. Mean condition score; compare identical angle lists and targets.'});
 const findings=[];
 if(measuredCG&&cg){
  for(const axis of ['pitch','yaw']){
   const fixedAxis=axis==='pitch'?'yaw':'pitch',groups=[...new Set(usable.map(r=>r.settings[fixedAxis]))];
   for(const fixedAngle of groups){
   const candidates=[...new Map(usable.filter(r=>r.settings[fixedAxis]===fixedAngle&&Math.abs(r.settings.roll||0)<1e-6).map(r=>[r.settings[axis],r])).values()].sort((a,b)=>a.settings[axis]-b.settings[axis]);
   // Adjacent slopes detect changes in response over the tested envelope.
   for(let i=1;i<candidates.length;i++){
    const pair=[candidates[i-1],candidates[i]].map(r=>({...sweepSample(r.summary,r.settings,cg),axis}));
    if(pair[0][axis]===pair[1][axis])continue;
    findings.push(...stabilityFindings(pair,settings).filter(f=>f.status!=='Not measured').map(f=>({...f,fixedAxis,fixedAngle})));
   }
   }
  }
 }
 for(const [label,weight] of [['Pitch restoring response',16],['Dihedral / roll response to sideslip',12],['Directional restoring response',12]]){
  const rows=findings.filter(f=>f.label===label),resolved=rows.filter(f=>['Restoring tendency','Destabilizing tendency'].includes(f.status)),value=resolved.length?resolved.filter(f=>f.status==='Restoring tendency').length/resolved.length:null;
  checks.push({id:label,label,weight,value,detail:!measuredCG?'Needs a measured flying CG.':!rows.length?'Needs converged angle pairs at otherwise matched conditions.':resolved.length+'/'+rows.length+' intervals resolved; '+resolved.filter(f=>f.status==='Destabilizing tendency').length+' destabilizing.'});
  if(resolved.some(f=>f.status==='Destabilizing tendency'))tips.push({id:label,title:label+' needs investigation',evidence:rows.map(f=>f.angleRange?.join(' to ')+'°: '+f.status).join('; '),action:resolved.find(f=>f.status==='Destabilizing tendency').advice});
 }
 const known=checks.filter(c=>c.value!==null);const knownWeight=known.reduce((s,c)=>s+c.weight,0);if(knownWeight)score=Math.round(100*known.reduce((s,c)=>s+c.weight*c.value,0)/knownWeight);
 coverage=Math.round((valid.length?60*valid.reduce((s,a)=>s+a.coverage/100,0)/valid.length:0)+known.filter(c=>c.id!=='envelope').reduce((s,c)=>s+c.weight,0));
 tips.unshift({id:'set-quality',title:'Complete and converge the angle set',evidence:done.length+' completed, '+usable.length+' usable, '+(selected.length-done.length)+' pending/failed. '+(rows.length-selected.length)+' excluded or different flow settings.',action:'Run missing cases, inspect convergence problems in unconverged cases, and compare a finer mesh at the same angles. Missing, unconverged or unverified conditions are shown but excluded from physical scoring.'});
 if(!measuredCG)tips.push({id:'set-cg',title:'Enter the measured flying CG',evidence:'Static response and trim require a common measured CG.',action:'Measure the assembled plane including its battery and enter coordinates in Material & center of gravity. A material-based CAD estimate is not a measured flying CG.'});
 const ranked=assessments.map((a,i)=>({a,r:usable[i]})).filter(x=>x.a.score!==null).sort((x,y)=>x.a.score-y.a.score);
 for(const id of ['efficiency','weight','trim','balance']){const entry=ranked.find(x=>x.a.tips.some(t=>t.id===id));if(entry){const t=entry.a.tips.find(t=>t.id===id);tips.push({...t,id:'set-'+id,title:t.title+' · '+entry.r.settings.pitch+'° AoA / '+entry.r.settings.yaw+'° yaw'});}}
 return {active:true,score,coverage,confidence:usable.length===selected.length&&selected.length>0?'Study set · mesh sensitivity unverified':'Incomplete study set · provisional',detection:'Multi-angle plane assessment',checks,tips,metrics:{conditions:angles,completed:done.length,usable:usable.length,requested:selected.length},stability:findings.length?'Static response evaluated across adjacent converged angles. Dynamic stability, stall and control authority remain untested.':'Static stability not assessed: more converged pairs and a measured CG are needed.',findings,method:'Study-set heuristic: mean requested-condition score 60%; pitch response 16%; sideslip roll response 12%; directional response 12%. Only converged, force-stable matched cases count. Unresolved criteria are excluded; coverage is shown. Equal weighting of requested conditions is a scoring convention, not a mission model.'};
}
