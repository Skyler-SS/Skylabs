import {cleanMesh} from './clean-mesh.mjs';
import {isoSurfaceMesh} from './volume-view.mjs';

// Deliberate geometry approximation, exposed separately from conservative repair.
//
// Two field-construction methods share one reconstruction tail:
//
//  parity — one ray per (y,z) column, summing triangle winding signs. Tight and exact,
//           but it REQUIRES a closed, consistently wound surface. A single screw hole is
//           a tunnel that unbalances every column through it, so real CAD exports with
//           fastener holes or loose shells fail outright.
//  wrap   — voxelize the surface as an obstacle, dilate by the seal radius, flood-fill
//           the exterior, erode back. Morphological closing. Needs no watertightness, no
//           consistent winding and no manifold topology: only that triangles block voxel
//           connectivity. Openings narrower than twice the seal radius are sealed flush.
//
// Wrap changes the shape, so every run reports what it sealed.
export const DEFAULT_RESOLUTION=384;
export const SEAL_PRESETS={light:.0025,standard:.005,aggressive:.01};
export const DEFAULT_SEAL_FRACTION=SEAL_PRESETS.standard;
export const SEAL_WARN_FRACTION=.02;
const MIN_RESOLUTION=32,MAX_RESOLUTION=640,MAX_PARITY_CELLS=90000000,MAX_WRAP_CELLS=24000000;
const MIN_SEAL_CELLS=1,MAX_SEAL_CELLS=16,BIG=1e12,OUTPUT_TRIANGLE_BUDGET=180000;

// Accepts a bare resolution number for the original positional call signature.
export function wrapSettings(input){
 const o=typeof input==='number'?{resolution:input}:(input||{});
 const mode=o.mode??'auto';
 if(!['auto','parity','wrap'].includes(mode))throw Error('Unknown exterior rebuild mode.');
 const resolution=o.resolution??DEFAULT_RESOLUTION;
 if(!Number.isFinite(resolution)||resolution<MIN_RESOLUTION||resolution>MAX_RESOLUTION)throw Error('Rebuild detail must be between '+MIN_RESOLUTION+' and '+MAX_RESOLUTION+' cells across the model.');
 const sealFraction=o.sealFraction??DEFAULT_SEAL_FRACTION;
 if(!Number.isFinite(sealFraction)||sealFraction<=0||sealFraction>.1)throw Error('Seal size must be between 0 and 10% of the longest dimension.');
 return {mode,resolution:Math.round(resolution),sealFraction};
}

export async function rebuildExterior(vertices,loadManifold,options){
 const settings=wrapSettings(options);
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<vertices.length;i++){lo[i%3]=Math.min(lo[i%3],vertices[i]);hi[i%3]=Math.max(hi[i%3],vertices[i]);}
 const axes=[0,1,2].sort((a,b)=>(hi[b]-lo[b])-(hi[a]-lo[a])),inversions=axes.reduce((s,a,i)=>s+axes.slice(i+1).filter(b=>b<a).length,0),sign=[1,inversions%2?-1:1,1],aligned=new Float32Array(vertices.length);
 for(let i=0;i<vertices.length;i+=3)for(let k=0;k<3;k++)aligned[i+k]=vertices[i+axes[k]]*sign[k];
 const result=await buildAligned(aligned,loadManifold,settings),out=new Float32Array(result.vertices.length);for(let i=0;i<out.length;i+=3)for(let k=0;k<3;k++)out[i+axes[k]]=result.vertices[i+k]*sign[k];return {...result,vertices:out};
}

