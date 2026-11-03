// Assembly joints: pure matrix maths with no DOM and no Electron, so it is unit-testable.
//
// Onshape gives every occurrence an absolute object-to-world transform as a row-major
// 4x4 in metres, already reflecting the assembly's solved position. Joints here are
// therefore driven as DELTAS from that as-saved pose rather than by re-solving the mate
// network: driving a joint rotates or slides the subtree under one mated occurrence and
// leaves everything else exactly where Onshape put it.
//
// That is a deliberate limit, not an approximation of a solver. It is also why the
// /assemblies/.../matevalues endpoint is not used - it is reported to return empty
// arrays even when mates are present, and occurrence transforms already carry the
// solved pose.
//
// Everything stays row-major. three.js Matrix4.set() also takes row-major arguments,
// so these matrices hand over directly.

export const IDENTITY=Object.freeze([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

export function multiply(a,b){
 const out=new Array(16);
 for(let r=0;r<4;r++)for(let c=0;c<4;c++){
  let s=0;for(let k=0;k<4;k++)s+=a[r*4+k]*b[k*4+c];
  out[r*4+c]=s;
 }
 return out;
}

export function transformPoint(m,p){
 return [
  m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+m[3],
  m[4]*p[0]+m[5]*p[1]+m[6]*p[2]+m[7],
  m[8]*p[0]+m[9]*p[1]+m[10]*p[2]+m[11],
 ];
}

// Directions ignore translation, so an axis stays an axis under a posed transform.
export function transformDirection(m,v){
 return [
  m[0]*v[0]+m[1]*v[1]+m[2]*v[2],
  m[4]*v[0]+m[5]*v[1]+m[6]*v[2],
  m[8]*v[0]+m[9]*v[1]+m[10]*v[2],
 ];
}

export function unit(v){
 const n=Math.hypot(v[0],v[1],v[2]);
 if(!(n>1e-12))throw Error('A joint axis has no direction.');
 return [v[0]/n,v[1]/n,v[2]/n];
}

// Rotation by `angle` radians about the line through `origin` along `axis`,
// as translate(origin) * rodrigues(axis,angle) * translate(-origin).
export function rotationAbout(axis,origin,angle){
 const [x,y,z]=unit(axis),c=Math.cos(angle),s=Math.sin(angle),t=1-c;
 const R=[
  t*x*x+c,   t*x*y-s*z, t*x*z+s*y,
  t*x*y+s*z, t*y*y+c,   t*y*z-s*x,
  t*x*z-s*y, t*y*z+s*x, t*z*z+c,
 ];
 const m=[R[0],R[1],R[2],0, R[3],R[4],R[5],0, R[6],R[7],R[8],0, 0,0,0,1];
 for(let r=0;r<3;r++){
  m[r*4+3]=origin[r]-(R[r*3]*origin[0]+R[r*3+1]*origin[1]+R[r*3+2]*origin[2]);
 }
 return m;
}

export function translationAlong(axis,distance){
 const [x,y,z]=unit(axis);
 return [1,0,0,x*distance, 0,1,0,y*distance, 0,0,1,z*distance, 0,0,0,1];
}

// --- Reading an Onshape assembly definition --------------------------------------

// Onshape's mate type names, mapped to what this app can actually drive.
const MATE_TYPES={
 REVOLUTE:'revolute',SLIDER:'slider',CYLINDRICAL:'cylindrical',
 FASTENED:'fastened',PIN_SLOT:'pinSlot',PLANAR:'planar',BALL:'ball',
 PARALLEL:'parallel',TANGENT:'tangent',
};

// Degrees of freedom each drivable type exposes. Everything else is listed read-only
// as structure.
export const DRIVABLE={
 revolute:['angle'],
 slider:['offset'],
 cylindrical:['angle','offset'],
};

export const DOF_UNITS={angle:'deg',offset:'mm'};

// mateType is a parameter, located by parameterId - not by position in the array.
function parameter(featureData,id){
 return (featureData?.parameters||[]).find(p=>p&&p.parameterId===id);
}

function enumValue(featureData,id){
 const p=parameter(featureData,id);
 return p&&typeof p.value==='string'?p.value:'';
}

// Limits arrive as expressions such as "30 deg" or "0.5 in". Anything that does not
// parse cleanly is treated as "no limit" rather than guessed at.
const LENGTH_TO_MM={m:1000,meter:1000,metre:1000,mm:1,millimeter:1,millimetre:1,cm:10,centimeter:10,in:25.4,inch:25.4,ft:304.8};
const ANGLE_TO_DEG={deg:1,degree:1,rad:180/Math.PI,radian:180/Math.PI};
export function parseQuantity(expression,kind){
 if(typeof expression!=='string')return null;
 const m=expression.trim().match(/^(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*([A-Za-z]*)$/);
 if(!m)return null;
 const value=Number(m[1]);if(!Number.isFinite(value))return null;
 const unitName=m[2].toLowerCase().replace(/s$/,'');
 const table=kind==='angle'?ANGLE_TO_DEG:LENGTH_TO_MM;
 if(!unitName)return kind==='angle'?value*ANGLE_TO_DEG.rad:value*LENGTH_TO_MM.m;
 const factor=table[unitName];
 return factor===undefined?null:value*factor;
}

function limitsFor(featureData,type){
 const enabled=parameter(featureData,'mateLimitsEnabled');
 if(enabled&&enabled.value===false)return {};
 const read=(id,kind)=>{
  const p=parameter(featureData,id);
  if(!p||p.isNull===true)return null;
  return parseQuantity(p.expression,kind);
 };
 const out={};
 if(type==='revolute'||type==='cylindrical'){
  const lo=read('limitAxialZMin','angle'),hi=read('limitAxialZMax','angle');
  if(lo!==null)out.angleMin=lo;
  if(hi!==null)out.angleMax=hi;
 }
 if(type==='slider'||type==='cylindrical'){
  const lo=read('limitZMin','length'),hi=read('limitZMax','length');
  if(lo!==null)out.offsetMin=lo;
  if(hi!==null)out.offsetMax=hi;
 }
 return out;
}

// A mate connector's frame, expressed relative to its own occurrence. The mate's
// primary axis is its Z axis, which is the rotation axis of a revolute mate and the
// slide direction of a slider.
function matedFrame(entity){
 const cs=entity&&entity.matedCS;
 if(!cs||!Array.isArray(cs.origin)||!Array.isArray(cs.zAxis))return null;
 const origin=cs.origin.map(Number),axis=cs.zAxis.map(Number);
 if(origin.length!==3||axis.length!==3)return null;
 if(![...origin,...axis].every(Number.isFinite))return null;
 if(!(Math.hypot(axis[0],axis[1],axis[2])>1e-9))return null;
 return {origin,axis};
}

const text=(v,fallback,max=120)=>(typeof v==='string'&&v.trim()?v.trim():fallback).slice(0,max);

// A sub-assembly is identified by the document, element and configuration it came
// from. Instances reference the same four fields, which is how an instance is paired
// with its definition. The microversion is matched when both sides report one, and
// ignored when they disagree, because version- and microversion-pinned references
// name the same element.
function assemblyKeys(o){
 const base=[o.documentId||'',o.elementId||'',o.configuration||''].join('|');
 const stamp=o.documentMicroversion||o.documentVersion||'';
 return stamp?[stamp+'|'+base,base]:[base];
}

function instanceRecord(i){
 return {
  id:i.id,name:text(i.name,'Instance',250),type:text(i.type,'Unknown',40),
  partId:typeof i.partId==='string'?i.partId:null,
  documentId:typeof i.documentId==='string'?i.documentId:null,
  documentMicroversion:typeof i.documentMicroversion==='string'?i.documentMicroversion:null,
  elementId:typeof i.elementId==='string'?i.elementId:null,
  configuration:typeof i.configuration==='string'?i.configuration:null,
 };
}

const MAX_ASSEMBLY_DEPTH=16;

// Onshape returns only the ROOT assembly's instances and mates in `rootAssembly`;
// everything nested lives in `subAssemblies`, keyed by document and element rather
// than by position. Walking the tree flattens both.
//
// A sub-assembly instanced more than once (a left and a right arm from one arm
// assembly) is walked once per instance, so each copy contributes its own joints and
// the two arms move independently.
function expandTree(definition,root){
 const subs=new Map();
 for(const sub of definition.subAssemblies||[]){
  if(!sub||typeof sub!=='object')continue;
  for(const key of assemblyKeys(sub))if(!subs.has(key))subs.set(key,sub);
 }
 const instances=new Map(),features=[];
 let truncated=false;

 const walk=(node,path,names,depth,chain)=>{
  if(depth>MAX_ASSEMBLY_DEPTH){truncated=true;return;}
  for(const f of node.features||[])features.push({prefix:path,names,feature:f});
  for(const i of node.instances||[]){
   if(!i||typeof i.id!=='string')continue;
   const childPath=[...path,i.id],record=instanceRecord(i);
   instances.set(childPath.join('/'),record);
   if(record.type!=='Assembly')continue;
   const sub=assemblyKeys(record).map(k=>subs.get(k)).find(Boolean);
   if(!sub)continue;
   // An assembly that contains itself would otherwise recurse for ever.
   const id=assemblyKeys(record)[0];
   if(chain.has(id))continue;
   walk(sub,childPath,[...names,record.name],depth+1,new Set(chain).add(id));
  }
 };
 walk(root,[],[],0,new Set());
 return {instances,features,truncated};
}

export function readAssembly(definition){
 const root=definition&&definition.rootAssembly;
 if(!root||typeof root!=='object')throw Error('Onshape returned no assembly definition.');

 // Occurrences are already flat: every one carries its full path from the root and
 // an absolute transform, nested parts included.
 const occurrences=(root.occurrences||[])
  .filter(o=>o&&Array.isArray(o.path)&&o.path.length&&Array.isArray(o.transform)&&o.transform.length===16
   &&o.transform.every(v=>Number.isFinite(Number(v))))
  .map(o=>({path:o.path.map(String),key:o.path.map(String).join('/'),
   transform:o.transform.map(Number),hidden:!!o.hidden}));
 if(!occurrences.length)throw Error('This assembly has no placed instances.');

 const {instances,features,truncated}=expandTree(definition,root);
 const saved=new Map(occurrences.map(o=>[o.key,o.transform]));
 const joints=[];

 for(const {prefix,names,feature} of features){
  const d=feature&&feature.featureData;if(!d)continue;
  const type=MATE_TYPES[enumValue(d,'mateType').toUpperCase()];
  if(!type)continue;
  // A mate inside a sub-assembly names occurrences relative to that sub-assembly, so
  // its paths are prefixed by the path at which this copy of it is placed. Root
  // mates have an empty prefix and already carry full paths.
  const sides=(d.matedEntities||[])
   .map(e=>{
    const frame=matedFrame(e);if(!frame)return null;
    const path=[...prefix,...(e.matedOccurrence||[]).map(String)];
    return {path,key:path.join('/'),origin:frame.origin,axis:frame.axis};
   })
   .filter(Boolean);
  if(sides.length<2)continue;
  const scope=prefix.join('/');
  joints.push({
   // Each placement of a sub-assembly gets its own joint, so the id has to carry the
   // path as well as the feature id.
   id:(scope?scope+'::':'')+text(feature.id,'mate-'+joints.length,80),
   name:(names.length?names.join(' / ')+' / ':'')+text(d.name,type,120),
   scope:scope||null,
   depth:prefix.length,
   type,
   drivable:!!DRIVABLE[type],
   limits:limitsFor(d,type),
   sides:sides.slice(0,2),
   // An axis is only usable if the occurrence it hangs off is one we know about.
   resolved:sides.slice(0,2).every(s=>saved.has(s.key)||s.key===''),
  });
 }

 return {occurrences,instances,joints,truncated,
  savedTransform:key=>saved.get(key)||IDENTITY};
}

// The leaf occurrences that carry geometry, each with everything needed to fetch its
// mesh. Repeated hardware shares one `source`, so N identical screws download once.
export function leafParts(assembly){
 const out=[];
 for(const o of assembly.occurrences){
  const instance=assembly.instances.get(o.key);
  if(!instance||instance.type!=='Part'||!instance.partId||!instance.elementId)continue;
  const source=[instance.documentId,instance.documentMicroversion,instance.elementId,
   instance.partId,instance.configuration||''].join('|');
  // The chain of sub-assembly names this part sits under, so the dialog can show
  // "Right arm / Gripper" rather than a bare part name repeated many times.
  const under=[];
  for(let i=1;i<o.path.length;i++){
   const parent=assembly.instances.get(o.path.slice(0,i).join('/'));
   if(parent)under.push(parent.name);
  }
  out.push({key:o.key,path:o.path,name:instance.name,under,
   label:under.length?under.join(' / ')+' / '+instance.name:instance.name,
   hidden:o.hidden,source,instance});
 }
 return out;
}

// --- Posing ----------------------------------------------------------------------

export function isPrefix(prefix,path){
 if(prefix.length>path.length)return false;
 for(let i=0;i<prefix.length;i++)if(prefix[i]!==path[i])return false;
 return true;
}

export function clampValue(joint,dof,value){
 if(!Number.isFinite(value))return 0;
 const lo=joint.limits[dof==='angle'?'angleMin':'offsetMin'];
 const hi=joint.limits[dof==='angle'?'angleMax':'offsetMax'];
 if(Number.isFinite(lo)&&value<lo)return lo;
 if(Number.isFinite(hi)&&value>hi)return hi;
 return value;
}

// The driven axis in assembly space: the mate connector's frame carried out by the
// as-saved transform of the occurrence it belongs to.
export function jointAxis(assembly,joint,flip=false){
 const side=joint.sides[flip?1:0];
 const m=assembly.savedTransform(side.key);
 return {origin:transformPoint(m,side.origin),axis:unit(transformDirection(m,side.axis))};
}

// `values` maps joint id to {angle, offset, flip}. Angles are degrees, offsets are
// millimetres - the units the dialog shows - and are converted here.
export function poseMatrices(assembly,values){
 const deltas=[];
 for(const joint of assembly.joints){
  const v=values&&values[joint.id];
  if(!v||!joint.drivable||!joint.resolved)continue;
  const flip=!!v.flip,moved=joint.sides[flip?1:0];
  const dofs=DRIVABLE[joint.type];
  const angle=dofs.includes('angle')?clampValue(joint,'angle',Number(v.angle)||0):0;
  const offset=dofs.includes('offset')?clampValue(joint,'offset',Number(v.offset)||0):0;
  if(!angle&&!offset)continue;
  let axis;
  try{axis=jointAxis(assembly,joint,flip);}catch{continue;}
  let delta=IDENTITY;
  if(angle)delta=multiply(rotationAbout(axis.axis,axis.origin,angle*Math.PI/180),delta);
  if(offset)delta=multiply(translationAlong(axis.axis,offset/1000),delta);
  deltas.push({prefix:moved.path,delta});
 }
 // Outermost first, so a joint inside a moved subassembly is carried by the outer
 // joint instead of fighting it.
 deltas.sort((a,b)=>a.prefix.length-b.prefix.length);

 const out=new Map();
 for(const o of assembly.occurrences){
  let m=o.transform;
  for(let i=deltas.length-1;i>=0;i--){
   if(isPrefix(deltas[i].prefix,o.path))m=multiply(deltas[i].delta,m);
  }
  out.set(o.key,m);
 }
 return out;
}

// Applies a row-major 4x4 to a flat XYZ vertex array, in place, returning it.
export function applyMatrix(vertices,m){
 for(let i=0;i<vertices.length;i+=3){
  const x=vertices[i],y=vertices[i+1],z=vertices[i+2];
  vertices[i]=m[0]*x+m[1]*y+m[2]*z+m[3];
  vertices[i+1]=m[4]*x+m[5]*y+m[6]*z+m[7];
  vertices[i+2]=m[8]*x+m[9]*y+m[10]*z+m[11];
 }
 return vertices;
}

// A named joint configuration, e.g. "aileron 15 deg", as stored in the project file.
export function normalizeConfiguration(assembly,values){
 const out={};
 for(const joint of assembly.joints){
  const v=values&&values[joint.id];
  if(!v||!joint.drivable)continue;
  const dofs=DRIVABLE[joint.type],entry={};
  if(dofs.includes('angle'))entry.angle=clampValue(joint,'angle',Number(v.angle)||0);
  if(dofs.includes('offset'))entry.offset=clampValue(joint,'offset',Number(v.offset)||0);
  if(v.flip)entry.flip=true;
  const moved=(entry.angle||0)!==0||(entry.offset||0)!==0;
  if(moved||v.flip)out[joint.id]=entry;
 }
 return out;
}

export function describeJoint(joint){
 if(!joint.drivable)return joint.type==='fastened'?'Fastened · structure only':joint.type+' · not drivable here';
 return DRIVABLE[joint.type].map(d=>d==='angle'?'rotates (deg)':'slides (mm)').join(' and ');
}
