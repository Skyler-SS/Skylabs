import {rebuildExterior} from './exterior-rebuild.mjs';import {cleanMesh} from './clean-mesh.mjs';
import {parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';import path from 'node:path';import {pathToFileURL} from 'node:url';import fs from 'node:fs';
import {import3MF} from './import-3mf.mjs';import {cleanAssembly} from './assembly-repair.mjs';
import {decimateParts,DECIMATE_TARGET_TRIANGLES} from './decimate.mjs';
// Ceiling on what a converter may hand back before reduction. Bounds worker memory
// (~6M triangles is roughly 216 MB of float data) without capping the input file size.
const TESSELLATION_CEILING=6000000;
// Reduce converter output inside the worker so a multi-million-triangle tessellation
// never has to cross the IPC boundary to the renderer.
function reduceParts(result){
 const r=decimateParts(result.parts,DECIMATE_TARGET_TRIANGLES);
 return r.reduced?{...result,parts:r.parts,decimated:{from:r.from,to:r.to}}:result;
}
async function manifold(){const m=await import(pathToFileURL(path.join(__dirname,'../vendor/manifold.mjs')).href);const api=await m.default({wasmBinary:fs.readFileSync(path.join(__dirname,'../vendor/manifold.wasm'))});api.setup();return api;}
async function run(){const d=workerData;if(d.type==='rebuild'){const r=await rebuildExterior(new Float32Array(d.vertices),manifold);const c=cleanMesh(r.vertices,{weldTolerance:1e-8});c.report.rebuiltExterior=true;c.report.rebuildSpacing=r.spacing;c.report.unionNote='Approximate exterior rebuilt at '+r.resolution+' cells across the longest dimension. Features and gaps smaller than about two cells may disappear. Review against the original CAD before trusting results.';return c;}if(d.type==='clean')return cleanAssembly(new Float32Array(d.vertices),d.parts?.map(p=>new Float32Array(p)),manifold);
 if(d.type==='3mf')return reduceParts(import3MF(new Uint8Array(d.bytes)));
 if(d.type==='step'){
  const require=createRequire(path.join(__dirname,'worker.cjs'));const occt=await require('../vendor/occt-import-js.cjs')();const bytes=new Uint8Array(d.bytes);
  // Tessellate finely first; back off only if the result would not fit in memory.
  // Decimation then reduces whatever survives to the solver's budget.
  let meshes=null,count=0;
  for(const linearDeflection of [.0005,.002,.008]){
   const r=occt.ReadStepFile(bytes,{linearUnit:'meter',linearDeflectionType:'bounding_box_ratio',linearDeflection,angularDeflection:.3});
   if(!r.success||!r.meshes?.length)throw Error('STEP contains no tessellatable solid surfaces.');
   count=r.meshes.reduce((s,m)=>s+m.index.array.length/3,0);
   meshes=r.meshes;
   if(count<=TESSELLATION_CEILING)break;
  }
  if(count>TESSELLATION_CEILING)throw Error('STEP tessellates to over '+(TESSELLATION_CEILING/1e6)+'M triangles even at coarse resolution. Simplify or split the design before importing.');
  const parts=meshes.map(m=>{const v=new Float32Array(m.index.array.length*3);m.index.array.forEach((id,i)=>v.set(m.attributes.position.array.slice(id*3,id*3+3),i*3));return v;});
  return reduceParts({parts,unit:'meter',sourceUp:'Z'});
 }
 throw Error('Unknown model operation.');}
run().then(result=>parentPort.postMessage({result})).catch(e=>parentPort.postMessage({error:e.message}));