function gridFor(lo,hi,resolution,pad){
 const length=Math.max(...hi.map((v,k)=>v-lo[k])),h=length/resolution;
 if(!Number.isFinite(h)||h<=0)throw Error('Model is too large for exterior rebuilding.');
 const origin=lo.map(v=>v-pad*h),dims=hi.map((v,k)=>Math.ceil((v-lo[k])/h)+2*pad+1);
 return {length,h,origin,nx:dims[0],ny:dims[1],nz:dims[2],cells:dims[0]*dims[1]*dims[2]};
}
// Reduce detail rather than failing when a grid would not fit in memory.
function fitGrid(lo,hi,settings,wrap){
 let resolution=settings.resolution;
 for(let attempt=0;attempt<12;attempt++){
  const seal=wrap?Math.min(MAX_SEAL_CELLS,Math.max(MIN_SEAL_CELLS,settings.sealFraction*resolution)):0;
  const grid=gridFor(lo,hi,resolution,3+Math.ceil(seal)),cap=wrap?MAX_WRAP_CELLS:MAX_PARITY_CELLS;
  if(grid.cells<=cap)return {...grid,resolution,seal,reducedDetail:resolution<settings.resolution?settings.resolution:null};
  if(resolution<=MIN_RESOLUTION)throw Error('Model is too large for exterior rebuilding at the minimum detail.');
  resolution=Math.max(MIN_RESOLUTION,Math.floor(resolution*Math.cbrt(cap/grid.cells)*.98));
 }
 throw Error('Could not fit an exterior rebuild grid for this model.');
}

// --- parity: exact, requires a closed consistently wound surface ----------------------
function parityField(vertices,grid){
 const {nx,ny,nz,h,origin,length}=grid,rows=Array.from({length:ny*nz},()=>[]);
 for(let t=0;t<vertices.length;t+=9){const a=Array.from(vertices.subarray(t,t+3)),b=Array.from(vertices.subarray(t+3,t+6)),c=Array.from(vertices.subarray(t+6,t+9)),det=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);if(Math.abs(det)<length*length*1e-14)continue;
  const y0=Math.max(0,Math.ceil((Math.min(a[1],b[1],c[1])-origin[1])/h)),y1=Math.min(ny-1,Math.floor((Math.max(a[1],b[1],c[1])-origin[1])/h)),z0=Math.max(0,Math.ceil((Math.min(a[2],b[2],c[2])-origin[2])/h)),z1=Math.min(nz-1,Math.floor((Math.max(a[2],b[2],c[2])-origin[2])/h));
  for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++){const py=origin[1]+y*h+h*1e-5,pz=origin[2]+z*h+h*2e-5,u=((py-a[1])*(c[2]-a[2])-(pz-a[2])*(c[1]-a[1]))/det,v=((b[1]-a[1])*(pz-a[2])-(b[2]-a[2])*(py-a[1]))/det;if(u>=0&&v>=0&&u+v<=1)rows[y+ny*z].push([a[0]+u*(b[0]-a[0])+v*(c[0]-a[0]),Math.sign(det)]);}
 }
 const field=new Float32Array(nx*ny*nz);let bad=0,occupied=0,active=0;
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){const hits=rows[y+ny*z];if(!hits.length)continue;active++;hits.sort((a,b)=>a[0]-b[0]);if(hits.reduce((s,p)=>s+p[1],0)!==0){bad++;continue;}let winding=0,p=0;for(let x=0;x<nx;x++){while(p<hits.length&&hits[p][0]<=origin[0]+x*h)winding+=hits[p++][1];if(winding){field[x+nx*(y+ny*z)]=1;occupied++;}}}
 return {field,bad,active,occupied};
}

