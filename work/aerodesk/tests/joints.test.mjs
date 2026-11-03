import test from 'node:test';
import assert from 'node:assert/strict';
import {
 IDENTITY,multiply,transformPoint,transformDirection,rotationAbout,translationAlong,
 readAssembly,leafParts,poseMatrices,isPrefix,clampValue,jointAxis,applyMatrix,
 parseQuantity,normalizeConfiguration,DRIVABLE,
} from '../src/joints.mjs';

const close=(a,b,tol=1e-9,what='')=>assert.ok(Math.abs(a-b)<=tol,
 what+' expected '+b+', got '+a);
const closeVec=(a,b,tol=1e-9,what='')=>a.forEach((v,i)=>close(v,b[i],tol,what+'['+i+']'));

// A row-major translation, for building fixtures.
const translate=(x,y,z)=>[1,0,0,x, 0,1,0,y, 0,0,1,z, 0,0,0,1];

test('matrix helpers follow row-major convention and compose in the usual order', () => {
 closeVec(transformPoint(translate(1,2,3),[10,20,30]),[11,22,33]);
 // A direction ignores translation, so an axis survives being carried out.
 closeVec(transformDirection(translate(1,2,3),[1,0,0]),[1,0,0]);

 // multiply(a,b) must mean "apply b, then a".
 const scaleThenShift=multiply(translate(10,0,0),translate(0,5,0));
 closeVec(transformPoint(scaleThenShift,[0,0,0]),[10,5,0]);

 // 90 deg about +Z through the origin sends +X to +Y.
 const r=rotationAbout([0,0,1],[0,0,0],Math.PI/2);
 closeVec(transformPoint(r,[1,0,0]),[0,1,0],1e-12);
 // Rotating about an offset line keeps the line itself fixed.
 const offset=rotationAbout([0,0,1],[5,0,0],Math.PI);
 closeVec(transformPoint(offset,[5,0,7]),[5,0,7],1e-12);
 closeVec(transformPoint(offset,[6,0,0]),[4,0,0],1e-12);

 // Translation uses the unit axis, so magnitude comes only from the distance.
 closeVec(transformPoint(translationAlong([0,0,4],2),[0,0,0]),[0,0,2],1e-12);
});

test('quantities parse their units, and anything ambiguous becomes no limit', () => {
 close(parseQuantity('30 deg','angle'),30);
 close(parseQuantity('0.5 rad','angle'),0.5*180/Math.PI,1e-9);
 close(parseQuantity('25.4 mm','length'),25.4);
 close(parseQuantity('1 in','length'),25.4,1e-9);
 close(parseQuantity('0.25 m','length'),250,1e-9);
 // A bare number carries Onshape's base unit: radians for angle, metres for length.
 close(parseQuantity('2','length'),2000,1e-9);
 assert.equal(parseQuantity('30 furlongs','length'),null);
 assert.equal(parseQuantity('about thirty','angle'),null);
 assert.equal(parseQuantity(undefined,'angle'),null);
});

// --- A small assembly: base -> arm -> tip, with one revolute and one slider --------
//
//   base      fixed at the origin
//   arm       hinged to the base about +Z at x=1, drawn lying along +X
//   tip       part of the arm's subtree, further out along +X
//   slide     a slider on `tip` alone, along +X
function definition() {
 return {rootAssembly:{
  instances:[
   {id:'base',name:'Base',type:'Part',partId:'P1',documentId:'D',documentMicroversion:'M',elementId:'E'},
   {id:'arm',name:'Arm',type:'Assembly',documentId:'D',documentMicroversion:'M',elementId:'EA'},
   {id:'armPart',name:'Arm body',type:'Part',partId:'P2',documentId:'D',documentMicroversion:'M',elementId:'E'},
   {id:'tip',name:'Tip',type:'Part',partId:'P3',documentId:'D',documentMicroversion:'M',elementId:'E'},
  ],
  occurrences:[
   {path:['base'],transform:IDENTITY.slice()},
   {path:['arm'],transform:IDENTITY.slice()},
   {path:['arm','armPart'],transform:translate(1,0,0)},
   {path:['arm','tip'],transform:translate(3,0,0)},
  ],
  features:[
   {id:'hinge',featureData:{
    name:'Elbow',
    parameters:[{parameterId:'mateType',value:'REVOLUTE'},
     {parameterId:'mateLimitsEnabled',value:true},
     {parameterId:'limitAxialZMin',expression:'-120 deg'},
     {parameterId:'limitAxialZMax',expression:'120 deg'}],
    matedEntities:[
     {matedOccurrence:['arm'],matedCS:{origin:[1,0,0],xAxis:[1,0,0],yAxis:[0,1,0],zAxis:[0,0,1]}},
     {matedOccurrence:['base'],matedCS:{origin:[1,0,0],xAxis:[1,0,0],yAxis:[0,1,0],zAxis:[0,0,1]}},
    ]}},
   {id:'slide',featureData:{
    name:'Extension',
    parameters:[{parameterId:'mateType',value:'SLIDER'}],
    matedEntities:[
     {matedOccurrence:['arm','tip'],matedCS:{origin:[0,0,0],xAxis:[0,1,0],yAxis:[0,0,1],zAxis:[1,0,0]}},
     {matedOccurrence:['arm','armPart'],matedCS:{origin:[0,0,0],xAxis:[0,1,0],yAxis:[0,0,1],zAxis:[1,0,0]}},
    ]}},
   {id:'bolted',featureData:{
    name:'Cover screw',
    parameters:[{parameterId:'mateType',value:'FASTENED'}],
    matedEntities:[
     {matedOccurrence:['base'],matedCS:{origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0],zAxis:[0,0,1]}},
     {matedOccurrence:['arm'],matedCS:{origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0],zAxis:[0,0,1]}},
    ]}},
  ],
 }};
}

