const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
function massProperties(vertices,length,density){
  if(!Number.isFinite(length)||length<=0||!Number.isFinite(density)||density<=0)throw Error('Enter positive model size and material density.');
  let volume=0;const moment=[0,0,0];
  for(let i=0;i<vertices.length;i+=9){const a=Array.from(vertices.slice(i,i+3)),b=Array.from(vertices.slice(i+3,i+6)),c=Array.from(vertices.slice(i+6,i+9)),n=cross(b,c),v=a.reduce((s,x,k)=>s+x*n[k],0)/6;volume+=v;for(let k=0;k<3;k++)moment[k]+=v*(a[k]+b[k]+c[k])/4;}
  if(Math.abs(volume)<1e-12)throw Error('A closed solid is needed to estimate center of gravity.');
  return {volume:Math.abs(volume)*length**3,mass:Math.abs(volume)*length**3*density,center:moment.map(v=>v/volume)};
}
function surfaceLoads(points,faces,pressure,shear,density){
  if(pressure.length!==faces.length||shear.length!==faces.length*3)throw Error('Surface load data is incomplete.');
  const force=[0,0,0],weighted=[0,0,0],pressureForce=[0,0,0],viscousForce=[0,0,0],moment=[0,0,0],pressureMoment=[0,0,0],viscousMoment=[0,0,0],panels=[];let absoluteLift=0;
  for(let i=0;i<faces.length;i++){
    const f=faces[i],a=[0,0,0],areaVector=[0,0,0],center=[0,0,0];let sumArea=0;
    for(const v of f)for(let k=0;k<3;k++)a[k]+=points[v][k]/f.length;
    for(let j=0;j<f.length;j++){const b=points[f[j]],c=points[f[(j+1)%f.length]],n=cross(sub(b,a),sub(c,a)).map(v=>v/2),w=Math.hypot(...n);sumArea+=w;for(let k=0;k<3;k++){areaVector[k]+=n[k];center[k]+=w*(a[k]+b[k]+c[k])/3;}}
    const area=Math.hypot(...areaVector);if(!area||!sumArea)continue;for(let k=0;k<3;k++)center[k]/=sumArea;
    // Patch normals point out of the fluid. wallShearStress is traction on fluid.
    const fp=areaVector.map(v=>density*pressure[i]*v),fv=[0,1,2].map(k=>-density*shear[i*3+k]*area),load=fp.map((v,k)=>v+fv[k]),mp=cross(center,fp),mv=cross(center,fv);
    for(let k=0;k<3;k++){force[k]+=load[k];pressureForce[k]+=fp[k];viscousForce[k]+=fv[k];moment[k]+=mp[k]+mv[k];pressureMoment[k]+=mp[k];viscousMoment[k]+=mv[k];weighted[k]+=center[k]*load[1];}absoluteLift+=Math.abs(load[1]);
    panels.push({index:i,center,normal:areaVector.map(v=>-v/area),area,pressurePa:density*pressure[i],shearPa:density*Math.hypot(...shear.slice(i*3,i*3+3)),force:load,pressureForce:fp,viscousForce:fv});
  }
  const cancellationRatio=Math.abs(force[1])/Math.max(absoluteLift,1e-30),stable=Math.abs(force[1])>Math.max(1e-8,absoluteLift*.01);
  // Vertical forces have a line of action, not a unique height. Project onto Y=0.
  const center=stable?[weighted[0]/force[1],0,weighted[2]/force[1]]:null;
  return {force,pressureForce,viscousForce,moment,pressureMoment,viscousMoment,absoluteLift,cancellationRatio,center,panels,method:'Signed +Y pressure and viscous loads; lift line intersects Y=0',reason:stable?null:'Opposing loads nearly cancel: no stable center of lift.'};
}
// Central axis of the complete force/moment system. Its residual couple is parallel
// to F; a general 3-D load cannot be represented by a force at one point alone.
function forceCenter(loads,height=0){
  if(loads?.reason&&loads.center===null)return {center:null,reason:loads.reason};
  const f=loads?.force,m=loads?.moment;
  if(f?.length!==3||m?.length!==3||!f.every(Number.isFinite)||!m.every(Number.isFinite)||!Number.isFinite(height))return {center:null,reason:'Complete force and moment data required.'};
  const f2=f.reduce((s,v)=>s+v*v,0),cancellation=Math.abs(f[1])/Math.max(loads.absoluteLift||Math.abs(f[1]),1e-30);
  if(f2<1e-16||Math.abs(f[1])<Math.sqrt(f2)*.01||cancellation<.01)return {center:null,reason:'Net lift is too small or opposing loads cancel; a lift/pressure center is not well determined.'};
  const closest=cross(f,m).map(v=>v/f2),t=(height-closest[1])/f[1],center=closest.map((v,k)=>v+t*f[k]),arm=cross(center,f),residualMoment=m.map((v,k)=>v-arm[k]);
  return {center,residualMoment,cancellationRatio:cancellation,method:'Resultant aerodynamic force axis at CG height; includes pressure, friction and all moments.'};
}
// Lift is the signed wind-up component of each native face load. Drag and side
// force moments belong to the complete wrench, not to this vertical line.
function liftLocation(loads,height=0){
  if(loads?.reason&&loads.center===null)return {center:null,reason:loads.reason};
  if(!Number.isFinite(height)||loads?.force?.length!==3||!loads.force.every(Number.isFinite))return {center:null,reason:'Native surface lift data required.'};
  let lift=loads.force[1],absolute=loads.absoluteLift,center=loads.center;
  if(loads.panels?.length){
    const weighted=[0,0,0];lift=0;absolute=0;
    for(const p of loads.panels){
      if(p.center?.length!==3||p.force?.length!==3||!p.center.every(Number.isFinite)||!p.force.every(Number.isFinite))return {center:null,reason:'Incomplete native surface lift data.'};
      lift+=p.force[1];absolute+=Math.abs(p.force[1]);for(let k=0;k<3;k++)weighted[k]+=p.center[k]*p.force[1];
    }
    if(Math.abs(lift-loads.force[1])>Math.max(1e-8,Math.abs(loads.force[1])*.03))return {center:null,reason:'Surface loads disagree with total lift.'};
    center=weighted.map(v=>v/lift);
  }
  const cancellationRatio=Math.abs(lift)/Math.max(absolute||Math.abs(lift),1e-30);
  if(Math.abs(lift)<1e-8||cancellationRatio<.01)return {center:null,reason:'Opposing loads nearly cancel: no stable center of lift.'};
  if(center?.length!==3||!center.every(Number.isFinite))return {center:null,reason:'Native surface lift location unavailable.'};
  return {center:[center[0],height,center[2]],force:[0,lift,0],cancellationRatio,method:'Signed vertical pressure and friction loads; vertical line shown at CG height. Drag and side-force moments are separate.'};
}
function liftBalance(loads,spanAxis=[0,0,1]){
  if(!loads?.panels?.length||spanAxis?.length!==3||!spanAxis.every(Number.isFinite)||Math.abs(Math.hypot(...spanAxis)-1)>1e-6)return null;
  let negative=0,positive=0;
  for(const p of loads.panels){const z=p.center.reduce((s,v,k)=>s+v*spanAxis[k],0);if(z<0)negative+=p.force[1];else if(z>0)positive+=p.force[1];else{negative+=p.force[1]/2;positive+=p.force[1]/2;}}
  return {negative,positive,imbalance:Math.abs(positive-negative)/Math.max(Math.abs(negative)+Math.abs(positive),1e-30)};
}
module.exports={massProperties,surfaceLoads,forceCenter,liftLocation,liftBalance};