// --- wrap: tolerant of holes, open shells and part soup -------------------------------
// Conservative dominant-axis scan conversion. The dominant axis is the one the triangle
// faces most directly, which bounds the surface slope along the other two axes at 1 cell
// per cell; spanning that slope makes the shell block every 6-connected path through it.
export function shellField(vertices,grid){
 const {nx,ny,nz,h,origin}=grid,dims=[nx,ny,nz],strides=[1,nx,nx*ny],shell=new Uint8Array(nx*ny*nz);
 const A=[0,0,0],U=[0,0,0],V=[0,0,0];let marked=0;
 for(let t=0;t<vertices.length;t+=9){
  for(let k=0;k<3;k++){A[k]=vertices[t+k];U[k]=vertices[t+3+k]-A[k];V[k]=vertices[t+6+k]-A[k];}
  const n=[U[1]*V[2]-U[2]*V[1],U[2]*V[0]-U[0]*V[2],U[0]*V[1]-U[1]*V[0]];
  let a=0;if(Math.abs(n[1])>Math.abs(n[a]))a=1;if(Math.abs(n[2])>Math.abs(n[a]))a=2;
  const det=n[a];if(!(Math.abs(det)>0))continue;
  const b=(a+1)%3,c=(a+2)%3,sa=strides[a];
  // Half-span in cells covering the triangle's rise between adjacent samples.
  const span=.5*(Math.abs(n[b])+Math.abs(n[c]))/Math.abs(det)+.5;
  const lob=Math.min(A[b],A[b]+U[b],A[b]+V[b]),hib=Math.max(A[b],A[b]+U[b],A[b]+V[b]);
  const loc=Math.min(A[c],A[c]+U[c],A[c]+V[c]),hic=Math.max(A[c],A[c]+U[c],A[c]+V[c]);
  const j0=Math.max(0,Math.ceil((lob-origin[b])/h)),j1=Math.min(dims[b]-1,Math.floor((hib-origin[b])/h));
  const k0=Math.max(0,Math.ceil((loc-origin[c])/h)),k1=Math.min(dims[c]-1,Math.floor((hic-origin[c])/h));
  for(let kk=k0;kk<=k1;kk++){
   const pc=origin[c]+kk*h+h*2e-5;
   for(let jj=j0;jj<=j1;jj++){
    const pb=origin[b]+jj*h+h*1e-5;
    const u=((pb-A[b])*V[c]-(pc-A[c])*V[b])/det,v=(U[b]*(pc-A[c])-U[c]*(pb-A[b]))/det;
    if(u<0||v<0||u+v>1)continue;
    const pa=A[a]+u*U[a]+v*V[a],centre=(pa-origin[a])/h;
    const i0=Math.max(0,Math.ceil(centre-span)),i1=Math.min(dims[a]-1,Math.floor(centre+span));
    const base=jj*strides[b]+kk*strides[c];
    for(let ii=i0;ii<=i1;ii++){const index=base+ii*sa;if(!shell[index]){shell[index]=1;marked++;}}
   }
  }
 }
 return {shell,marked};
}

