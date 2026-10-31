import test from 'node:test';
import assert from 'node:assert/strict';
import {planeSeeds,traceLine} from '../src/streamlines.mjs';
test('streamline seed planes slide continuously on the requested axis',()=>{
 const lo=[-.3,-.05,-.5],hi=[.3,.05,.5];
 for(const [plane,axis] of [['vertical',2],['horizontal',1]]){
  const a=planeSeeds(lo,hi,.01,plane,20),b=planeSeeds(lo,hi,.01,plane,20.05),c=planeSeeds(lo,hi,.01,plane,80);
  assert.equal(a.axis,axis);assert.equal(a.seeds.length,144);assert.ok(b.position>a.position&&b.position-a.position<.001);assert.ok(c.position>b.position);
  for(const layout of [a,b,c])for(const p of layout.seeds)assert.equal(p[axis],layout.position);
  assert.equal(planeSeeds(lo,hi,.01,plane,0).position,a.min);assert.equal(planeSeeds(lo,hi,.01,plane,100).position,a.max);
 }
});
test('a seed plane follows model bounds and real streamlines can leave it',()=>{
 const p=planeSeeds([1,2,3],[2,4,5],.01,'vertical',50,30);assert.equal(p.position,4);assert.ok(p.seeds.every(x=>x[0]<1));
 const line=traceLine(p.seeds[10],()=>[1,0,.25],.01,1,20);assert.ok(line.at(-1)[2]>4);
 assert.throws(()=>planeSeeds([0,0,0],[1,1,1],.01,'all'));
});
