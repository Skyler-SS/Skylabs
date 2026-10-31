const fs=require('node:fs/promises'),path=require('node:path');
const clean=text=>text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
function patches(text){
 const result={};for(const match of clean(text).matchAll(/(?:"([^"\n]+)"|([\w.-]+))\s*\{([^{}]*)\}/g))result[match[1]||match[2]]=match[3];return result;
}
function flowBalance(phi,boundary,tolerance=1e-5){
 const failure=reason=>({passed:false,reason,tolerance});
 if(!/\bdimensions\s*\[\s*0\s+3\s+-1\s+0\s+0\s+0\s+0\s*\]/.test(phi))return failure('Missing or unsupported volumetric flux dimensions.');
 const index=phi.indexOf('boundaryField');if(index<0)return failure('Boundary flow data is missing.');
 const values=patches(phi.slice(index)),mesh=patches(boundary),fluxes=[];let inflow=0,outflow=0,wallLeakage=0;
 for(const [name,patch] of Object.entries(mesh)){
  const faces=Number(/\bnFaces\s+(\d+)\s*;/.exec(patch)?.[1]);if(!Number.isSafeInteger(faces)||faces<0)continue;
  const type=/\btype\s+(\w+)\s*;/.exec(patch)?.[1];if(type==='processor'||type==='processorCyclic')return failure('Reconstruct the native mesh before checking flow balance.');
  if(type==='empty'||!faces)continue;
  const field=values[name];if(!field)return failure('Missing boundary flux for '+name+'.');
  const uniform=/\bvalue\s+uniform\s+([\deE+.-]+)\s*;/.exec(field),list=/\bvalue\s+nonuniform\s+List<scalar>\s+(\d+)\s*\(([^)]*)\)/s.exec(field);
  let a;if(uniform)a=[Number(uniform[1])];else if(list){a=list[2].trim().split(/\s+/).map(Number);if(+list[1]!==faces||a.length!==faces)return failure('Boundary flux count differs from mesh on '+name+'.');}else return failure('Unrecognized boundary flux on '+name+'.');
  if(a.some(v=>!Number.isFinite(v)))return failure('Non-finite boundary flux on '+name+'.');
  const count=uniform?faces:1,negative=a.reduce((sum,v)=>sum+Math.max(-v,0)*count,0),positive=a.reduce((sum,v)=>sum+Math.max(v,0)*count,0);
  inflow+=negative;outflow+=positive;if(type==='wall')wallLeakage+=negative+positive;fluxes.push({name,faces,type,inflow:negative,outflow:positive,net:positive-negative});
 }
 if(!fluxes.length||!(inflow>0))return failure('No finite inflow was found for this external-flow case.');
 const net=outflow-inflow,relativeImbalance=Math.abs(net)/inflow,relativeWallLeakage=wallLeakage/inflow,passed=relativeImbalance<=tolerance&&relativeWallLeakage<=1e-8;
 return {passed,reason:passed?'Boundary volume flux is balanced.':'Boundary flux imbalance or solid-wall leakage exceeds the limit.',inflow,outflow,net,relativeImbalance,wallLeakage,relativeWallLeakage,tolerance,wallTolerance:1e-8,units:'m3/s',patches:fluxes,method:'Sum of native face-integrated boundary phi; imbalance normalized by total inward flux. Constant density makes the relative mass imbalance identical.'};
}
async function readFlowBalance(folder,time){try{const [phi,boundary]=await Promise.all([fs.readFile(path.join(folder,String(time),'phi'),'utf8'),fs.readFile(path.join(folder,'constant/polyMesh/boundary'),'utf8')]);return flowBalance(phi,boundary);}catch(e){return {passed:false,reason:'Native flow balance unavailable: '+e.message};}}
module.exports={flowBalance,readFlowBalance};
