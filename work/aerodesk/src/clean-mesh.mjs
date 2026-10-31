// Conservative surface repair. Work in model-relative coordinates so units do not
// change tolerances. Never smooth globally, discard components or seal large openings.
const maxRepairPatchDiameter=.005; // Local reconstruction limited to 0.5% of model length.
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const edgeKey=(a,b)=>a<b?a+','+b:b+','+a;
const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function edgesOf(faces){const edges=new Map();faces.forEach((f,i)=>{for(let k=0;k<3;k++){const a=f[k],b=f[(k+1)%3],key=edgeKey(a,b);if(!edges.has(key))edges.set(key,[]);edges.get(key).push({i,a,b});}});return edges;}
function repairTinyTopology(faces,points,report){
  // Remove only tiny dangling triangles attached to an already overfull edge.
  // This is distinct from discarding small disconnected components or real fins.
  let edges=edgesOf(faces);
  const stray=new Set();faces.forEach((f,i)=>{const counts=f.map((a,k)=>edges.get(edgeKey(a,f[(k+1)%3])).length);if(counts.filter(n=>n===1).length!==2||!counts.some(n=>n>2))return;const diameter=Math.max(...f.map((a,k)=>Math.hypot(...sub(points[a],points[f[(k+1)%3]]))));if(diameter<=.001)stray.add(i);});
  if(stray.size){const kept=faces.filter((_,i)=>!stray.has(i));faces.length=0;for(const f of kept)faces.push(f);report.strayFacesRemoved+=stray.size;edges=edgesOf(faces);}
  const score=e=>{let open=0,nonManifold=0;for(const list of e.values()){if(list.length===1)open++;if(list.length>2)nonManifold+=list.length-2;}return {open,nonManifold};};
  // Snap ONLY defective boundary vertices, with a strict movement bound, and
  // accept only a reduction of open edges without introducing overfull edges.
  for(const tolerance of [2e-6,4e-6,8e-6]){
    const before=score(edges);if(!before.open)break;const boundary=new Set();for(const e of edges.values())if(e.length===1){boundary.add(e[0].a);boundary.add(e[0].b);}
    const mapping=new Map(),buckets=new Map();let joined=0,maxMove=0;
    for(const id of boundary){const p=points[id],cell=p.map(v=>Math.floor(v/tolerance));let found=-1,best=tolerance;
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){const list=buckets.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','));if(list)for(const other of list){const distance=Math.hypot(...sub(p,points[other]));if(distance<=best){found=other;best=distance;}}}
      if(found>=0){mapping.set(id,found);joined++;maxMove=Math.max(maxMove,best);}else{const key=cell.join(',');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(id);}
    }
    if(!joined)continue;const proposed=[],unique=new Set();let collapsed=0,duplicates=0;
    for(const f of faces){const next=f.map(i=>mapping.get(i)??i);if(new Set(next).size<3||Math.hypot(...cross(sub(points[next[1]],points[next[0]]),sub(points[next[2]],points[next[0]])))<1e-14){collapsed++;continue;}const key=[...next].sort((a,b)=>a-b).join(',');if(unique.has(key)){duplicates++;continue;}unique.add(key);proposed.push(next);}
    const candidate=edgesOf(proposed),after=score(candidate);if(proposed.length<4||after.open>=before.open||after.nonManifold>before.nonManifold)continue;
    faces.length=0;for(const f of proposed)faces.push(f);edges=candidate;report.boundaryVerticesStitched+=joined;report.maxBoundaryMove=Math.max(report.maxBoundaryMove,maxMove);report.degenerateFaces+=collapsed;report.duplicateFaces+=duplicates;
  }
}
function orientFaces(faces,points,report){
  const edges=edgesOf(faces),adj=faces.map(()=>[]),seen=new Int8Array(faces.length).fill(-1),components=[];
  for(const e of edges.values())if(e.length===2){const [a,b]=e,same=a.a===b.a?1:0;adj[a.i].push([b.i,same]);adj[b.i].push([a.i,same]);}
  let conflicts=0;
  for(let i=0;i<faces.length;i++)if(seen[i]<0){const queue=[i];seen[i]=0;for(let j=0;j<queue.length;j++)for(const [next,flip] of adj[queue[j]]){const expected=seen[queue[j]]^flip;if(seen[next]<0){seen[next]=expected;queue.push(next);}else if(seen[next]!==expected)conflicts++;}components.push(queue);}
  for(let i=0;i<faces.length;i++)if(seen[i]){[faces[i][1],faces[i][2]]=[faces[i][2],faces[i][1]];report.reorientedFaces++;}
  for(const group of components){const closed=group.every(i=>faces[i].every((a,k)=>edges.get(edgeKey(a,faces[i][(k+1)%3])).length===2));if(!closed)continue;let volume=0;for(const i of group){const [a,b,c]=faces[i].map(v=>points[v]);volume+=dot(a,cross(b,c))/6;}if(volume<0)for(const i of group){[faces[i][1],faces[i][2]]=[faces[i][2],faces[i][1]];report.reorientedFaces++;}}
  report.orientationConflicts=conflicts/2;return components;
}
function triangulateLoop(loop,points,tolerance,microPatch=false){
  if(loop.length<3||loop.length>128)return null;
  const p=loop.map(i=>points[i]),lo=[0,1,2].map(k=>Math.min(...p.map(a=>a[k]))),hi=[0,1,2].map(k=>Math.max(...p.map(a=>a[k]))),diameter=Math.hypot(...sub(hi,lo));
  if(diameter>.02)return null; // Only holes <=2% of the longest dimension.
  let normal=[0,0,0];for(let i=0;i<p.length;i++){const q=cross(p[i],p[(i+1)%p.length]);normal=normal.map((v,k)=>v+q[k]);}const magnitude=Math.hypot(...normal);if(magnitude<1e-14)return null;normal=normal.map(v=>v/magnitude);
  if(microPatch&&diameter>maxRepairPatchDiameter)return null;
  if(p.some(v=>Math.abs(dot(sub(v,p[0]),normal))>Math.max(5*tolerance,diameter*(microPatch?.35:.005))))return null;
  const drop=[0,1,2].sort((a,b)=>Math.abs(normal[b])-Math.abs(normal[a]))[0],xy=p.map(v=>v.filter((_,k)=>k!==drop));
  for(let i=0;i<xy.length;i++)for(let j=i+1;j<xy.length;j++){if(j===i+1||(i===0&&j===xy.length-1))continue;const a=xy[i],b=xy[(i+1)%xy.length],c=xy[j],d=xy[(j+1)%xy.length];if([0,1].every(k=>Math.min(a[k],b[k])<=Math.max(c[k],d[k])&&Math.max(a[k],b[k])>=Math.min(c[k],d[k]))&&orient(a,b,c)*orient(a,b,d)<=0&&orient(c,d,a)*orient(c,d,b)<=0)return null;}
  let area=0;for(let i=0;i<xy.length;i++)area+=xy[i][0]*xy[(i+1)%xy.length][1]-xy[(i+1)%xy.length][0]*xy[i][1];const sign=Math.sign(area),ids=xy.map((_,i)=>i),triangles=[];if(!sign)return null;
  while(ids.length>3){let ear=false;for(let j=0;j<ids.length;j++){const a=ids[(j+ids.length-1)%ids.length],b=ids[j],c=ids[(j+1)%ids.length];if(sign*orient(xy[a],xy[b],xy[c])<=1e-15)continue;
      if(ids.some(i=>i!==a&&i!==b&&i!==c&&sign*orient(xy[a],xy[b],xy[i])>=-1e-15&&sign*orient(xy[b],xy[c],xy[i])>=-1e-15&&sign*orient(xy[c],xy[a],xy[i])>=-1e-15))continue;
      triangles.push([loop[a],loop[b],loop[c]]);ids.splice(j,1);ear=true;break;}
    if(!ear)return null;
  }triangles.push(ids.map(i=>loop[i]));return triangles;
}
function fillHoles(faces,points,report,tolerance){
  const edges=edgesOf(faces),out=new Map(),incoming=new Map(),boundary=[];
  for(const e of edges.values())if(e.length===1){const edge=e[0];boundary.push(edge);if(!out.has(edge.a))out.set(edge.a,[]);out.get(edge.a).push(edge);incoming.set(edge.b,(incoming.get(edge.b)||0)+1);}
  const visited=new Set();for(const first of boundary){if(visited.has(first))continue;const loop=[];let e=first,valid=true;while(!visited.has(e)){visited.add(e);loop.push(e.a);if(out.get(e.b)?.length!==1||incoming.get(e.b)!==1){valid=false;break;}e=out.get(e.b)[0];}if(e!==first||!valid)continue;
    const caps=triangulateLoop(loop.reverse(),points,tolerance);if(caps&&faces.length+caps.length<=200000){faces.push(...caps);report.filledHoles++;report.addedFaces+=caps.length;}
  }
}
function intersects(a,b,points){
  const ap=a.map(i=>points[i]),bp=b.map(i=>points[i]),n=cross(sub(ap[1],ap[0]),sub(ap[2],ap[0])),m=cross(sub(bp[1],bp[0]),sub(bp[2],bp[0]));
  const nl=Math.hypot(...n),ml=Math.hypot(...m);if(!nl||!ml)return false;
  const shared=a.some(i=>b.includes(i));
  if(Math.hypot(...cross(n,m))<nl*ml*1e-8&&Math.abs(dot(sub(bp[0],ap[0]),n))<nl*1e-9){
    // Clip two coplanar triangles: only a positive-area overlap is a collision.
    const drop=[0,1,2].sort((i,j)=>Math.abs(n[j])-Math.abs(n[i]))[0];let poly=ap.map(p=>p.filter((_,i)=>i!==drop));const clip=bp.map(p=>p.filter((_,i)=>i!==drop)),sign=Math.sign(orient(...clip));
    for(let k=0;k<3;k++){const x=clip[k],y=clip[(k+1)%3],next=[];for(let j=0;j<poly.length;j++){const p=poly[j],q=poly[(j+1)%poly.length],dp=sign*orient(x,y,p),dq=sign*orient(x,y,q);if(dp>=0)next.push(p);if((dp>0&&dq<0)||(dp<0&&dq>0)){const t=dp/(dp-dq);next.push(p.map((v,i)=>v+t*(q[i]-v)));}}poly=next;}
    let area=0;for(let j=0;j<poly.length;j++)area+=poly[j][0]*poly[(j+1)%poly.length][1]-poly[(j+1)%poly.length][0]*poly[j][1];return Math.abs(area)>1e-14;
  }
  if(shared)return false; // Ordinary adjoining faces touch by design.
  function segment(p,q,t){const d=sub(q,p),e1=sub(t[1],t[0]),e2=sub(t[2],t[0]),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-15)return false;const s=sub(p,t[0]),u=dot(s,h)/det;if(u< -1e-9||u>1+1e-9)return false;const r=cross(s,e1),v=dot(d,r)/det,dist=dot(e2,r)/det;return v>=-1e-9&&u+v<=1+1e-9&&dist>=-1e-9&&dist<=1+1e-9;}
  return ap.some((p,i)=>segment(p,ap[(i+1)%3],bp))||bp.some((p,i)=>segment(p,bp[(i+1)%3],ap));
}
function intersectionCheck(faces,points){
  const bounds=faces.map(f=>({lo:[0,1,2].map(k=>Math.min(...f.map(i=>points[i][k]))),hi:[0,1,2].map(k=>Math.max(...f.map(i=>points[i][k])))}));
  function tree(ids){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const i of ids)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],bounds[i].lo[k]);hi[k]=Math.max(hi[k],bounds[i].hi[k]);}const node={lo,hi};if(ids.length<=8){node.ids=ids;return node;}const axis=[0,1,2].sort((a,b)=>(hi[b]-lo[b])-(hi[a]-lo[a]))[0];ids.sort((a,b)=>(bounds[a].lo[axis]+bounds[a].hi[axis])-(bounds[b].lo[axis]+bounds[b].hi[axis]));const mid=Math.floor(ids.length/2);node.left=tree(ids.slice(0,mid));node.right=tree(ids.slice(mid));return node;}
  const overlap=(a,b)=>a.lo.every((v,k)=>v<=b.hi[k]+1e-10&&a.hi[k]>=b.lo[k]-1e-10),root=tree(faces.map((_,i)=>i)),pairs=[];let comparisons=0,count=0,complete=true;
  function visit(a,b){if(!complete||count>=20||!overlap(a,b))return;if(a===b){if(a.ids){for(let i=0;i<a.ids.length;i++)for(let j=i+1;j<a.ids.length;j++)pair(a.ids[i],a.ids[j]);}else{visit(a.left,a.left);visit(a.left,a.right);visit(a.right,a.right);}return;}
    if(a.ids&&b.ids){for(const i of a.ids)for(const j of b.ids)pair(i,j);}else if(a.ids){visit(a,b.left);visit(a,b.right);}else{visit(a.left,b);visit(a.right,b);}}
  function pair(i,j){if(!complete||count>=20||!overlap(bounds[i],bounds[j]))return;if(++comparisons>2000000){complete=false;return;}if(intersects(faces[i],faces[j],points)){count++;if(pairs.length<5)pairs.push([i,j]);}}
  visit(root,root);return {intersections:count,intersectionPairs:pairs,intersectionCheckComplete:complete&&count<20};
}
function repairMicroIntersections(faces,points,report){
  let diagnostic=intersectionCheck(faces,points);
  for(let pass=0;pass<8&&diagnostic.intersections&&diagnostic.intersectionCheckComplete;pass++){
    const edges=edgesOf(faces);if([...edges.values()].some(e=>e.length!==2))break;
    const adjacency=faces.map(()=>[]);for(const e of edges.values()){adjacency[e[0].i].push(e[1].i);adjacency[e[1].i].push(e[0].i);}
    const patch=new Set(diagnostic.intersectionPairs[0]);let accepted=false;
    for(let ring=0;ring<5;ring++){
      if(ring)for(const i of [...patch])for(const next of adjacency[i])patch.add(next);
      if(patch.size>160)break;const ids=new Set([...patch].flatMap(i=>faces[i])),lo=[0,1,2].map(k=>Math.min(...[...ids].map(i=>points[i][k]))),hi=[0,1,2].map(k=>Math.max(...[...ids].map(i=>points[i][k]))),diameter=Math.hypot(...sub(hi,lo));if(diameter>maxRepairPatchDiameter)break;
      const kept=faces.filter((_,i)=>!patch.has(i)),remainingEdges=edgesOf(kept),boundary=[...remainingEdges.values()].filter(e=>e.length===1).map(e=>e[0]);if(boundary.length<3||boundary.length>128)continue;
      const next=new Map();let valid=true;for(const e of boundary){if(next.has(e.a)){valid=false;break;}next.set(e.a,e.b);}if(!valid)continue;
      const loop=[],seen=new Set();let id=boundary[0].a;while(next.has(id)&&!seen.has(id)){seen.add(id);loop.push(id);id=next.get(id);}if(id!==loop[0]||loop.length!==boundary.length)continue;
      loop.reverse();let cap=triangulateLoop(loop,points,1e-6,true),addedPoint=false;
      if(!cap){const center=[0,1,2].map(k=>loop.reduce((sum,i)=>sum+points[i][k],0)/loop.length),index=points.length;points.push(center);addedPoint=true;cap=loop.map((id,i)=>[id,loop[(i+1)%loop.length],index]);}
      if(kept.length+cap.length>200000||cap.some(f=>Math.hypot(...cross(sub(points[f[1]],points[f[0]]),sub(points[f[2]],points[f[0]])))<1e-14)){if(addedPoint)points.pop();continue;}
      const candidate=kept.concat(cap);if([...edgesOf(candidate).values()].some(e=>e.length!==2)){if(addedPoint)points.pop();continue;}
      const check=intersectionCheck(candidate,points);if(!check.intersectionCheckComplete||check.intersections>=diagnostic.intersections){if(addedPoint)points.pop();continue;}
      faces.length=0;for(const f of candidate)faces.push(f);report.microPatchesRebuilt++;report.microPatchFacesRemoved+=patch.size;report.addedFaces+=cap.length;report.maxMicroPatchDiameter=Math.max(report.maxMicroPatchDiameter,diameter);diagnostic=check;accepted=true;break;
    }
    if(!accepted)break;
  }
  return diagnostic;
}
export function cleanMesh(input,options={}){
  if(!input||input.length%9||input.length<36||input.length>(options.internalRebuild?9000000:1800000))throw Error('Use a model containing 4–200,000 triangles.');
  const report={inputFaces:input.length/9,invalidFaces:0,degenerateFaces:0,duplicateFaces:0,weldedSeams:0,reorientedFaces:0,filledHoles:0,addedFaces:0,strayFacesRemoved:0,boundaryVerticesStitched:0,maxBoundaryMove:0,microPatchesRebuilt:0,microPatchFacesRemoved:0,maxMicroPatchDiameter:0},valid=[],lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<input.length;i+=9){let ok=true;for(let j=0;j<9;j++)if(!Number.isFinite(input[i+j])||Math.abs(input[i+j])>1e12)ok=false;if(!ok){report.invalidFaces++;continue;}
    const a=[input[i],input[i+1],input[i+2]],b=[input[i+3],input[i+4],input[i+5]],c=[input[i+6],input[i+7],input[i+8]],u=sub(b,a),v=sub(c,a);if(Math.hypot(...cross(u,v))<=Math.max(dot(u,u),dot(v,v))*1e-14){report.degenerateFaces++;continue;}
    valid.push(i);for(let j=0;j<9;j++){const k=j%3;lo[k]=Math.min(lo[k],input[i+j]);hi[k]=Math.max(hi[k],input[i+j]);}}
  const scale=Math.max(...sub(hi,lo)),center=lo.map((v,k)=>(v+hi[k])/2);if(!Number.isFinite(scale)||scale<1e-9)throw Error('No usable 3D geometry remains after cleanup.');
  const tolerance=options.weldTolerance??1e-6,points=[],buckets=new Map(),faces=[],duplicates=new Set();
  if(!Number.isFinite(tolerance)||tolerance<1e-8||tolerance>1e-5)throw Error('Invalid weld tolerance.');
  function vertex(offset){const p=[0,1,2].map(k=>(input[offset+k]-center[k])/scale),cell=p.map(v=>Math.floor(v/tolerance));let found=-1;
    search:for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){const bucket=buckets.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','));if(bucket)for(const i of bucket)if(Math.hypot(...sub(points[i],p))<=tolerance){found=i;break search;}}
    if(found>=0){if(Math.hypot(...sub(points[found],p))>1e-10)report.weldedSeams++;return found;}const i=points.length;points.push(p);const key=cell.join(',');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);return i;
  }
  for(const i of valid){const f=[vertex(i),vertex(i+3),vertex(i+6)];if(new Set(f).size<3||Math.hypot(...cross(sub(points[f[1]],points[f[0]]),sub(points[f[2]],points[f[0]])))<1e-14){report.degenerateFaces++;continue;}const key=[...f].sort((a,b)=>a-b).join(',');if(duplicates.has(key)){report.duplicateFaces++;continue;}duplicates.add(key);faces.push(f);}
  if(faces.length<4)throw Error('Too few usable faces remain after cleanup.');
  repairTinyTopology(faces,points,report);
  const winding=faces.map(f=>f[1]);orientFaces(faces,points,report);fillHoles(faces,points,report,tolerance);orientFaces(faces,points,report);
  report.reorientedFaces=faces.reduce((count,f,i)=>count+(i<winding.length&&f[1]!==winding[i]?1:0),0);
  const diagnostic=repairMicroIntersections(faces,points,report),components=orientFaces(faces,points,{reorientedFaces:0}),edges=edgesOf(faces);
  report.boundaryEdges=0;report.nonManifoldEdges=0;for(const e of edges.values()){if(e.length===1)report.boundaryEdges++;if(e.length>2)report.nonManifoldEdges++;}
  const vertexComponents=new Map();components.forEach((group,index)=>{for(const i of group)for(const v of faces[i]){if(!vertexComponents.has(v))vertexComponents.set(v,new Set());vertexComponents.get(v).add(index);}});
  report.nonManifoldVertices=[...vertexComponents.values()].filter(v=>v.size>1).length;report.components=components.length;Object.assign(report,diagnostic);
  report.outputFaces=faces.length;report.weldTolerance=tolerance*scale;report.maxHoleDiameter=.02*scale;report.maxBoundaryMove*=scale;report.maxMicroPatchDiameter*=scale;
  report.ready=!(report.boundaryEdges||report.nonManifoldEdges||report.nonManifoldVertices||report.orientationConflicts||report.intersections||!report.intersectionCheckComplete);
  report.changed=!!(report.invalidFaces+report.degenerateFaces+report.duplicateFaces+report.weldedSeams+report.reorientedFaces+report.filledHoles+report.strayFacesRemoved+report.boundaryVerticesStitched+report.microPatchesRebuilt);
  const vertices=new Float32Array(faces.length*9);let offset=0;for(const f of faces)for(const i of f)for(let k=0;k<3;k++)vertices[offset++]=points[i][k]*scale+center[k];
  return {vertices,report};
}
export function asciiSTL(vertices,scale=1){
  if(!Number.isFinite(scale)||scale<=0)throw Error('Choose a positive model size before export.');const lines=['solid AeroDesk_cleaned_meters'];
  for(let i=0;i<vertices.length;i+=9){const a=Array.from(vertices.slice(i,i+3)),b=Array.from(vertices.slice(i+3,i+6)),c=Array.from(vertices.slice(i+6,i+9)),n=cross(sub(b,a),sub(c,a)),m=Math.hypot(...n);lines.push('facet normal '+n.map(v=>m?(v/m).toPrecision(9):'0').join(' '),'outer loop');for(const p of [a,b,c])lines.push('vertex '+p.map(v=>(v*scale).toPrecision(9)).join(' '));lines.push('endloop','endfacet');}
  lines.push('endsolid AeroDesk_cleaned_meters');return lines.join('\n');
}