test('mates are read by parameterId, with fastened listed but not drivable', () => {
 const a=readAssembly(definition());
 assert.equal(a.joints.length,3,'all three mates are listed');

 const hinge=a.joints.find(j=>j.id==='hinge');
 assert.equal(hinge.type,'revolute');
 assert.equal(hinge.name,'Elbow');
 assert.equal(hinge.drivable,true);
 assert.deepEqual(DRIVABLE[hinge.type],['angle']);
 close(hinge.limits.angleMin,-120);
 close(hinge.limits.angleMax,120);

 const bolted=a.joints.find(j=>j.id==='bolted');
 assert.equal(bolted.type,'fastened');
 assert.equal(bolted.drivable,false,'a fastened mate is structure, not a control');

 // mateType sits in a parameters array; position must not be what finds it.
 const shuffled=definition();
 shuffled.rootAssembly.features[0].featureData.parameters.reverse();
 assert.equal(readAssembly(shuffled).joints.find(j=>j.id==='hinge').type,'revolute');
});

test('only leaf Part occurrences carry geometry, and repeats share one source', () => {
 const a=readAssembly(definition());
 const parts=leafParts(a);
 assert.deepEqual(parts.map(p=>p.key).sort(),['arm/armPart','arm/tip','base']);
 assert.ok(!parts.some(p=>p.key==='arm'),'a subassembly occurrence is not geometry');

 // Two occurrences of the same part id must collapse to one download.
 const repeated=definition();
 repeated.rootAssembly.instances.push({id:'base2',name:'Base',type:'Part',partId:'P1',
  documentId:'D',documentMicroversion:'M',elementId:'E'});
 repeated.rootAssembly.occurrences.push({path:['base2'],transform:translate(0,9,0)});
 const r=leafParts(readAssembly(repeated));
 const sources=new Set(r.map(p=>p.source));
 assert.equal(r.length,4);
 assert.equal(sources.size,3,'the duplicated part resolves to one source key');
});

test('driving a joint moves its whole subtree and leaves everything else put', () => {
 const a=readAssembly(definition());

 // Undriven, every occurrence stays exactly as saved.
 const rest=poseMatrices(a,{});
 closeVec(rest.get('arm/tip'),translate(3,0,0),1e-12);

 // 90 deg about +Z through (1,0,0): the arm swings up.
 const posed=poseMatrices(a,{hinge:{angle:90}});
 closeVec(transformPoint(posed.get('base'),[0,0,0]),[0,0,0],1e-12,'base must not move');
 // armPart sat at (1,0,0), which is on the hinge axis, so it only spins.
 closeVec(transformPoint(posed.get('arm/armPart'),[0,0,0]),[1,0,0],1e-12);
 // tip sat at (3,0,0), two units out along the arm, so it swings to (1,2,0).
 closeVec(transformPoint(posed.get('arm/tip'),[0,0,0]),[1,2,0],1e-12);
});

test('a joint inside a moved subassembly is carried by the outer joint', () => {
 const a=readAssembly(definition());

 // The slider alone pushes the tip a further 500 mm along +X.
 const slid=poseMatrices(a,{slide:{offset:500}});
 closeVec(transformPoint(slid.get('arm/tip'),[0,0,0]),[3.5,0,0],1e-12);
 closeVec(transformPoint(slid.get('arm/armPart'),[0,0,0]),[1,0,0],1e-12,
  'the slider must not drag its other side along');

 // With the elbow at 90 deg as well, the slide has to follow the rotated arm:
 // the tip starts 2 m out, slides to 2.5 m out, then swings about (1,0,0) to +Y.
 const both=poseMatrices(a,{hinge:{angle:90},slide:{offset:500}});
 closeVec(transformPoint(both.get('arm/tip'),[0,0,0]),[1,2.5,0],1e-12);
});

