import test from 'node:test';import assert from 'node:assert/strict';
import {fields,fieldScale,colorValue,surfaceSampler,loadBins,shiftedMoment,forceStability} from '../src/analysis.mjs';
import {isoSurface,connectedLoads} from '../src/volume-view.mjs';
import props from '../physical-properties.cjs';
test('velocity slices use the same inlet reference across positions; auto remains explicit',()=>{
 const old=fields.section;fields.section={label:'Air speed',unit:'m/s',palette:'sequential',referenceSpeed:true};
 try{
  const outer=fieldScale([12.98675,13,13.03051],'section','fixed',null,13),center=fieldScale([.08,13,14.49],'section','fixed',null,13);
  assert.deepEqual([outer.min,outer.max],[0,20.8]);assert.deepEqual([center.min,center.max],[outer.min,outer.max]);
  assert.deepEqual(colorValue(13,outer),colorValue(13,center));assert.ok((13.03051-outer.min)/(outer.max-outer.min)<.63);
  const auto=fieldScale([12.98675,13,13.03051],'section','auto',null,13);assert.ok(auto.max-auto.min<.05);
  assert.equal(outer.actualMax,13.03051);assert.deepEqual([fieldScale([13],'section','manual',[12,14],13).min,fieldScale([13],'section','manual',[12,14],13).max],[12,14]);
 }finally{if(old)fields.section=old;else delete fields.section;}
});
test('auto scales preserve values, reject invalid manual limits and handle uniform fields',()=>{
 const a=Array.from({length:100},(_,i)=>i);a.push(10000);const before=[...a],s=fieldScale(a,'friction');assert.deepEqual(a,before);assert.ok(s.max<10000&&s.actualMax===10000&&s.clipped>0);
 assert.deepEqual([fieldScale([-2,1],'pressure').min,fieldScale([-2,1],'pressure').max],[-2,2]);
 assert.throws(()=>fieldScale(a,'friction','manual',[2,1]));const uniform=fieldScale([20,20,20],'flow');assert.ok(uniform.min<20&&uniform.max>20);assert.deepEqual(colorValue(20,uniform),colorValue(20,uniform));
 assert.deepEqual([fieldScale(a,'pressure','fixed').min,fieldScale(a,'pressure','fixed').max],[-1,1]);
});
test('surface interpolation separates upper and lower wing skins',()=>{
 const p=[{center:[0,.001,0],normal:[0,1,0],area:1},{center:[0,0,0],normal:[0,-1,0],area:1}],sample=surfaceSampler(p);
 assert.deepEqual(sample([0,0,0],[0,1,0]),[[0,1]]);assert.deepEqual(sample([0,0,0],[0,-1,0]),[[1,1]]);assert.deepEqual(sample([100,0,0],[0,1,0]),[]);
});
test('lift line has a defined reference height and preserves lift moments',()=>{
 const points=[[-2.5,3,-.5],[-2.5,3,.5],[-1.5,3,.5],[-1.5,3,-.5],[1.5,5,-.5],[1.5,5,.5],[2.5,5,.5],[2.5,5,-.5]],faces=[[0,1,2,3],[4,5,6,7]],r=props.surfaceLoads(points,faces,[1,3],[0,0,0,0,0,0],2);
 assert.deepEqual(r.center,[1,0,0]);assert.equal(r.moment[2],r.center[0]*r.force[1]);assert.ok(Math.abs(r.moment[0]+r.center[2]*r.force[1])<1e-12);
 assert.deepEqual(r.pressureForce.map((v,k)=>v+r.viscousForce[k]),r.force);assert.deepEqual(shiftedMoment(r.moment,r.force,[1,7,0]),[0,0,0]);
 const reverse=props.surfaceLoads(points,faces,[-1,-3],[0,0,0,0,0,0],2);assert.equal(reverse.center[0],1);assert.equal(reverse.force[1],-8);
 assert.equal(props.surfaceLoads(points,faces,[1,-.9999],[0,0,0,0,0,0],2).center,null);
});
test('span bins and connected parts conserve integrated force',()=>{
 const panels=[{index:0,center:[0,0,-1],area:1,force:[1,2,3]},{index:1,center:[0,0,1],area:1,force:[4,-1,0]}];
 const bins=loadBins(panels);assert.equal(bins.reduce((s,b)=>s+b.lift,0),1);assert.equal(bins.reduce((s,b)=>s+b.drag,0),5);
 const groups=connectedLoads([],[[0,1,2],[2,3,4]],panels);assert.equal(groups.length,1);assert.deepEqual(groups[0].force,[5,1,3]);assert.equal(connectedLoads([],[[0,1,2],[3,4,5]],panels).length,2);
});
test('marching tetrahedra locates an analytic plane and excludes invalid or solid cells',()=>{
 const g={nx:3,ny:3,nz:3,h:1,origin:[0,0,0]},v=Float32Array.from({length:27},(_,i)=>i%3+.5),solid=new Uint8Array(27),p=isoSurface(g,v,solid,1.25);assert.ok(p.length>0);for(let i=0;i<p.length;i+=3)assert.equal(p[i],1.25);
 solid.fill(1);assert.equal(isoSurface(g,v,solid,1.25).length,0);solid.fill(0);v.fill(NaN);assert.equal(isoSurface(g,v,solid,1.25).length,0);
});
test('convergence range is not reported with too little history or a zero denominator',()=>{
 assert.equal(forceStability([{cd:1}]),null);assert.equal(forceStability(Array.from({length:20},()=>({cd:0}))).relative,null);assert.equal(forceStability(Array.from({length:20},()=>({cd:1}))).relative,0);
});
