// Linear marching tetrahedra on the display grid, not the native finite-volume mesh.
// Cells touching solid/missing samples are deliberately omitted.
export function isoSurface(grid,values,solid,threshold){
  return isoSurfaceMesh(grid,values,solid,threshold).positions;
}
export function isoSurfaceMesh(grid,values,solid,threshold){
  if(!Number.isFinite(threshold))throw Error('Enter a finite isosurface value.');
  const positions=[],normals=[],{nx,ny,nz,h,origin}=grid,ids=[0,1,nx+1,nx,nx*ny,nx*ny+1,nx*ny+nx+1,nx*ny+nx],corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],tets=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
  const dims=[nx,ny,nz],strides=[1,nx,nx*ny],gradients=new Map();
  const gradient=(i,xyz)=>{
    if(gradients.has(i))return gradients.get(i);
    const n=strides.map((stride,a)=>{const lo=i-stride,hi=i+stride,hasLo=xyz[a]>0&&!solid[lo]&&Number.isFinite(values[lo]),hasHi=xyz[a]<dims[a]-1&&!solid[hi]&&Number.isFinite(values[hi]);return hasLo&&hasHi?(values[hi]-values[lo])/(2*h):hasHi?(values[hi]-values[i])/h:hasLo?(values[i]-values[lo])/h:0;});
    gradients.set(i,n);return n;
  };
  // Smooth scalar-gradient normals preserve threshold positions and consistent winding.
  const triangle=(a,b,c)=>{
    const u=b.p.map((v,k)=>v-a.p[k]),v=c.p.map((v,k)=>v-a.p[k]),face=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...face);
    if(length<h*h*1e-12)return;
    if(face.reduce((s,v,k)=>s+v*(a.n[k]+b.n[k]+c.n[k]),0)<0){[b,c]=[c,b];for(let k=0;k<3;k++)face[k]*=-1;}
    for(const vertex of [a,b,c]){positions.push(...vertex.p);const l=Math.hypot(...vertex.n);normals.push(...(l>1e-20?vertex.n.map(v=>v/l):face.map(v=>v/length)));}
  };
  for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
    const base=x+nx*(y+ny*z),v=ids.map(i=>values[base+i]);if(ids.some((i,k)=>solid[base+i]||!Number.isFinite(v[k]))||Math.min(...v)>threshold||Math.max(...v)<threshold)continue;
    const p=corners.map(c=>[x+c[0]+.5,y+c[1]+.5,z+c[2]+.5].map((a,k)=>origin[k]+a*h));
    const n=corners.map((c,k)=>gradient(base+ids[k],[x+c[0],y+c[1],z+c[2]]));
    const edge=(a,b)=>{const t=(threshold-v[a])/(v[b]-v[a]);return {p:p[a].map((a,k)=>a+(p[b][k]-a)*t),n:n[a].map((a,k)=>a+(n[b][k]-a)*t)};};
    for(const t of tets){const lo=t.filter(i=>v[i]<threshold),hi=t.filter(i=>v[i]>=threshold);if(!lo.length||!hi.length)continue;
      if(lo.length===1||hi.length===1){const a=lo.length===1?lo:hi,b=lo.length===1?hi:lo;triangle(edge(a[0],b[0]),edge(a[0],b[1]),edge(a[0],b[2]));}
      else{const a=edge(lo[0],hi[0]),b=edge(lo[0],hi[1]),c=edge(lo[1],hi[0]),d=edge(lo[1],hi[1]);triangle(a,b,c);triangle(b,d,c);}
    }
  }return {positions:new Float32Array(positions),normals:new Float32Array(normals)};
}
// Subdivide only crossed cells and interpolate the SAME scalar field. This
// reduces the tetrahedron-diagonal facets without inventing new CFD resolution.
export function refinedIsoSurface(grid,values,solid,threshold,detail=2){
 if(detail===1)return isoSurfaceMesh(grid,values,solid,threshold);
 const {nx,ny,nz,h,origin}=grid,positions=[],normals=[],ids=[0,1,nx,nx+1,nx*ny,nx*ny+1,nx*ny+nx,nx*ny+nx+1];
 const small={nx:3,ny:3,nz:3,h:h/2,origin:[0,0,0]},samples=new Float32Array(27),mask=new Uint8Array(27);
 for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
  const base=x+nx*(y+ny*z),v=ids.map(i=>values[base+i]);
  if(ids.some((i,k)=>solid[base+i]||!Number.isFinite(v[k]))||Math.min(...v)>threshold||Math.max(...v)<threshold)continue;
  for(let c=0;c<3;c++)for(let b=0;b<3;b++)for(let a=0;a<3;a++){
   let sum=0;for(let k=0;k<8;k++)sum+=v[k]*((k&1)?a/2:1-a/2)*((k&2)?b/2:1-b/2)*((k&4)?c/2:1-c/2);
   samples[a+3*(b+3*c)]=sum;
  }
  small.origin=[x,y,z].map((v,k)=>origin[k]+(v+.25)*h);
  const mesh=isoSurfaceMesh(small,samples,mask,threshold);for(const p of mesh.positions)positions.push(p);for(const n of mesh.normals)normals.push(n);
 }
 // Interpolate gradients from the original lattice across cell boundaries;
 // local sub-cell gradients would produce a visible seam at every parent cell.
 const gradients=new Map(),dims=[nx,ny,nz],strides=[1,nx,nx*ny];
 const grad=(i,xyz)=>{if(gradients.has(i))return gradients.get(i);const n=strides.map((d,k)=>{const lo=i-d,hi=i+d,hasLo=xyz[k]>0&&!solid[lo]&&Number.isFinite(values[lo]),hasHi=xyz[k]<dims[k]-1&&!solid[hi]&&Number.isFinite(values[hi]);return hasLo&&hasHi?(values[hi]-values[lo])/(2*h):hasHi?(values[hi]-values[i])/h:hasLo?(values[i]-values[lo])/h:0;});gradients.set(i,n);return n;};
 for(let i=0;i<positions.length;i+=3){
  const xyz=[0,1,2].map(k=>Math.max(0,Math.min(dims[k]-1,(positions[i+k]-origin[k])/h-.5))),lo=xyz.map((v,k)=>Math.min(dims[k]-2,Math.floor(v))),t=xyz.map((v,k)=>v-lo[k]),n=[0,0,0];
  for(let c=0;c<8;c++){const p=lo.map((v,k)=>v+((c>>k)&1)),j=p[0]+nx*(p[1]+ny*p[2]);if(solid[j]||!Number.isFinite(values[j]))continue;const w=t.reduce((s,v,k)=>s*((c>>k)&1?v:1-v),1),g=grad(j,p);for(let k=0;k<3;k++)n[k]+=w*g[k];}
  const length=Math.hypot(...n);if(length>1e-20)for(let k=0;k<3;k++)normals[i+k]=n[k]/length;
 }
 return {positions:new Float32Array(positions),normals:new Float32Array(normals)};
}
// A continuous plane between sample centers, with linearly interpolated corner values.
// Never bridge missing samples or a solid boundary.
export function sliceSurface(grid,values,solid,axis,fraction){
  const {nx,ny,nz,h,origin}=grid,dims=[nx,ny,nz],strides=[1,nx,nx*ny],along=[0,1,2].filter(a=>a!==axis),index=Math.max(0,Math.min(1,fraction))*(dims[axis]-1),low=Math.floor(index),high=Math.min(low+1,dims[axis]-1),t=index-low,positions=[],samples=[];
  const at=(a,b)=>{const ijk=[0,0,0];ijk[along[0]]=a;ijk[along[1]]=b;ijk[axis]=low;const i=ijk[0]+nx*(ijk[1]+ny*ijk[2]),j=i+(high-low)*strides[axis];if(solid[i]||!Number.isFinite(values[i])||(t>0&&(solid[j]||!Number.isFinite(values[j]))))return null;ijk[axis]=index;return {p:ijk.map((v,k)=>origin[k]+(v+.5)*h),v:t===0?values[i]:values[i]*(1-t)+values[j]*t};};
  for(let b=0;b<dims[along[1]]-1;b++)for(let a=0;a<dims[along[0]]-1;a++){
    const corners=[at(a,b),at(a+1,b),at(a+1,b+1),at(a,b+1)];if(corners.some(c=>c===null))continue;
    for(const k of [0,1,2,0,2,3]){positions.push(...corners[k].p);samples.push(corners[k].v);}
  }
  return {positions,values:samples,coordinate:origin[axis]+(index+.5)*h};
}
export function connectedLoads(points,polygons,panels){
  const parent=polygons.map((_,i)=>i),first=new Map(),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  polygons.forEach((f,i)=>f.forEach(v=>{if(first.has(v))parent[find(i)]=find(first.get(v));else first.set(v,i);}));
  const groups=new Map();for(const p of panels){const root=find(p.index);if(!groups.has(root))groups.set(root,{faces:0,area:0,force:[0,0,0],indices:[]});const g=groups.get(root);g.faces++;g.area+=p.area;g.indices.push(p.index);p.force.forEach((v,k)=>g.force[k]+=v);}
  return Array.from(groups.values()).sort((a,b)=>b.area-a.area);
}
