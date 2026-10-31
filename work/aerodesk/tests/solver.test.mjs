import test from 'node:test';
import assert from 'node:assert/strict';
import {SphereGeometry,BoxGeometry} from 'three';
import {grid,voxelize,Solver,U0} from '../src/solver.mjs';
test('Uniform inlet flow remains uniform with no obstacle',()=>{
  const g=grid(32),s=new Solver(g,new Uint8Array(g.N),40);
  for(let n=0;n<120;n++)s.step();
  for(const i of s.interior){assert.ok(Math.abs(s.rho[i]-1)<1e-6);assert.ok(Math.abs(s.ux[i]-U0)<1e-6);assert.ok(Math.abs(s.uy[i])<1e-7);}
  assert.deepEqual(s.force,[0,0,0]);
});
test('Sphere voxelization volume, laminar drag sign, and transverse symmetry',()=>{
  const g=grid(64),geometry=new SphereGeometry(.5,48,32).toNonIndexed();
  const mask=voxelize(geometry.attributes.position.array,g);
  assert.ok(Math.abs(mask.count*g.h**3-Math.PI/6)<.045);
  assert.ok(Math.abs(mask.area*g.h**2-Math.PI/4)<.07);
  const solver=new Solver(g,mask.solid,40);for(let i=0;i<800;i++)solver.step();
  const snap=solver.snapshot(),cd=snap.force[0]/(.5*U0**2*mask.area);
  assert.ok(cd>0&&cd<10);assert.ok(Math.abs(snap.force[1])<1e-5);assert.ok(Math.abs(snap.force[2])<1e-5);
  assert.ok(Math.abs(snap.ux[30+64*(16+32*16)])<U0*.8,'wake slows behind sphere');
  console.log(JSON.stringify({case:'sphere64',cd,voxelVolume:mask.count*g.h**3}));
});
test('Coarse block, streamlined body, and finer sphere remain stable at highest supported Re',()=>{
  for(const [kind,nx] of [['block',64],['body',64],['sphere',96]]){
    const geometry=kind==='block'?new BoxGeometry(1,.8,.8):new SphereGeometry(.5,32,24);if(kind==='body')geometry.scale(1,.6,.6);
    const g=grid(nx),mask=voxelize(geometry.toNonIndexed().attributes.position.array,g),s=new Solver(g,mask.solid,60);
    for(let i=0;i<240;i++)s.step();assert.ok(s.force[0]>0);console.log(JSON.stringify({case:kind+nx,force:s.force}));
  }
});
test('Reject empty and unresolved meshes and unsupported Reynolds values',()=>{
  const g=grid();assert.throws(()=>voxelize(new Float32Array(0),g),/too thin/);assert.throws(()=>new Solver(g,new Uint8Array(g.N),1000),/between/);
});
