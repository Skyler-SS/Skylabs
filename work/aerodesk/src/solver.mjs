// D3Q19, single-relaxation-time lattice Boltzmann, halfway bounce-back.
// Experimental low-Reynolds flow only. All solver quantities are lattice units.
export const C=[[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[-1,-1,0],[1,-1,0],[-1,1,0],[1,0,1],[-1,0,-1],[1,0,-1],[-1,0,1],[0,1,1],[0,-1,-1],[0,1,-1],[0,-1,1]];
const W=C.map((c,q)=>q===0?1/3:q<7?1/18:1/36);
const O=C.map(c=>C.findIndex(d=>d.every((v,k)=>v===-c[k])));
export const U0=.06;
export function grid(nx=64){const ny=nx/2,nz=ny,h=6/nx;return {nx,ny,nz,h,N:nx*ny*nz,origin:[-2,-1.5,-1.5]};}
export function voxelize(vertices,g){
  const {nx,ny,nz,h,origin,N}=g;
  const crossings=Array.from({length:ny*nz},()=>[]);
  for(let t=0;t<vertices.length;t+=9){
    const ax=vertices[t],ay=vertices[t+1],az=vertices[t+2],bx=vertices[t+3],by=vertices[t+4],bz=vertices[t+5],cx=vertices[t+6],cy=vertices[t+7],cz=vertices[t+8];
    const det=(by-ay)*(cz-az)-(bz-az)*(cy-ay);if(Math.abs(det)<1e-12)continue;
    const y0=Math.max(0,Math.ceil((Math.min(ay,by,cy)-origin[1])/h-.5)),y1=Math.min(ny-1,Math.floor((Math.max(ay,by,cy)-origin[1])/h-.5));
    const z0=Math.max(0,Math.ceil((Math.min(az,bz,cz)-origin[2])/h-.5)),z1=Math.min(nz-1,Math.floor((Math.max(az,bz,cz)-origin[2])/h-.5));
    for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++){
      // Small deterministic offset avoids triangulation edges and vertices.
      const py=origin[1]+(y+.5)*h+1e-8,pz=origin[2]+(z+.5)*h+2e-8;
      const u=((py-ay)*(cz-az)-(pz-az)*(cy-ay))/det,v=((by-ay)*(pz-az)-(bz-az)*(py-ay))/det;
      if(u>=0&&v>=0&&u+v<=1)crossings[y+ny*z].push(ax+u*(bx-ax)+v*(cx-ax));
    }
  }
  const solid=new Uint8Array(N);let count=0,area=0,bad=0;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){
    const hits=crossings[y+ny*z].sort((a,b)=>a-b).filter((v,k,a)=>k===0||v-a[k-1]>1e-7);
    if(hits.length%2){bad++;continue;}let occupied=false;
    for(let p=0;p<hits.length;p+=2)for(let x=Math.max(1,Math.ceil((hits[p]-origin[0])/h-.5));x<=Math.min(nx-2,Math.floor((hits[p+1]-origin[0])/h-.5));x++){
      const i=x+nx*(y+ny*z);if(!solid[i]){solid[i]=1;count++;occupied=true;}
    }
    if(occupied)area++;
  }
  if(bad>0)throw Error('This mesh has open or overlapping surfaces at '+bad+' grid columns. Export a closed solid or try a simpler single part.');
  if(count<8)throw Error('The model is too thin for this grid. Choose a finer grid or a thicker, closed solid.');
  return {solid,count,area};
}
export class Solver{
  constructor(g,solid,re=40){
    if(!(re>=10&&re<=60))throw Error('Reynolds number must be between 10 and 60.');
    Object.assign(this,g);this.solid=solid;this.re=re;this.tau=.5+3*U0/(g.h*re);this.omega=1/this.tau;this.stepNumber=0;
    this.f=new Float32Array(g.N*19);this.post=new Float32Array(g.N*19);this.next=new Float32Array(g.N*19);this.neighbors=new Int32Array(g.N*19);
    this.rho=new Float32Array(g.N).fill(1);this.ux=new Float32Array(g.N);this.uy=new Float32Array(g.N);this.uz=new Float32Array(g.N);this.previous=new Float32Array(g.N*3);this.force=[0,0,0];
    this.interior=[];this.boundary=[];this.eq=C.map((c,q)=>W[q]*(1+3*c[0]*U0+4.5*(c[0]*U0)**2-1.5*U0*U0));
    const {nx,ny,nz}=g;
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const i=x+nx*(y+ny*z);for(let q=0;q<19;q++)this.f[i*19+q]=this.eq[q];
      if(solid[i])continue;this.ux[i]=U0;
      if(x===0||y===0||z===0||x===nx-1||y===ny-1||z===nz-1){this.boundary.push([i,x===nx-1&&y>0&&z>0&&y<ny-1&&z<nz-1]);continue;}
      this.interior.push(i);
      for(let q=0;q<19;q++){const c=C[q],j=x-c[0]+nx*(y-c[1]+ny*(z-c[2]));this.neighbors[i*19+q]=solid[j]?-1:j;}
    }
  }
  step(){
    const {f,post,next,interior,neighbors,omega,eq}=this;
    for(const i of interior){
      const b=i*19;let r=0,u=0,v=0,w=0;
      for(let q=0;q<19;q++){const a=f[b+q];r+=a;u+=C[q][0]*a;v+=C[q][1]*a;w+=C[q][2]*a;}
      u/=r;v/=r;w/=r;const usq=u*u+v*v+w*w;
      if(!Number.isFinite(r)||r<.75||r>1.25||usq>.09)throw Error('Flow became unstable. Lower Reynolds number or use a finer grid.');
      this.rho[i]=r;this.ux[i]=u;this.uy[i]=v;this.uz[i]=w;
      for(let q=0;q<19;q++){const cu=C[q][0]*u+C[q][1]*v+C[q][2]*w;post[b+q]=f[b+q]+omega*(W[q]*r*(1+3*cu+4.5*cu*cu-1.5*usq)-f[b+q]);}
    }
    for(const [i,outflow] of this.boundary)for(let q=0;q<19;q++)post[i*19+q]=outflow?post[(i-1)*19+q]:eq[q];
    let fx=0,fy=0,fz=0;
    for(const i of interior){const b=i*19;for(let q=0;q<19;q++){
      const n=neighbors[b+q];
      if(n>=0)next[b+q]=post[n*19+q];else{const a=post[b+O[q]];next[b+q]=a;fx-=2*C[q][0]*a;fy-=2*C[q][1]*a;fz-=2*C[q][2]*a;}
    }}
    for(const [i] of this.boundary)for(let q=0;q<19;q++)next[i*19+q]=post[i*19+q];
    this.f=next;this.next=f;this.force=[fx,fy,fz];this.stepNumber++;
  }
  snapshot(){
    // Boundary values in exports must match the populations, including outlet extrapolation.
    for(const [i] of this.boundary){let r=0,u=0,v=0,w=0;for(let q=0;q<19;q++){const a=this.f[i*19+q];r+=a;u+=C[q][0]*a;v+=C[q][1]*a;w+=C[q][2]*a;}this.rho[i]=r;this.ux[i]=u/r;this.uy[i]=v/r;this.uz[i]=w/r;}
    let delta=0,norm=0,maxSpeed=0;
    for(const i of this.interior){const u=this.ux[i],v=this.uy[i],w=this.uz[i];delta+=(u-this.previous[i*3])**2+(v-this.previous[i*3+1])**2+(w-this.previous[i*3+2])**2;norm+=u*u+v*v+w*w;this.previous[i*3]=u;this.previous[i*3+1]=v;this.previous[i*3+2]=w;maxSpeed=Math.max(maxSpeed,Math.sqrt(u*u+v*v+w*w));}
    return {iteration:this.stepNumber,force:[...this.force],change:Math.sqrt(delta/(norm||1)),maxSpeed,ux:this.ux.slice(),uy:this.uy.slice(),uz:this.uz.slice(),rho:this.rho.slice()};
  }
}
