import test from 'node:test';
import assert from 'node:assert/strict';
import {isoSurfaceMesh,sliceSurface} from '../src/volume-view.mjs';
import {scientificReynolds,reynoldsNumber} from '../src/flow-settings.mjs';
import foam from '../openfoam.cjs';

test('continuous slices preserve analytic linear fields on all axes, including endpoints',()=>{
 const g={nx:4,ny:4,nz:4,N:64,h:.5,origin:[-1,-1,-1]},solid=new Uint8Array(64),values=new Float32Array(64);
 for(let z=0;z<4;z++)for(let y=0;y<4;y++)for(let x=0;x<4;x++)values[x+4*(y+4*z)]=(-1+(x+.5)*.5)+2*(-1+(y+.5)*.5)+3*(-1+(z+.5)*.5);
 for(const axis of [0,1,2])for(const fraction of [0,.123,1]){const s=sliceSurface(g,values,solid,axis,fraction);assert.equal(s.values.length,54);for(let i=0;i<s.values.length;i++){const [x,y,z]=s.positions.slice(i*3,i*3+3);assert.ok(Math.abs(s.values[i]-(x+2*y+3*z))<1e-6);assert.ok(Math.abs(s.positions[i*3+axis]-s.coordinate)<1e-12);}}
 solid.fill(1);assert.equal(sliceSurface(g,values,solid,0,.5).values.length,0);solid.fill(0);values.fill(NaN);assert.equal(sliceSurface(g,values,solid,0,.5).values.length,0);
});

test('sphere isosurfaces have smooth unit normals and consistent outward winding',()=>{
 const g={nx:11,ny:11,nz:11,h:.2,origin:[-1.1,-1.1,-1.1]},v=new Float32Array(1331),solid=new Uint8Array(1331);
 for(let z=0;z<11;z++)for(let y=0;y<11;y++)for(let x=0;x<11;x++)v[x+11*(y+11*z)]=(-1+x*.2)**2+(-1+y*.2)**2+(-1+z*.2)**2;
 const {positions:p,normals:n}=isoSurfaceMesh(g,v,solid,.6**2);assert.ok(p.length>0);assert.equal(n.length,p.length);
 for(let i=0;i<p.length;i+=3){assert.ok(Math.abs(Math.hypot(...n.slice(i,i+3))-1)<1e-6);const len=Math.hypot(...p.slice(i,i+3));assert.ok(len>.57&&len<.601);assert.ok(p.slice(i,i+3).reduce((s,v,k)=>s+v*n[i+k],0)/len>.999);}
 for(let i=0;i<p.length;i+=9){const u=[0,1,2].map(k=>p[i+3+k]-p[i+k]),v=[0,1,2].map(k=>p[i+6+k]-p[i+k]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];assert.ok(cross.reduce((s,v,k)=>s+v*n[i+k],0)>0);}
});

test('display grid doubles typical linear resolution within the sample limit',()=>{
 const g=foam.displayGrid([-.5,-.05,-.5,.5,.05,.5]);assert.equal(g.nx,256);assert.equal(g.h,3.6/256);assert.ok(g.N<1500000);
 const wide=foam.displayGrid([-2,-2,-2,2,2,2]);assert.ok(wide.N<=1500000);assert.ok(wide.ny*wide.h>=4.5);
});

test('Reynolds scientific display has three significant figures without rounding physics',()=>{
 const settings={speed:20,length:1.37,nu:1.5e-5},actual=reynoldsNumber(settings);
 assert.equal(scientificReynolds(actual),'1.83e+6');assert.equal(scientificReynolds(1e6),'1.00e+6');assert.equal(scientificReynolds(.001234),'1.23e-3');assert.equal(scientificReynolds(9999),'1.00e+4');assert.equal(reynoldsNumber(settings),actual);assert.notEqual(actual,Number(scientificReynolds(actual)));
});
