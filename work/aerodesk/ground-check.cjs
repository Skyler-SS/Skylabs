const fs=require('node:fs/promises'),path=require('node:path');
const {parseSurfaceVTK}=require('./surface-loads.cjs');
const {surfaceLoads}=require('./physical-properties.cjs');
const {boundaryLayers}=require('./layer-mesh.cjs');
// Check the floor near the body, where ground effects are measured. Remote floor
// faces must not dilute failed local wall resolution with a large passing area.
async function readGroundCheck(folder,s,p){
 if(!s.groundMode||s.groundMode==='none')return null;
 try{
  const root=path.join(folder,'postProcessing/bodySurface'),times=(await fs.readdir(root)).filter(v=>Number.isFinite(+v)).sort((a,b)=>+b-+a);
  const v=parseSurfaceVTK(await fs.readFile(path.join(root,times[0],'ground.vtk'),'utf8'));
  const panels=surfaceLoads(v.points,v.faces,v.pressure,v.shear,1).panels;
  const layers=boundaryLayers(await fs.readFile(path.join(folder,'0/nSurfaceLayers'),'utf8'),v.faces.length,'ground');
  const b=p.bounds,L=s.length,local=panels.filter(x=>x.center[0]>=(b[0]-1)*L&&x.center[0]<=(b[3]+1)*L&&x.center[2]>=(b[2]-1)*L&&x.center[2]<=(b[5]+1)*L),area=local.reduce((n,x)=>n+x.area,0);
  const weighted=fn=>area?local.reduce((n,x)=>n+x.area*fn(x.index),0)/area:0;
  const yPlusFraction=weighted(i=>Number.isFinite(v.yPlus?.[i])&&v.yPlus[i]>=0&&v.yPlus[i]<=2?1:0),coverage=weighted(i=>layers?.[i]>0?1:0),mean=weighted(i=>layers?.[i]||0),requested=p.wall.layers;
  return {passed:area>0&&yPlusFraction>=.9&&coverage>=.9&&mean>=.7*requested,faces:local.length,area,yPlusFraction,coverage,mean,requested,scope:'Floor within one model length of body footprint; y+ ≤ 2 on 90% of area and ≥90% layer coverage.'};
 }catch(e){return {passed:false,reason:e.message};}
}
module.exports={readGroundCheck};
