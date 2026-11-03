const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const foam=require('./openfoam.cjs');
async function nativeSurfaceCheck(vertices){
 const rt=await foam.runtime().catch(()=>null);if(!rt)return {available:false};
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'aerodesk-surface-'));
 try{const b=Buffer.alloc(84+vertices.length/9*50);b.writeUInt32LE(vertices.length/9,80);for(let t=0;t<vertices.length/9;t++)for(let j=0;j<9;j++)b.writeFloatLE(vertices[t*9+j],84+t*50+12+j*4);await fs.writeFile(path.join(folder,'model.stl'),b);const log=await new foam.Job(folder).command(rt,'surfaceCheck',['-checkSelfIntersection','model.stl']);return {available:true,closed:log.includes('Surface is closed'),intersectionFree:log.includes('Surface is not self-intersecting')};
 }finally{if(path.dirname(folder)===path.resolve(os.tmpdir())&&path.basename(folder).startsWith('aerodesk-surface-'))await fs.rm(folder,{recursive:true,force:true});}
}
// Seal sizes to try, as a fraction of the longest dimension, when the caller has not
// chosen one. Each step roughly doubles what it can close; stopping at 2% keeps the
// result recognisable, because past that real gaps start getting bridged.
const SEAL_LADDER=[.0025,.005,.01,.02];
const sealLabel=f=>'seal '+(f*100).toFixed(2)+'% of length';
async function cleanModel(d,worker){
 const check=async result=>{if(!result.report.ready)return false;const n=await nativeSurfaceCheck(result.vertices);result.report.nativeSurfaceCheck=n;if(n.available&&(!n.closed||!n.intersectionFree)){result.report.ready=false;result.report.unionNote=(result.report.unionNote||'')+' Native OpenFOAM surface check found unresolved geometry.';return false;}return true;};
 // Climb the ladder only while the caller has left the seal size open. In auto mode each
 // step re-tries the exact method first, which costs little because an unresolvable
 // surface is rejected before any meshing happens.
 const attempts=Number.isFinite(d.wrap?.sealFraction)?[d.wrap.sealFraction]:SEAL_LADDER;
 const rebuild=async()=>{
  const failures=[];
  for(const sealFraction of attempts){
   try{
    const rebuilt=await worker({type:'rebuild',vertices:d.vertices,wrap:{...d.wrap,sealFraction}});
    if(await check(rebuilt))return {rebuilt,failures};
    failures.push(sealLabel(sealFraction)+' left geometry unresolved.');
   }catch(e){failures.push(sealLabel(sealFraction)+': '+e.message);}
  }
  return {rebuilt:null,failures};
 };
 if(d.rebuild){
  const {rebuilt,failures}=await rebuild();
  if(rebuilt)return rebuilt;
  throw Error('Exterior rebuild could not resolve this model. '+failures.join(' '));
 }
 const original=await worker({type:'clean',vertices:d.vertices,parts:d.parts});
 if(await check(original))return original;
 const {rebuilt,failures}=await rebuild();
 if(rebuilt){rebuilt.report.inputFaces=d.vertices.length/9;rebuilt.report.changed=true;rebuilt.report.automaticRebuild=true;return rebuilt;}
 original.report.unionNote=(original.report.unionNote||'')+' Exterior rebuild could not resolve this model. '+failures.join(' ');
 return original;
}
module.exports={cleanModel,nativeSurfaceCheck,SEAL_LADDER};