// Felzenszwalb & Huttenlocher separable exact squared Euclidean distance transform.
// Distances come back in cell units squared.
function edt1D(f,n,out,v,z){
 // z[0] is -BIG and every s stays above it, so k never falls below zero.
 let k=0;v[0]=0;z[0]=-BIG;z[1]=BIG;
 for(let q=1;q<n;q++){
  let s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);
  while(s<=z[k]){k--;s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);}
  k++;v[k]=q;z[k]=s;z[k+1]=BIG;
 }
 k=0;
 for(let q=0;q<n;q++){while(z[k+1]<q)k++;const d=q-v[k];out[q]=d*d+f[v[k]];}
}
export function distanceTransform(mask,nx,ny,nz){
 const n=nx*ny*nz,d=new Float32Array(n);
 for(let i=0;i<n;i++)d[i]=mask[i]?0:BIG;
 const longest=Math.max(nx,ny,nz),f=new Float64Array(longest),out=new Float64Array(longest),v=new Int32Array(longest),z=new Float64Array(longest+1);
 for(const [count,stride] of [[nx,1],[ny,nx],[nz,nx*ny]]){
  if(count<2)continue;
  const total=n/count;
  for(let line=0;line<total;line++){
   // Walk every line along this axis without materializing index tables.
   const base=stride===1?line*nx:stride===nx?(line%nx)+Math.floor(line/nx)*nx*ny:line;
   for(let q=0;q<count;q++)f[q]=d[base+q*stride];
   edt1D(f,count,out,v,z);
   for(let q=0;q<count;q++)d[base+q*stride]=out[q];
  }
 }
 return d;
}
// Iterative 6-connected fill from the padded boundary. Never recursive: these grids
// reach tens of millions of cells.
export function floodExterior(blocked,nx,ny,nz){
 const n=nx*ny*nz,outside=new Uint8Array(n),queue=new Int32Array(n),ny_nx=nx*ny;
 let head=0,tail=0;
 const push=i=>{if(!blocked[i]&&!outside[i]){outside[i]=1;queue[tail++]=i;}};
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){
  const edge=z===0||z===nz-1||y===0||y===ny-1,base=nx*(y+ny*z);
  if(edge){for(let x=0;x<nx;x++)push(base+x);}else{push(base);push(base+nx-1);}
 }
 while(head<tail){
  const i=queue[head++],x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/ny_nx);
  if(x>0)push(i-1);if(x<nx-1)push(i+1);
  if(y>0)push(i-nx);if(y<ny-1)push(i+nx);
  if(z>0)push(i-ny_nx);if(z<nz-1)push(i+ny_nx);
 }
 return outside;
}
// Which parts of the rebuilt surface are NOT backed by input geometry: those are the
// membranes that sealed an opening. Measured against the input shell's own distance
// field, so it needs no ground truth about what the model "should" have been.
const SEAL_PATCH_LIMIT=2.25;  // squared cells: 1.5 cells clear of any input triangle
function sealedPatches(verticesOut,grid,shellDistance){
 const {nx,ny,nz,h,origin}=grid,n=nx*ny*nz,over=new Uint8Array(n);
 let area=0;
 for(let t=0;t<verticesOut.length;t+=9){
  const cx=(verticesOut[t]+verticesOut[t+3]+verticesOut[t+6])/3,cy=(verticesOut[t+1]+verticesOut[t+4]+verticesOut[t+7])/3,cz=(verticesOut[t+2]+verticesOut[t+5]+verticesOut[t+8])/3;
  const x=Math.round((cx-origin[0])/h),y=Math.round((cy-origin[1])/h),z=Math.round((cz-origin[2])/h);
  if(x<0||y<0||z<0||x>=nx||y>=ny||z>=nz)continue;
  const i=x+nx*(y+ny*z);
  if(shellDistance[i]<=SEAL_PATCH_LIMIT)continue;
  over[i]=1;
  const ux=verticesOut[t+3]-verticesOut[t],uy=verticesOut[t+4]-verticesOut[t+1],uz=verticesOut[t+5]-verticesOut[t+2];
  const vx=verticesOut[t+6]-verticesOut[t],vy=verticesOut[t+7]-verticesOut[t+1],vz=verticesOut[t+8]-verticesOut[t+2];
  area+=.5*Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx);
 }
 const seen=new Uint8Array(n),ny_nx=nx*ny,stack=[];let count=0,largest=0;
 for(let start=0;start<n;start++){
  if(seen[start]||!over[start])continue;
  const lo=[nx,ny,nz],hi=[-1,-1,-1];seen[start]=1;stack.push(start);
  while(stack.length){
   const i=stack.pop(),x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/ny_nx);
   if(x<lo[0])lo[0]=x;if(x>hi[0])hi[0]=x;if(y<lo[1])lo[1]=y;if(y>hi[1])hi[1]=y;if(z<lo[2])lo[2]=z;if(z>hi[2])hi[2]=z;
   // 26-connected: a membrane's centroid voxels need not be face-adjacent.
   for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const a=x+dx,b=y+dy,c=z+dz;if(a<0||b<0||c<0||a>=nx||b>=ny||c>=nz)continue;
    const j=a+nx*(b+ny*c);if(!seen[j]&&over[j]){seen[j]=1;stack.push(j);}
   }
  }
  count++;largest=Math.max(largest,Math.hypot(hi[0]-lo[0]+1,hi[1]-lo[1]+1,hi[2]-lo[2]+1));
 }
 return {count,area,largestSpanCells:largest};
}
function wrapField(vertices,grid){
 const {nx,ny,nz,seal}=grid,n=nx*ny*nz;
 const {shell,marked}=shellField(vertices,grid);
 if(marked<8)throw Error('No surface was found to wrap. The model contains too little triangle area.');
 const shellDistance=distanceTransform(shell,nx,ny,nz);
 const sealSq=seal*seal,blocked=new Uint8Array(n);
 for(let i=0;i<n;i++)if(shellDistance[i]<=sealSq)blocked[i]=1;
 // Everything the dilated shell hides from the outside is the closed solid.
 const outside=floodExterior(blocked,nx,ny,nz);
 // Erode by the same radius: dilate-then-erode is morphological closing, so the original
 // surface is restored wherever it was already open at this radius.
 const toOutside=distanceTransform(outside,nx,ny,nz);
 const field=new Float32Array(n);
 let occupied=0,deepest=0;
 for(let i=0;i<n;i++){if(toOutside[i]>sealSq){field[i]=1;occupied++;}if(toOutside[i]>deepest)deepest=toOutside[i];}
 // An open bowl also survives erosion, but only as a membrane one cell thick. A genuine
 // body is deeper than the seal radius plus the membrane it would leave behind, so depth
 // is what separates "sealed a hole" from "wrapped a sheet".
 if(occupied<20||deepest<=(seal+1.5)**2)throw Error('Wrapping found only a thin membrane rather than an enclosed body: the openings are wider than the seal size. Increase the seal size, or close the large openings in CAD.');
 return {field,occupied,shellDistance};
}


