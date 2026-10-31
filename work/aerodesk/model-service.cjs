const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const foam=require('./openfoam.cjs');
async function nativeSurfaceCheck(vertices){
 const rt=await foam.runtime().catch(()=>null);if(!rt)return {available:false};
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'aerodesk-surface-'));
 try{const b=Buffer.alloc(84+vertices.length/9*50);b.writeUInt32LE(vertices.length/9,80);for(let t=0;t<vertices.length/9;t++)for(let j=0;j<9;j++)b.writeFloatLE(vertices[t*9+j],84+t*50+12+j*4);await fs.writeFile(path.join(folder,'model.stl'),b);const log=await new foam.Job(folder).command(rt,'surfaceCheck',['-checkSelfIntersection','model.stl']);return {available:true,closed:log.includes('Surface is closed'),intersectionFree:log.includes('Surface is not self-intersecting')};
 }finally{if(path.dirname(folder)===path.resolve(os.tmpdir())&&path.basename(folder).startsWith('aerodesk-surface-'))await fs.rm(folder,{recursive:true,force:true});}
}
async function cleanModel(d,worker){
 let original=await worker({type:d.rebuild?'rebuild':'clean',vertices:d.vertices,parts:d.parts});
 const check=async result=>{if(!result.report.ready)return false;const n=await nativeSurfaceCheck(result.vertices);result.report.nativeSurfaceCheck=n;if(n.available&&(!n.closed||!n.intersectionFree)){result.report.ready=false;result.report.unionNote=(result.report.unionNote||'')+' Native OpenFOAM surface check found unresolved geometry.';return false;}return true;};
 if(await check(original))return original;
 if(!d.rebuild){try{const rebuilt=await worker({type:'rebuild',vertices:d.vertices});if(await check(rebuilt)){rebuilt.report.inputFaces=d.vertices.length/9;rebuilt.report.changed=true;rebuilt.report.automaticRebuild=true;return rebuilt;}}catch(e){original.report.unionNote=(original.report.unionNote||'')+' Exterior rebuild could not resolve this model: '+e.message;}}
 return original;
}
module.exports={cleanModel,nativeSurfaceCheck};

