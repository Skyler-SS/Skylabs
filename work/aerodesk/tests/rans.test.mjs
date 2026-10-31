import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {modelSeeds,traceLine,surfaceBlocker} from '../src/streamlines.mjs';
const require=createRequire(import.meta.url),{validate,plan,createCase,readSamples,readCoefficients,Job}=require('../openfoam.cjs');
const vertices=[-.5,-.02,-.5,.5,-.02,-.5,0,.02,.5,-.5,-.02,-.5,0,.02,.5,0,-.02,.5,.5,-.02,-.5,0,-.02,.5,0,.02,.5,-.5,-.02,-.5,0,-.02,.5,.5,-.02,-.5];
const settings={length:2,speed:25,density:1.225,nu:1.5e-5,referenceArea:.8,minutes:10,intensity:.01};
const hardware={cpu:'Intel Core i7-14700KF',memoryGB:32,freeGB:12,logicalCores:28,solverCores:1};
test('restoring a result rejects changed physical settings or geometry',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'aerodesk-restore-'));try{
   await createCase(dir,vertices,settings,plan(settings,vertices,hardware));const {restoreCase}=require('../openfoam.cjs');
   await assert.rejects(restoreCase(dir,vertices,{...settings,speed:30}),/settings differ: speed/);
   const other=[...vertices];other[0]+=.02;await assert.rejects(restoreCase(dir,other,settings),/geometry differs/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('planner keeps requested quality independent of speed or time and checks RAM',()=>{
  assert.throws(()=>validate({...settings,nu:0},vertices));assert.throws(()=>validate({...settings,minutes:Infinity},vertices));assert.throws(()=>validate(settings,[...vertices.slice(0,-1),NaN]));
  const fast=plan(settings,vertices,hardware),slow=plan(settings,vertices,hardware,{cellIterationsPerSecond:100000});assert.equal(slow.maxCells,fast.maxCells);assert.ok(slow.estimatedSeconds>fast.estimatedSeconds);
  assert.throws(()=>plan(settings,vertices,{...hardware,freeGB:1}),/free/);assert.equal(fast.hw.solverCores,1);
  assert.equal(plan({...settings,minutes:2},vertices,hardware).level,plan({...settings,minutes:240},vertices,hardware).level);
  assert.equal(plan({...settings,qualityMode:'detailed'},vertices.map((v,i)=>i%3===1?v*10:v),hardware).level,6,'Detailed mode refines bulky aircraft too');
});
test('RANS case uses physical dimensions, SST and reference area',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'aerodesk-case-'));
  try{const p=plan(settings,vertices,hardware);await createCase(dir,vertices,settings,p);const stl=await readFile(path.join(dir,'constant/triSurface/model.stl'));const coordinates=require('../case-surface.cjs').readSurface(stl);assert.equal(coordinates[0],-1);assert.equal(coordinates.length,36);
    assert.match(await readFile(path.join(dir,'constant/turbulenceProperties'),'utf8'),/RASModel kOmegaSST/);assert.match(await readFile(path.join(dir,'constant/transportProperties'),'utf8'),/0.000015/);assert.match(await readFile(path.join(dir,'system/controlDict'),'utf8'),/Aref 0.8/);assert.match(await readFile(path.join(dir,'0/U'),'utf8'),/\(25 0 0\)/);
    assert.match(await readFile(path.join(dir,'0/k'),'utf8'),/model \{type fixedValue;value uniform 0;/);
    assert.match(await readFile(path.join(dir,'0/nut'),'utf8'),/nutLowReWallFunction/);
    assert.match(await readFile(path.join(dir,'system/fvSolution'),'utf8'),/residualControl \{\}/,'Stopping also requires stable forces and moments');
    assert.match(await readFile(path.join(dir,'system/controlDict'),'utf8'),/writePrecision 12/);
    assert.match(await readFile(path.join(dir,'system/snappyHexMeshDict'),'utf8'),/mergeTolerance 1e-9/);
    assert.match(await readFile(path.join(dir,'system/layerSurface'),'utf8'),/fields \(nSurfaceLayers\)/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('coefficient parsing follows headers and converts force to Newtons',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'aerodesk-force-'));try{await mkdir(path.join(dir,'postProcessing/coefficients/0'),{recursive:true});await writeFile(path.join(dir,'postProcessing/coefficients/0/coefficient.dat'),'# Time Cd Cs Cl CmPitch\n1 0.2 0.01 0.4 0\n');const [r]=await readCoefficients(dir,settings);assert.equal(r.cy,.4);assert.equal(r.cz,-.01);assert.equal(r.drag,.5*1.225*25**2*.8*.2);}finally{await rm(dir,{recursive:true,force:true});}
});
test('Reference uses the benchmarked airfoil velocity scheme while other modes retain bounded gradients',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'aerodesk-reference-'));try{const s={...settings,qualityMode:'reference'},p=plan(s,vertices,{...hardware,freeGB:24});await createCase(dir,vertices,s,p);const scheme=await readFile(path.join(dir,'system/fvSchemes'),'utf8');assert.equal(p.numerics,'accuracy');assert.match(scheme,/bounded Gauss linearUpwind grad\(U\)/);assert.doesNotMatch(scheme,/linearUpwindV|cellLimited/);assert.match(scheme,/div\(phi,k\) bounded Gauss upwind/);}finally{await rm(dir,{recursive:true,force:true});}
});
test('streamline seeds follow a thin wing; integration obeys field and stops at solids',()=>{
  const seeds=modelSeeds(vertices,.025);assert.ok(seeds.length>=768);assert.ok(seeds.every(p=>Math.abs(p[1])<.15));
  const line=traceLine([0,0,0],(x,y,z)=>x>.2?null:[1,1,0],.025);assert.ok(line.length>3);assert.ok(line.at(-1)[0]<=.2);assert.ok(Math.abs(line.at(-1)[0]-line.at(-1)[1])<1e-10);
  assert.equal(traceLine([0,0,0],()=>null,.025).length,1);
});
test('cancelled jobs never start an executable',async()=>{const job=new Job('unused');job.cancel();await assert.rejects(job.command({},'simpleFoam'),/stopped/);});
test('streamlines cannot cross thin CAD even when the display grid misses it',()=>{
  const blocked=surfaceBlocker([.1,-1,-1,.1,1,-1,.1,0,1]);assert.equal(blocked([0,0,0],[.2,0,0]),true);assert.equal(blocked([0,2,0],[.2,2,0]),false);const line=traceLine([0,0,0],()=>[1,0,0],.03,1,240,blocked);assert.ok(line.at(-1)[0]<.1);
});
test('sample columns follow OpenFOAM scalar-before-vector filename order',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'aerodesk-sampling-'));try{await mkdir(path.join(dir,'postProcessing/sampleForViewer/50'),{recursive:true});await writeFile(path.join(dir,'postProcessing/sampleForViewer/50/viewer_p_U.xy'),'0.5 0.5 0.5 7 20 1 -2\n');const r=await readSamples(dir,{N:1,nx:1,ny:1,nz:1,h:1,origin:[0,0,0]},1);assert.equal(r.ux[0],20);assert.equal(r.uy[0],1);assert.equal(r.uz[0],-2);assert.equal(r.pressure[0],7);assert.equal(r.solid[0],0);}finally{await rm(dir,{recursive:true,force:true});}
});
