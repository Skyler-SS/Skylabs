import test from 'node:test';
import assert from 'node:assert/strict';
import properties from '../physical-properties.cjs';
import {velocityContrast} from '../src/analysis.mjs';
import {refinedIsoSurface,isoSurfaceMesh} from '../src/volume-view.mjs';
import {regionAdvice} from '../src/design-advice.mjs';
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
test('force center includes elevated drag torque and preserves the full force system',()=>{
 const force=[2,10,0],point=[.3,.2,-.1],moment=cross(point,force),r=properties.forceCenter({force,moment,absoluteLift:10},.2);
 r.center.forEach((v,k)=>assert.ok(Math.abs(v-point[k])<1e-12));
 const y0=properties.forceCenter({force,moment,absoluteLift:10},0);
 assert.ok(Math.abs(y0.center[0]-.26)<1e-12);assert.notEqual(y0.center[0],.3);
 cross(y0.center,force).forEach((v,k)=>assert.ok(Math.abs(v+y0.residualMoment[k]-moment[k])<1e-12));
 const couple=properties.forceCenter({force,moment:moment.map((v,k)=>v+force[k]*.03),absoluteLift:10},.2);
 couple.residualMoment.forEach((v,k)=>assert.ok(Math.abs(v-force[k]*.03)<1e-12));
 assert.equal(properties.forceCenter({force:[1,0,0],moment:[0,0,1],absoluteLift:20}).center,null);
 assert.equal(properties.forceCenter({force:[1,.01,0],moment:[0,0,1],absoluteLift:20}).center,null);
});
test('automatic velocity contrast rejects noise amplification, excludes missing values, preserves arrays',()=>{
 const input=Float32Array.from([NaN,...Array.from({length:1000},(_,i)=>13+(i/1000-.5)*.01)]),copy=input.slice();
 const a=velocityContrast(input,13);assert.ok(a.max-a.min>=1.299);assert.ok(a.min<13&&a.max>13);assert.deepEqual(input,copy);
 const b=velocityContrast(Array.from({length:1000},(_,i)=>8+i*.006),13);assert.ok(b.min<9&&b.max>13.8);assert.ok(b.max-b.min<7);
});
test('refined isosurfaces preserve linear scalar isovalue and exclude solid/missing cells',()=>{
 const g={nx:3,ny:3,nz:3,h:1,origin:[0,0,0]},v=Float32Array.from({length:27},(_,i)=>(i%3+.5)+2*(Math.floor(i/3)%3+.5)+3*(Math.floor(i/9)+.5)),solid=new Uint8Array(27);
 const fine=refinedIsoSurface(g,v,solid,8),coarse=isoSurfaceMesh(g,v,solid,8);assert.ok(fine.positions.length>coarse.positions.length);
 for(let i=0;i<fine.positions.length;i+=3)assert.ok(Math.abs(fine.positions[i]+2*fine.positions[i+1]+3*fine.positions[i+2]-8)<1e-5);
 solid.fill(1);assert.equal(refinedIsoSurface(g,v,solid,8).positions.length,0);solid.fill(0);v.fill(NaN);assert.equal(refinedIsoSurface(g,v,solid,8).positions.length,0);
});
test('design experiments use measured pressure/friction dominance and label uncertain evidence',()=>{
 const p=regionAdvice({id:'D1',dragN:2,pressureDragN:1.8,frictionDragN:.2},true),f=regionAdvice({id:'D2',dragN:2,pressureDragN:.2,frictionDragN:1.8},false);
 assert.match(p.title,/shape/);assert.match(f.title,/surface/);assert.match(f.tag,/Unconverged/);assert.match(p.verify,/not a computed displacement/);
 const t=regionAdvice({id:'T1',k:2,speed:10},true);assert.match(t.verify,/does not identify a cause/);
});
