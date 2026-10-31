// Retain the first initial residual per equation, not the final pressure correction.
function readResidualLine(job,line){
 const time=/^Time = (\d+)/.exec(line);
 if(time){if(job.residuals&&['p','Ux','Uy','Uz','k','omega'].every(k=>Number.isFinite(job.residuals[k]))){job.residualHistory??=[];job.residualHistory.push({...job.residuals,iteration:job.iteration});if(job.residualHistory.length>100)job.residualHistory.shift();}job.iteration=+time[1];}
 const r=/Solving for (p|Ux|Uy|Uz|k|omega), Initial residual = ([\deE+.-]+)/.exec(line);
 if(r&&job.residualIteration!==job.iteration){job.residualIteration=job.iteration;job.residuals={};}
 if(r&&job.residuals[r[1]]===undefined){job.residuals[r[1]]=+r[2];job.residual=Math.max(...Object.values(job.residuals));}
}
function forceConvergence(history){
 const rows=history.slice(-50);if(rows.length<50)return {stable:false,count:rows.length,reason:'Fewer than 50 force samples.'};
 const stats={};for(const key of ['cd','cy']){const a=rows.map(r=>r[key]),mean=a.reduce((s,v)=>s+v,0)/a.length,range=Math.max(...a)-Math.min(...a),tolerance=Math.max(.0001,Math.abs(mean)*.01);stats[key]={mean,range,tolerance,stable:range<=tolerance};}
 return {stable:stats.cd.stable&&stats.cy.stable,count:rows.length,...stats};
}
module.exports={readResidualLine,forceConvergence};
