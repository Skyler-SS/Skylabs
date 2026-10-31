import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {cleanMesh,asciiSTL} from '../src/clean-mesh.mjs';
const box=()=>Array.from(new T.BoxGeometry(1,1,1).toNonIndexed().attributes.position.array);
function holedBox(size=.005){
  const cube=box(),faces=[];for(let i=0;i<cube.length;i+=9)if(![cube[i+1],cube[i+4],cube[i+7]].every(v=>v===.5))faces.push(...cube.slice(i,i+9));
  const outer=[[-.5,.5,-.5],[.5,.5,-.5],[.5,.5,.5],[-.5,.5,.5]],inner=[[-size,.5,-size],[size,.5,-size],[size,.5,size],[-size,.5,size]];
  for(let i=0;i<4;i++){const j=(i+1)%4;faces.push(...outer[i],...inner[i],...inner[j],...outer[i],...inner[j],...outer[j]);}return faces;
}
test('clean closed box and sphere remain closed, preserving size',()=>{
  for(const vertices of [box(),new T.SphereGeometry(.5,24,16).toNonIndexed().attributes.position.array]){const r=cleanMesh(vertices);assert.equal(r.report.ready,true,JSON.stringify(r.report));assert.equal(r.report.outputFaces,vertices.length/9);assert.equal(r.report.filledHoles,0);assert.ok(Math.max(...r.vertices)<=.500001);}
});
test('dirty STL loses duplicates, invalid and collapsed faces, fixes mixed winding',()=>{
  const input=box();[input[3],input[6]]=[input[6],input[3]];[input[4],input[7]]=[input[7],input[4]];[input[5],input[8]]=[input[8],input[5]];
  input.push(...input.slice(0,9),...Array(9).fill(1e8),NaN,0,0,0,1,0,0,0,1);const original=[...input],r=cleanMesh(input);assert.deepEqual(input,original);assert.equal(r.report.ready,true);assert.equal(r.report.outputFaces,12);assert.equal(r.report.duplicateFaces,1);assert.equal(r.report.degenerateFaces,1);assert.equal(r.report.invalidFaces,1);assert.ok(r.report.reorientedFaces>0);
});
test('near seams weld across spatial hash boundaries; millimeter and meter repairs agree',()=>{
  const a=box();a[0]+=5e-7;for(const scale of [1,1000,.001]){const r=cleanMesh(a.map(v=>v*scale));assert.equal(r.report.ready,true);assert.ok(r.report.weldedSeams>0);assert.equal(r.report.outputFaces,12);}
});

test('defective boundary stitches beyond initial weld tolerance without moving intact surfaces',()=>{
  const input=box();input[0]+=3e-6;
  const r=cleanMesh(input);assert.equal(r.report.ready,true,JSON.stringify(r.report));
  assert.ok(r.report.boundaryVerticesStitched>0);assert.ok(r.report.maxBoundaryMove<=8e-6);
  assert.equal(r.report.outputFaces,12);assert.equal(cleanMesh(r.vertices).report.changed,false);
});

test('tiny attached stray triangle is removed while its closed component is preserved',()=>{
  const small=box().map((v,i)=>v*.0002+(i%3===0?2:0));
  const input=[...box(),...small,...small.slice(0,6),2.0002,.0002,0];
  const r=cleanMesh(input);assert.equal(r.report.ready,true,JSON.stringify(r.report));
  assert.equal(r.report.strayFacesRemoved,1);assert.equal(r.report.components,2);assert.equal(r.report.outputFaces,24);
});
test('small planar hole is capped; large intentional opening remains flagged',()=>{
  const small=cleanMesh(holedBox());assert.equal(small.report.ready,true,JSON.stringify(small.report));assert.equal(small.report.filledHoles,1);assert.equal(small.report.addedFaces,2);
  const large=cleanMesh(holedBox(.1));assert.equal(large.report.ready,false);assert.equal(large.report.filledHoles,0);assert.equal(large.report.boundaryEdges,4);
});
test('overlapping closed parts are detected and disjoint parts are preserved',()=>{
  const a=box();for(const [offset,ready] of [[.35,false],[2,true]]){const b=a.map((v,i)=>v+(i%3===0?offset:0));const r=cleanMesh([...a,...b]);assert.equal(r.report.ready,ready,JSON.stringify(r.report));assert.equal(r.report.components,2);assert.equal(r.report.outputFaces,24);if(!ready)assert.ok(r.report.intersections>0);}
});
test('non-manifold edge is flagged rather than discarded',()=>{const a=box();a.push(...a.slice(0,6),0,1,0);const r=cleanMesh(a);assert.equal(r.report.ready,false);assert.ok(r.report.nonManifoldEdges>0);});
test('repeated cleaning is stable and does not round away wing thickness',()=>{
  const g=new T.BoxGeometry(1,.00002,.3).toNonIndexed();const a=cleanMesh(g.attributes.position.array),b=cleanMesh(a.vertices);assert.equal(a.report.ready,true);assert.deepEqual(a.vertices,b.vertices);assert.equal(b.report.changed,false);
});
test('non-planar opening is retained and export writes unit normals in meters',()=>{
  const mesh=holedBox();for(let i=0;i<mesh.length;i+=3)if(mesh[i]===-.005&&mesh[i+2]===-.005)mesh[i+1]+=.002;const r=cleanMesh(mesh);assert.equal(r.report.filledHoles,0);assert.ok(r.report.boundaryEdges>0);
  const stl=asciiSTL(cleanMesh(box()).vertices,2);assert.match(stl,/vertex 1\.00000000/);for(const match of stl.matchAll(/facet normal (.*)/g))assert.ok(Math.abs(Math.hypot(...match[1].split(' ').map(Number))-1)<1e-7);
});
