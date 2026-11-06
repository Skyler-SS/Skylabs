// Retain the first initial residual per equation, not the final pressure correction.
function readResidualLine(job,line){
 const time=/^Time = (\d+)/.exec(line);
 if(time){if(job.residuals&&['p','Ux','Uy','Uz','k','omega'].every(k=>Number.isFinite(job.residuals[k]))){job.residualHistory??=[];job.residualHistory.push({...job.residuals,iteration:job.iteration});if(job.residualHistory.length>100)job.residualHistory.shift();}job.iteration=+time[1];}
 readDiagnosticLine(job,line);
 const r=/Solving for (p|Ux|Uy|Uz|k|omega), Initial residual = ([\deE+.-]+)/.exec(line);
 if(r&&job.residualIteration!==job.iteration){job.residualIteration=job.iteration;job.residuals={};}
 if(r&&job.residuals[r[1]]===undefined){job.residuals[r[1]]=+r[2];job.residual=Math.max(...Object.values(job.residuals));}
}
function forceConvergence(history){
 const rows=history.slice(-50);if(rows.length<50)return {stable:false,count:rows.length,reason:'Fewer than 50 force samples.'};
 const stats={};for(const key of ['cd','cy']){const a=rows.map(r=>r[key]),mean=a.reduce((s,v)=>s+v,0)/a.length,range=Math.max(...a)-Math.min(...a),tolerance=Math.max(.0001,Math.abs(mean)*.01);stats[key]={mean,range,tolerance,stable:range<=tolerance};}
 return {stable:stats.cd.stable&&stats.cy.stable,count:rows.length,...stats};
}
// ---------------------------------------------------------------------------
// Divergence detection.
//
// A run that blows up used to stream past unexamined: only "Time =" and the initial
// residuals were parsed, so `bounding k`, `bounding omega` and the continuity errors -
// the lines that actually say the solution is dying - were discarded. A diverging case
// therefore ran to its full iteration limit (hours) and reported Cd = -1e43.
//
// These thresholds are taken from a real failed run of this app, where k's maximum grew
// 0.06 -> 0.3 -> 1.4 -> 5.9 -> 17 -> 64 -> 205 -> 503 -> 1093 -> ... -> 21608, roughly
// tripling every iteration while being clipped at zero from below.
const DIVERGENCE={
 growthWindow:10,       // bounding events over which turbulence growth is judged ...
 growthFactor:50,       // ... and the total rise that condemns the run
 continuityLimit:1e6,   // |sum local| continuity error that no valid run reaches
 residualWindow:20,     // iterations over which a residual rise is judged
 residualRise:10,       // max residual rising this many times over the window ...
 residualFloor:1,       // ... and exceeding this absolute value
};

function readDiagnosticLine(job,line){
 const bound=/^bounding (k|omega), min: (\S+) max: (\S+)/.exec(line);
 if(bound){
  const field=bound[1],min=Number(bound[2]),max=Number(bound[3]);
  job.bounding??={};
  const previous=job.bounding[field];
  // Growth is tracked cumulatively over a window, not as a per-iteration streak:
  // a real blow-up does not rise monotonically. The run that prompted this went
  // 0.06 -> 21608 but paused at 205 -> 298 (1.45x), which reset a streak counter
  // and let the divergence through undetected.
  const trail=[...(previous?.trail||[]),max].slice(-DIVERGENCE.growthWindow);
  job.bounding[field]={min,max,iteration:job.iteration,trail,
   negative:previous?.negative||min<0};
 }
 const continuity=/continuity errors : sum local = (\S+?),/.exec(line);
 if(continuity)job.continuity=Number(continuity[1]);
 // Match a fault, not the startup banner: OpenFOAM prints
 // "trapFpe: Floating point exception trapping enabled (FOAM_SIGFPE)." on every
 // healthy run, which a naive /Floating point exception/ test flags at iteration 0.
 if(/FOAM FATAL (ERROR|IO ERROR)|sigFpe::sigHandler|sigSegv::sigHandler/.test(line))
  job.fatalLine=line.trim().slice(0,300);
}

// Pure: given the accumulated job state, decide whether the run is dead.
function divergenceVerdict(job){
 if(job.fatalLine)return {diverged:true,reason:'OpenFOAM reported a fatal error: '+job.fatalLine};

 const residuals=Object.values(job.residuals||{});
 if(residuals.length&&residuals.some(v=>!Number.isFinite(v)))
  return {diverged:true,reason:'Residuals became non-finite; the solution has blown up.'};

 for(const field of ['k','omega']){
  const trail=job.bounding?.[field]?.trail||[];
  if(trail.length<DIVERGENCE.growthWindow)continue;
  const first=trail[0],last=trail.at(-1);
  if(first>0&&Number.isFinite(last)&&last>=first*DIVERGENCE.growthFactor)
   return {diverged:true,reason:'Turbulence is diverging: '+field+' rose from '
    +first.toPrecision(3)+' to '+last.toPrecision(3)+' over '+DIVERGENCE.growthWindow
    +' iterations while being clipped from below. This usually means the wall treatment '
    +'does not match the mesh near the surface.'};
 }

 if(Number.isFinite(job.continuity)&&Math.abs(job.continuity)>DIVERGENCE.continuityLimit)
  return {diverged:true,reason:'Mass conservation has broken down (continuity error '
   +job.continuity.toPrecision(3)+').'};

 const history=job.residualHistory||[];
 if(history.length>=DIVERGENCE.residualWindow){
  const worst=row=>Math.max(...['p','Ux','Uy','Uz','k','omega']
   .map(key=>row[key]).filter(Number.isFinite));
  const now=worst(history.at(-1)),before=worst(history.at(-DIVERGENCE.residualWindow));
  if(Number.isFinite(now)&&Number.isFinite(before)&&before>0
   &&now>DIVERGENCE.residualFloor&&now>=before*DIVERGENCE.residualRise)
   return {diverged:true,reason:'Residuals are growing rather than falling ('
    +before.toPrecision(3)+' to '+now.toPrecision(3)+' over '+DIVERGENCE.residualWindow
    +' iterations).'};
 }
 return {diverged:false,reason:null};
}

module.exports={readResidualLine,readDiagnosticLine,divergenceVerdict,forceConvergence,DIVERGENCE};