test('limits clamp a driven value rather than being ignored', () => {
 const a=readAssembly(definition());
 const hinge=a.joints.find(j=>j.id==='hinge');
 close(clampValue(hinge,'angle',200),120,0,'above the maximum clamps to it');
 close(clampValue(hinge,'angle',-200),-120);
 close(clampValue(hinge,'angle',10),10);

 // The pose must use the clamped value, not the requested one.
 const posed=poseMatrices(a,{hinge:{angle:200}});
 const clamped=poseMatrices(a,{hinge:{angle:120}});
 closeVec(posed.get('arm/tip'),clamped.get('arm/tip'),1e-12);

 // A slider with no limits reported stays free.
 const slide=a.joints.find(j=>j.id==='slide');
 assert.deepEqual(slide.limits,{});
 close(clampValue(slide,'offset',12345),12345);
});

test('flipping a joint drives the other side instead', () => {
 const a=readAssembly(definition());
 // Normally the hinge moves the arm. Flipped, it moves the base and leaves the arm.
 const flipped=poseMatrices(a,{hinge:{angle:90,flip:true}});
 closeVec(transformPoint(flipped.get('arm/tip'),[0,0,0]),[3,0,0],1e-12,'arm now holds still');
 closeVec(transformPoint(flipped.get('base'),[0,0,0]),[1,-1,0],1e-12,'base swings instead');
});

test('a configuration records only joints actually moved, already clamped', () => {
 const a=readAssembly(definition());
 const saved=normalizeConfiguration(a,{hinge:{angle:200},slide:{offset:0},bolted:{angle:20}});
 assert.deepEqual(Object.keys(saved),['hinge'],'untouched and non-drivable joints are dropped');
 close(saved.hinge.angle,120,0,'the stored value is the clamped one');

 // Replaying a stored configuration reproduces the same pose.
 closeVec(poseMatrices(a,saved).get('arm/tip'),poseMatrices(a,{hinge:{angle:120}}).get('arm/tip'),1e-12);
});

test('malformed definitions are rejected, not silently half-read', () => {
 assert.throws(()=>readAssembly(null),/no assembly definition/i);
 assert.throws(()=>readAssembly({rootAssembly:{occurrences:[]}}),/no placed instances/i);

 // An occurrence with a short transform is dropped rather than poisoning the pose.
 const broken=definition();
 broken.rootAssembly.occurrences.push({path:['junk'],transform:[1,2,3]});
 assert.equal(readAssembly(broken).occurrences.length,4);

 // A mate missing a usable axis is skipped instead of throwing during posing.
 const noAxis=definition();
 noAxis.rootAssembly.features[0].featureData.matedEntities[0].matedCS.zAxis=[0,0,0];
 const a=readAssembly(noAxis);
 assert.ok(!a.joints.some(j=>j.id==='hinge'),'a degenerate axis means no joint');
 assert.doesNotThrow(()=>poseMatrices(a,{hinge:{angle:30}}));
});

test('path prefixes decide the moved subtree, without matching partial ids', () => {
 assert.equal(isPrefix(['a'],['a','b']),true);
 assert.equal(isPrefix(['a'],['a']),true);
 assert.equal(isPrefix(['a','b'],['a']),false);
 // 'arm' must not match an unrelated instance called 'armrest'.
 assert.equal(isPrefix(['arm'],['armrest','x']),false);
});

test('vertices move by the posed matrix and keep triangle shape', () => {
 const a=readAssembly(definition());
 const m=poseMatrices(a,{hinge:{angle:90}}).get('arm/tip');
 const v=new Float32Array([0,0,0, 1,0,0, 0,1,0]);
 const before=Math.hypot(v[3]-v[0],v[4]-v[1],v[5]-v[2]);
 applyMatrix(v,m);
 closeVec([v[0],v[1],v[2]],[1,2,0],1e-6);
 const after=Math.hypot(v[3]-v[0],v[4]-v[1],v[5]-v[2]);
 close(after,before,1e-6,'a rigid pose must not scale the part');
});

test('the axis is taken in assembly space, not in the part frame', () => {
 // Put the hinge on a subassembly that is itself rotated 90 deg about +X, so a mate
 // Z axis of +Z should come out as -Y in assembly space.
 const d=definition();
 d.rootAssembly.occurrences[1]={path:['arm'],
  transform:[1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1]};
 const a=readAssembly(d);
 const {axis,origin}=jointAxis(a,a.joints.find(j=>j.id==='hinge'));
 closeVec(axis,[0,-1,0],1e-12);
 closeVec(origin,[1,0,0],1e-12);
});
