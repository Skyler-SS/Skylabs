import {cleanMesh} from './clean-mesh.mjs';
import {isoSurfaceMesh} from './volume-view.mjs';
// Deliberate geometry approximation, exposed separately from conservative repair.
export async function rebuildExterior(vertices,loadManifold,resolution=384){
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<vertices.length;i++){lo[i%3]=Math.min(lo[i%3],vertices[i]);hi[i%3]=Math.max(hi[i%3],vertices[i]);}
 const axes=[0,1,2].sort((a,b)=>(hi[b]-lo[b])-(hi[a]-lo[a])),inversions=axes.reduce((s,a,i)=>s+axes.slice(i+1).filter(b=>b<a).length,0),sign=[1,inversions%2?-1:1,1],aligned=new Float32Array(vertices.length);
 for(let i=0;i<vertices.length;i+=3)for(let k=0;k<3;k++)aligned[i+k]=vertices[i+axes[k]]*sign[k];
 const result=await buildAligned(aligned,loadManifold,resolution),out=new Float32Array(result.vertices.length);for(let i=0;i<out.length;i+=3)for(let k=0;k<3;k++)out[i+axes[k]]=result.vertices[i+k]*sign[k];return {...result,vertices:out};
}
async function buildAligned(vertices,loadManifold,resolution){
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<vertices.length;i++){lo[i%3]=Math.min(lo[i%3],vertices[i]);hi[i%3]=Math.max(hi[i%3],vertices[i]);}
 const length=Math.max(...hi.map((v,k)=>v-lo[k])),h=length/resolution,origin=lo.map(v=>v-3*h),dims=hi.map((v,k)=>Math.ceil((v-lo[k])/h)+7),[nx,ny,nz]=dims;
 if(!Number.isFinite(h)||h<=0||nx*ny*nz>90000000)throw Error('Model is too large for exterior rebuilding.');
 const rows=Array.from({length:ny*nz},()=>[]);
 for(let t=0;t<vertices.length;t+=9){const a=Array.from(vertices.subarray(t,t+3)),b=Array.from(vertices.subarray(t+3,t+6)),c=Array.from(vertices.subarray(t+6,t+9)),det=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);if(Math.abs(det)<length*length*1e-14)continue;
  const y0=Math.max(0,Math.ceil((Math.min(a[1],b[1],c[1])-origin[1])/h)),y1=Math.min(ny-1,Math.floor((Math.max(a[1],b[1],c[1])-origin[1])/h)),z0=Math.max(0,Math.ceil((Math.min(a[2],b[2],c[2])-origin[2])/h)),z1=Math.min(nz-1,Math.floor((Math.max(a[2],b[2],c[2])-origin[2])/h));
  for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++){const py=origin[1]+y*h+h*1e-5,pz=origin[2]+z*h+h*2e-5,u=((py-a[1])*(c[2]-a[2])-(pz-a[2])*(c[1]-a[1]))/det,v=((b[1]-a[1])*(pz-a[2])-(b[2]-a[2])*(py-a[1]))/det;if(u>=0&&v>=0&&u+v<=1)rows[y+ny*z].push([a[0]+u*(b[0]-a[0])+v*(c[0]-a[0]),Math.sign(det)]);}
 }
 let field=new Float32Array(nx*ny*nz);let bad=0,occupied=0,active=0;
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){const hits=rows[y+ny*z];if(!hits.length)continue;active++;hits.sort((a,b)=>a[0]-b[0]);if(hits.reduce((s,p)=>s+p[1],0)!==0){bad++;continue;}let winding=0,p=0;for(let x=0;x<nx;x++){while(p<hits.length&&hits[p][0]<=origin[0]+x*h)winding+=hits[p++][1];if(winding){field[x+nx*(y+ny*z)]=1;occupied++;}}}
 if(bad>Math.max(2,active*.005))throw Error('Too many open surface columns to rebuild reliably. Close the large openings in CAD first.');if(occupied<20)throw Error('No resolved solid volume. Thin surfaces need a closed CAD solid.');
 // Smooth sub-cell stair steps and edge-only contacts before reconstructing.
 for(const stride of [1,nx,nx*ny]){const next=new Float32Array(field.length);for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){const i=x+nx*(y+ny*z);next[i]=(field[i-stride]+2*field[i]+field[i+stride])*.25;}field=next;}
 const values=Float32Array.from(field,v=>-v),mesh=isoSurfaceMesh({nx,ny,nz,h,origin:origin.map(v=>v-h*.5)},values,new Uint8Array(field.length),-.467);
 let verticesOut=mesh.positions; verticesOut=smoothMesh(verticesOut,h); if(verticesOut.length>1800000){const checked=cleanMesh(verticesOut,{internalRebuild:true,weldTolerance:1e-7});if(checked.report.boundaryEdges||checked.report.nonManifoldEdges||checked.report.nonManifoldVertices||checked.report.orientationConflicts||checked.report.intersections)throw Error("Reconstructed surface failed topology checks; original model retained.");verticesOut=checked.vertices;}
 if(verticesOut.length>1800000){const {Manifold,Mesh}=await loadManifold(),points=[],ids=[],seen=new Map();for(let i=0;i<verticesOut.length;i+=3){const p=Array.from(verticesOut.subarray(i,i+3)),key=p.join(',');if(!seen.has(key)){seen.set(key,points.length/3);points.push(...p);}ids.push(seen.get(key));}let solid,simple;try{solid=new Manifold(new Mesh({numProp:3,vertProperties:new Float32Array(points),triVerts:new Uint32Array(ids)}));simple=solid.simplify(h*.05);const m=simple.getMesh();verticesOut=new Float32Array(m.triVerts.length*3);m.triVerts.forEach((id,i)=>verticesOut.set(m.vertProperties.subarray(id*m.numProp,id*m.numProp+3),i*3));}finally{simple?.delete();solid?.delete();}}
 if(verticesOut.length>1800000)throw Error('Rebuilt surface exceeds 200,000 triangles. Simplify the CAD first.');verticesOut=smoothMesh(verticesOut,h);return {vertices:verticesOut,spacing:h,skippedColumns:bad,resolution};
}





function smoothMesh(verticesOut,h){ const nodes=[],indices=[],lookup=new Map();for(let i=0;i<verticesOut.length;i+=3){const p=Array.from(verticesOut.subarray(i,i+3)),key=p.join(',');if(!lookup.has(key)){lookup.set(key,nodes.length);nodes.push(p);}indices.push(lookup.get(key));}const neighbors=nodes.map(()=>new Set());for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){const a=indices[i+j],b=indices[i+(j+1)%3];neighbors[a].add(b);neighbors[b].add(a);}let points=nodes.map(p=>p.slice());for(let pass=0;pass<3;pass++)points=points.map((p,i)=>{const mean=[0,0,0];for(const j of neighbors[i])for(let k=0;k<3;k++)mean[k]+=points[j][k]/neighbors[i].size;const candidate=p.map((v,k)=>v+.15*(mean[k]-v)),d=candidate.map((v,k)=>v-nodes[i][k]),n=Math.hypot(...d),scale=Math.min(1,h*.15/(n||1));return nodes[i].map((v,k)=>v+d[k]*scale);});verticesOut=new Float32Array(indices.flatMap(i=>points[i]));return verticesOut;}