function buildField(vertices,lo,hi,settings,resolution){
 const probe={...settings,resolution};
 let method=settings.mode==='wrap'?'wrap':'parity',parityError=null,grid=fitGrid(lo,hi,probe,method==='wrap');
 let field,shellDistance=null,skippedColumns=0;
 if(method==='parity'){
  const parity=parityField(vertices,grid);
  const tolerance=Math.max(2,parity.active*.005);
  if(parity.bad>tolerance)parityError='Open or inconsistently wound surface: '+parity.bad+' of '+parity.active+' ray columns could not be resolved.';
  else if(parity.occupied<20)parityError='No resolved solid volume.';
  if(parityError){
   // The whole point of wrap mode: a model parity cannot handle is the normal case for
   // real CAD, so fall back instead of dead-ending.
   if(settings.mode==='parity')throw Error('Too many open surface columns to rebuild reliably. Close the large openings in CAD first, or turn on Seal openings.');
   method='wrap';grid=fitGrid(lo,hi,probe,true);
  }else{field=parity.field;skippedColumns=parity.bad;}
 }
 if(method==='wrap'){const wrapped=wrapField(vertices,grid);field=wrapped.field;shellDistance=wrapped.shellDistance;}
 return {grid,field,method,parityError,skippedColumns,shellDistance};
}
function extractSurface(grid,field){
 const {nx,ny,nz,h,origin}=grid;
 // Smooth sub-cell stair steps and edge-only contacts before reconstructing.
 for(const stride of [1,nx,nx*ny]){const next=new Float32Array(field.length);for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){const i=x+nx*(y+ny*z);next[i]=(field[i-stride]+2*field[i]+field[i+stride])*.25;}field=next;}
 const values=Float32Array.from(field,v=>-v);
 return isoSurfaceMesh({nx,ny,nz,h,origin:origin.map(v=>v-h*.5)},values,new Uint8Array(field.length),-.467).positions;
}

