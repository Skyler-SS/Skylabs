import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import properties from '../physical-properties.cjs';import surface from '../surface-loads.cjs';
const {massProperties,surfaceLoads}=properties;
test('solid volume centroid follows translation and mass scales with length cubed and density',()=>{
  const g=new T.BoxGeometry(1,2,3).toNonIndexed();g.translate(2,-1,.5);
  const r=massProperties(g.attributes.position.array,2,1000);
  assert.ok(Math.abs(r.volume-48)<1e-10);assert.ok(Math.abs(r.mass-48000)<1e-7);
  r.center.forEach((v,k)=>assert.ok(Math.abs(v-[2,-1,.5][k])<1e-10));
  assert.equal(massProperties(g.attributes.position.array,2,500).mass,r.mass/2);
});
test('lift center uses signed pressure and shear forces; zero net lift is undefined',()=>{
  const points=[[-2.5,0,-.5],[-2.5,0,.5],[-1.5,0,.5],[-1.5,0,-.5],[1.5,0,-.5],[1.5,0,.5],[2.5,0,.5],[2.5,0,-.5]],faces=[[0,1,2,3],[4,5,6,7]];
  const r=surfaceLoads(points,faces,[1,3],[0,0,0,0,0,0],2);assert.equal(r.force[1],8);assert.equal(r.center[0],1);
  assert.equal(surfaceLoads(points,faces,[1,-1],[0,0,0,0,0,0],2).center,null);
  const viscous=surfaceLoads(points,faces,[0,0],[0,-1,0,0,-3,0],2);assert.equal(viscous.force[1],8);assert.equal(viscous.center[0],1);
});
test('VTK patch loads read cell fields and reject incomplete arrays',()=>{
  const vtk='# vtk DataFile Version 2.0\nbody\nASCII\nDATASET POLYDATA\nPOINTS 3 float\n0 0 0 0 0 1 1 0 0\nPOLYGONS 1 4\n3 0 1 2\nCELL_DATA 1\nFIELD FieldData 2\np 1 1 float\n4\nwallShearStress 3 1 float\n1 2 3';
  assert.deepEqual(surface.parseSurfaceVTK(vtk).pressure,[4]);
  assert.throws(()=>surface.parseSurfaceVTK(vtk.replace('wallShearStress 3 1','wallShearStress 3 2')));
});
