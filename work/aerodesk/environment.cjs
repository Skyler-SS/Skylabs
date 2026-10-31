// Shared physical environment for native cases, project identity and the viewer.
const fluidPresets={air:{density:1.225,nu:1.5e-5},water:{density:998.2,nu:1.004e-6}};
function environment(s={}){
 const fluidMedium=s.fluidMedium??'air',groundMode=s.groundMode??'none',clearance=s.groundClearance??0.1;
 if(!Object.hasOwn(fluidPresets,fluidMedium))throw Error('Choose air or fully submerged water.');
 if(!['none','moving','stationary'].includes(groundMode))throw Error('Choose open space, moving ground or a stationary floor.');
 if(!Number.isFinite(clearance)||clearance<0||clearance>1000)throw Error('Ground clearance must be 0–1000 meters.');
 if(groundMode!=='none'&&Number.isFinite(s.length)&&clearance>5*s.length)throw Error('Ground clearance must be at most five model lengths. Use open space for a distant ground.');
 if(s.engine==='preview'&&(fluidMedium==='water'||groundMode!=='none'))throw Error('Water and ground require the OpenFOAM solver.');
 return {fluidMedium,groundMode,groundClearance:groundMode==='none'?0:clearance};
}
function sameEnvironment(a,b){const x=environment(a),y=environment(b);return x.fluidMedium===y.fluidMedium&&x.groundMode===y.groundMode&&Math.abs(x.groundClearance-y.groundClearance)<=Math.max(1e-12,Math.abs(y.groundClearance)*1e-8);}
function groundPlan(s,bounds,p={}){
 const e=environment(s);if(e.groundMode==='none')return null;
 const y=bounds[1]-e.groundClearance/s.length,nearTop=Math.max(bounds[4]+.5,y+1),nearHeight=nearTop-y,upperHeight=8-nearTop,nearCells=Math.max(4,Math.ceil(nearHeight/.25));
 const gap=e.groundClearance/s.length,target=p.qualityMode==='draft'?1:2,level=Math.min((p.level??4)+1,Math.max(p.volumeLevel??2,gap>0?Math.ceil(Math.log2(target/gap)):p.level??4));
 return {...e,y,nearTop,nearCells,yCells:nearCells+12,yGrading:`((${nearHeight} ${nearCells} 1)(${upperHeight} 12 10))`,gapLevel:level,estimatedGapCells:gap*2**level/.25,wallSpeed:e.groundMode==='moving'?s.speed:0};
}
function environmentLabel(s){const e=environment(s);return (e.fluidMedium==='water'?'Water · fully submerged':'Air')+' · '+(e.groundMode==='none'?'open space':(e.groundMode==='moving'?'moving ground':'stationary floor')+' · clearance '+e.groundClearance+' m');}
function freeFlight(s){const e=environment(s);return e.fluidMedium==='air'&&e.groundMode==='none';}
module.exports={fluidPresets,environment,sameEnvironment,groundPlan,environmentLabel,freeFlight};