async function buildAligned(vertices,loadManifold,settings){
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<vertices.length;i++){lo[i%3]=Math.min(lo[i%3],vertices[i]);hi[i%3]=Math.max(hi[i%3],vertices[i]);}
 // Marching tetrahedra over a detailed field easily yields millions of triangles, which
 // every stage below rejects. Reducing the field resolution is the only reduction that
 // keeps the result watertight: mesh decimation welds vertices and tears the surface
 // open, which is exactly what a rebuilt exterior must never do.
 // Bracket toward the budget rather than stepping down once: the coarsest grid that fits
 // wastes fidelity, and detail here is the whole point of the rebuild.
 let resolution=settings.resolution,fit=null,tooFine=null,last=null;
 for(let attempt=0;attempt<4;attempt++){
  const built=buildField(vertices,lo,hi,settings,resolution);
  const surface=extractSurface(built.grid,built.field);
  built.field=null;
  const actual=built.grid.resolution,count=surface.length/9;
  last={built,surface};
  if(count<=OUTPUT_TRIANGLE_BUDGET){
   if(!fit||actual>fit.built.grid.resolution)fit={built,surface};
   // Close enough to the ceiling that a finer grid would not fit anyway.
   if(count>=OUTPUT_TRIANGLE_BUDGET*.75||actual>=settings.resolution)break;
   if(tooFine!==null&&tooFine-actual<=2)break;
   resolution=tooFine===null?Math.min(settings.resolution,Math.ceil(actual*1.3)):Math.floor((actual+tooFine)/2);
   if(resolution<=actual)break;
  }else{
   tooFine=actual;
   // Triangle count tracks surface area over cell area, so roughly resolution squared.
   const estimate=Math.floor(actual*Math.sqrt(OUTPUT_TRIANGLE_BUDGET/count));
   resolution=fit?Math.floor((fit.built.grid.resolution+actual)/2):estimate;
   if(resolution>=actual)resolution=actual-1;
   resolution=Math.max(MIN_RESOLUTION,resolution);
   if(actual<=MIN_RESOLUTION||fit&&resolution<=fit.built.grid.resolution)break;
  }
 }
 const chosen=fit||last;
 const {grid,method,parityError,skippedColumns,shellDistance}=chosen.built,{h}=grid;
 const surface=chosen.surface;
 let verticesOut=smoothMesh(surface,h);
 if(verticesOut.length>1800000){const checked=cleanMesh(verticesOut,{internalRebuild:true,weldTolerance:1e-7});if(checked.report.boundaryEdges||checked.report.nonManifoldEdges||checked.report.nonManifoldVertices||checked.report.orientationConflicts||checked.report.intersections)throw Error("Reconstructed surface failed topology checks; original model retained.");verticesOut=checked.vertices;}
 if(verticesOut.length>1800000){const {Manifold,Mesh}=await loadManifold(),points=[],ids=[],seen=new Map();for(let i=0;i<verticesOut.length;i+=3){const p=Array.from(verticesOut.subarray(i,i+3)),key=p.join(',');if(!seen.has(key)){seen.set(key,points.length/3);points.push(...p);}ids.push(seen.get(key));}let solid,simple;try{solid=new Manifold(new Mesh({numProp:3,vertProperties:new Float32Array(points),triVerts:new Uint32Array(ids)}));simple=solid.simplify(h*.05);const m=simple.getMesh();verticesOut=new Float32Array(m.triVerts.length*3);m.triVerts.forEach((id,i)=>verticesOut.set(m.vertProperties.subarray(id*m.numProp,id*m.numProp+3),i*3));}finally{simple?.delete();solid?.delete();}}
 if(verticesOut.length>1800000)throw Error('Rebuilt surface exceeds 200,000 triangles. Simplify the CAD first.');verticesOut=smoothMesh(verticesOut,h);
 const stats=shellDistance?sealedPatches(verticesOut,grid,shellDistance):null;
 return {vertices:verticesOut,spacing:h,skippedColumns,resolution:grid.resolution,requestedResolution:settings.resolution,
  reducedDetail:grid.resolution<settings.resolution?settings.resolution:null,
  method,automaticWrap:method==='wrap'&&settings.mode!=='wrap',parityError,
  sealCells:method==='wrap'?grid.seal:0,sealFraction:method==='wrap'?grid.seal/grid.resolution:0,
  sealedOpenings:stats?stats.count:0,sealedSpan:stats?stats.largestSpanCells*h:0,sealedArea:stats?stats.area:0};
}

function smoothMesh(verticesOut,h){ const nodes=[],indices=[],lookup=new Map();for(let i=0;i<verticesOut.length;i+=3){const p=Array.from(verticesOut.subarray(i,i+3)),key=p.join(',');if(!lookup.has(key)){lookup.set(key,nodes.length);nodes.push(p);}indices.push(lookup.get(key));}const neighbors=nodes.map(()=>new Set());for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){const a=indices[i+j],b=indices[i+(j+1)%3];neighbors[a].add(b);neighbors[b].add(a);}let points=nodes.map(p=>p.slice());for(let pass=0;pass<3;pass++)points=points.map((p,i)=>{const mean=[0,0,0];for(const j of neighbors[i])for(let k=0;k<3;k++)mean[k]+=points[j][k]/neighbors[i].size;const candidate=p.map((v,k)=>v+.15*(mean[k]-v)),d=candidate.map((v,k)=>v-nodes[i][k]),n=Math.hypot(...d),scale=Math.min(1,h*.15/(n||1));return nodes[i].map((v,k)=>v+d[k]*scale);});verticesOut=new Float32Array(indices.flatMap(i=>points[i]));return verticesOut;}
