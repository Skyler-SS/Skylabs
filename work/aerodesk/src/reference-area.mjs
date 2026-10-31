// Rasterized union of the model's XZ projection. Includes fuselage and tail;
// it must never be presented as a measured main-wing planform area.
export function projectedArea(vertices,length=1,resolution=768){
 let xmin=Infinity,xmax=-Infinity,zmin=Infinity,zmax=-Infinity;
 for(let i=0;i<vertices.length;i+=3){xmin=Math.min(xmin,vertices[i]);xmax=Math.max(xmax,vertices[i]);zmin=Math.min(zmin,vertices[i+2]);zmax=Math.max(zmax,vertices[i+2]);}
 const dx=(xmax-xmin)/resolution,dz=(zmax-zmin)/resolution;if(!(dx>0&&dz>0))return 0;
 const mask=new Uint8Array(resolution*resolution);
 for(let i=0;i<vertices.length;i+=9){const x=[vertices[i],vertices[i+3],vertices[i+6]].map(v=>(v-xmin)/dx),z=[vertices[i+2],vertices[i+5],vertices[i+8]].map(v=>(v-zmin)/dz),den=(z[1]-z[2])*(x[0]-x[2])+(x[2]-x[1])*(z[0]-z[2]);if(Math.abs(den)<1e-12)continue;
  const x0=Math.max(0,Math.floor(Math.min(...x))),x1=Math.min(resolution-1,Math.floor(Math.max(...x))),z0=Math.max(0,Math.floor(Math.min(...z))),z1=Math.min(resolution-1,Math.floor(Math.max(...z)));
  for(let b=z0;b<=z1;b++)for(let a=x0;a<=x1;a++){if(mask[a+resolution*b])continue;const u=((z[1]-z[2])*(a+.5-x[2])+(x[2]-x[1])*(b+.5-z[2]))/den,v=((z[2]-z[0])*(a+.5-x[2])+(x[0]-x[2])*(b+.5-z[2]))/den;if(u>=0&&v>=0&&u+v<=1)mask[a+resolution*b]=1;}
 }
 return mask.reduce((a,b)=>a+b,0)*dx*dz*length**2;
}
