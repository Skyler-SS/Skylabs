import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {liftLocation,liftBalance,forceCenter}=createRequire(import.meta.url)('../physical-properties.cjs');
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function loads(panels){return {panels,force:[0,1,2].map(k=>panels.reduce((s,p)=>s+p.force[k],0)),moment:[0,1,2].map(k=>panels.reduce((s,p)=>s+cross(p.center,p.force)[k],0))};}
test('symmetric lift stays centered despite elevated drag and side-force moments',()=>{
 const l=loads([{center:[-.2,.1,-.5],force:[0,5,0]},{center:[-.2,.1,.5],force:[0,5,0]},{center:[.3,.4,.2],force:[2,0,1]}]);
 const r=liftLocation(l,-.1);assert.deepEqual(r.center,[-.2,-.1,0]);assert.deepEqual(r.force,[0,10,0]);
 assert.ok(Math.abs(forceCenter(l,-.1).center[2])>.01,'combined force axis really differs');
 assert.deepEqual(liftBalance(l),{negative:5,positive:5,imbalance:0});
});
test('unequal wings remain off-center; negative tail lift keeps its sign',()=>{
 const l=loads([{center:[-.2,0,-.5],force:[0,3,0]},{center:[-.2,0,.5],force:[0,5,0]},{center:[.5,.1,0],force:[0,-2,0]}]);
 const r=liftLocation(l);assert.ok(Math.abs(r.center[0]+2.6/6)<1e-12);assert.ok(Math.abs(r.center[2]-1/6)<1e-12);
 assert.deepEqual(liftBalance(l),{negative:2,positive:4,imbalance:1/3});
 assert.deepEqual(liftLocation(l,.3).center,[r.center[0],.3,r.center[2]]);
});
test('missing loads, cancellation and corrupt arrays never give a plausible-looking center',()=>{
 assert.equal(liftLocation({}).center,null);assert.equal(liftLocation({force:[],center:[]}).center,null);
 const l=loads([{center:[0,0,-.5],force:[0,2,0]},{center:[0,0,.5],force:[0,-2,0]}]);assert.equal(liftLocation(l).center,null);
 assert.equal(liftLocation({force:[1,2,3],center:null,reason:'Surface loads disagree with total lift.'}).center,null);
 assert.equal(liftLocation({...l,force:[0,20,0]}).center,null);
 assert.equal(forceCenter({force:[],moment:[]}).center,null);
});
test('saved signed centers survive loading and span halves follow model rotation',()=>{
 assert.deepEqual(liftLocation({force:[1,10,0],absoluteLift:12,center:[.2,0,.03]},.1).center,[.2,.1,.03]);
 const l=loads([{center:[-.5,0,0],force:[0,3,0]},{center:[.5,0,0],force:[0,5,0]}]);
 assert.deepEqual(liftBalance(l,[1,0,0]),{negative:3,positive:5,imbalance:.25});
 assert.equal(liftBalance(l,[2,0,0]),null);
});
