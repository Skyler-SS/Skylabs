import {cleanMesh} from './clean-mesh.mjs';
export function splitShells(vertices){
 const n=vertices.length/9,parent=Array.from({length:n},(_,i)=>i),seen=new Map(),edges=new Map();function root(a){while(parent[a]!==a){parent[a]=parent[parent[a]];a=parent[a];}return a;}
 for(let f=0;f<n;f++){const ids=[];for(let j=0;j<3;j++){const i=f*9+j*3,key=[vertices[i],vertices[i+1],vertices[i+2]].join(',');if(!seen.has(key))seen.set(key,seen.size);ids.push(seen.get(key));}for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],key=a<b?a+','+b:b+','+a;if(!edges.has(key))edges.set(key,[]);edges.get(key).push(f);}}
 for(const faces of edges.values())if(faces.length===2)parent[root(faces[0])]=root(faces[1]);
 const groups=new Map();for(let i=0;i<n;i++){const r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i);}
 return Array.from(groups.values(),ids=>{const v=new Float32Array(ids.length*9);ids.forEach((f,i)=>v.set(vertices.subarray(f*9,f*9+9),i*9));return v;});
}
export async function cleanAssembly(input,parts,loadManifold){
 function clean(v){let best=cleanMesh(v);if(best.report.ready)return best;const score=r=>r.boundaryEdges+10*r.nonManifoldEdges+10*r.nonManifoldVertices+10*r.intersections+(r.intersectionCheckComplete?0:1000);for(const weldTolerance of [1e-7,1e-8]){const r=cleanMesh(v,{weldTolerance});if(r.report.ready)return r;if(score(r.report)<score(best.report))best=r;}return best;}
 const original=clean(input);if(original.report.ready)return original;
 const shells=parts?.length>1?parts:splitShells(original.vertices);if(shells.length<2||shells.length>256)return original;
 const cleaned=[];let strayShellFaces=0;
 for(const shell of shells){
  if(shell.length<36){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<shell.length;i++){lo[i%3]=Math.min(lo[i%3],shell[i]);hi[i%3]=Math.max(hi[i%3],shell[i]);}if(Math.hypot(...hi.map((v,k)=>v-lo[k]))<=original.report.maxHoleDiameter*.05){strayShellFaces+=shell.length/9;continue;}original.report.unionNote='A separate open surface remains; retained for CAD repair.';return original;}
  const c=clean(shell);
  if(c.report.nonManifoldEdges||c.report.nonManifoldVertices){
   const pieces=splitShells(c.vertices);
   if(pieces.length>1){
    for(const piece of pieces){if(piece.length<36){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<piece.length;i++){lo[i%3]=Math.min(lo[i%3],piece[i]);hi[i%3]=Math.max(hi[i%3],piece[i]);}const diameter=Math.hypot(...hi.map((v,k)=>v-lo[k]));if(diameter<=original.report.maxHoleDiameter*.05){strayShellFaces+=piece.length/9;continue;}original.report.unionNote='A separate open surface remains; retained for CAD repair.';return original;}cleaned.push(clean(piece));}
   }else cleaned.push(c);
  }else cleaned.push(c);
 }
 const closed=r=>!r.boundaryEdges&&!r.nonManifoldEdges&&!r.nonManifoldVertices&&!r.orientationConflicts;
 if(cleaned.some(s=>!closed(s.report))){original.report.unionNote='Some individual parts remain open or non-manifold; solid union requires closed shells.';return original;}
 const {Manifold,Mesh}=await loadManifold(),solids=[];let united;
 try{
  for(const {vertices} of cleaned){const positions=[],indices=[],map=new Map();for(let i=0;i<vertices.length;i+=3){const key=Array.from(vertices.subarray(i,i+3)).join(',');if(!map.has(key)){map.set(key,positions.length/3);positions.push(vertices[i],vertices[i+1],vertices[i+2]);}indices.push(map.get(key));}solids.push(new Manifold(new Mesh({numProp:3,vertProperties:new Float32Array(positions),triVerts:new Uint32Array(indices)})));}
  united=Manifold.union(solids);if(united.status()!=='NoError'||united.isEmpty())throw Error('Solid union failed.');const mesh=united.getMesh();if(mesh.triVerts.length>600000)throw Error('United surface exceeds the supported triangle limit.');const v=new Float32Array(mesh.triVerts.length*3);mesh.triVerts.forEach((id,i)=>v.set(mesh.vertProperties.subarray(id*mesh.numProp,id*mesh.numProp+3),i*3));const repaired=clean(v);
  if(repaired.report.ready){repaired.report.inputFaces=input.length/9;repaired.report.unionedParts=shells.length;repaired.report.strayFacesRemoved+=strayShellFaces;repaired.report.changed=true;repaired.report.unionNote='Overlapping closed parts joined into the external solid. Internal contact surfaces removed; separate non-overlapping solids retained. '+strayShellFaces+' detached tiny degenerate faces removed. Review the resulting model.';return repaired;}
  original.report.unionNote='The union still has invalid surface intersections; original cleaned geometry retained.';return original;
 }catch(e){original.report.unionNote='Could not form a valid solid union: '+e.message;return original;}finally{united?.delete();for(const s of solids)s.delete();}
}
