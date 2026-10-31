// Seed the model's projected silhouette and near its surfaces, in normalized coordinates.
export function modelSeeds(vertices,h){
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<vertices.length;i++){const a=i%3;lo[a]=Math.min(lo[a],vertices[i]);hi[a]=Math.max(hi[a],vertices[i]);}
  const seeds=[],pad=Math.max(h*2,.04),ny=24,nz=32;
  for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)seeds.push([lo[0]-.32,lo[1]-pad+(hi[1]-lo[1]+pad*2)*(y+.5)/ny,lo[2]-pad+(hi[2]-lo[2]+pad*2)*(z+.5)/nz]);
  const count=vertices.length/9,stride=Math.max(1,Math.ceil(count/300));
  for(let t=0;t<count;t+=stride){const i=t*9,a=Array.from(vertices.slice(i,i+3)),b=Array.from(vertices.slice(i+3,i+6)),c=Array.from(vertices.slice(i+6,i+9)),u=b.map((v,j)=>v-a[j]),v=c.map((v,j)=>v-a[j]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],m=Math.hypot(...n);if(m<1e-12)continue;seeds.push(a.map((v,j)=>(v+b[j]+c[j])/3+n[j]/m*h*2));}
  return seeds;
}
// A continuous upstream rake in the chosen plane, rather than selecting a few
// pre-existing 3-D seeds near zero. Paths still follow the actual 3-D velocity.
export function planeSeeds(lo,hi,h,plane,percent=50,count=144){
  if(!['horizontal','vertical'].includes(plane)||![...lo,...hi,h,percent].every(Number.isFinite)||h<=0||lo.some((v,k)=>v>hi[k]))throw Error('Invalid streamline plane.');
  const axis=plane==='vertical'?2:1,across=axis===2?1:2,pad=Math.max(h*2,.04),min=lo[axis]-pad,max=hi[axis]+pad,position=min+(max-min)*Math.max(0,Math.min(100,percent))/100;
  const seeds=Array.from({length:Math.max(2,Math.min(300,Math.round(count)))},(_,i)=>{const p=[lo[0]-.32,0,0];p[axis]=position;p[across]=lo[across]-pad+(hi[across]-lo[across]+pad*2)*(i+.5)/Math.max(2,Math.min(300,Math.round(count)));return p;});
  return {axis,position,min,max,seeds};
}
export function traceLine(seed,velocity,h,direction=1,maxSteps=240,blocked=()=>false){
  const points=[seed];let p=seed;const step=Math.min(.025,h*.7);
  for(let i=0;i<maxSteps;i++){const u=velocity(...p);if(!u)break;const speed=Math.hypot(...u);if(speed<1e-9)break;const mid=p.map((v,j)=>v+direction*step*.5*u[j]/speed),v=velocity(...mid);if(!v)break;const m=Math.hypot(...v);if(m<1e-9)break;const next=p.map((a,j)=>a+direction*step*v[j]/m);if(!velocity(...next)||blocked(p,next))break;points.push(next);p=next;}
  return points;
}
// BVH intersection prevents resampled velocity from drawing through thin surfaces.
// Lines terminate on contact; their paths are never fabricated to wrap around CAD.
export function surfaceBlocker(vertices){
  const triangles=[];for(let i=0;i<vertices.length;i+=9){const lo=[0,1,2].map(k=>Math.min(vertices[i+k],vertices[i+k+3],vertices[i+k+6])),hi=[0,1,2].map(k=>Math.max(vertices[i+k],vertices[i+k+3],vertices[i+k+6]));triangles.push({i,lo,hi});}
  function build(list){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const t of list)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],t.lo[k]);hi[k]=Math.max(hi[k],t.hi[k]);}const node={lo,hi};if(list.length<=12){node.items=list;return node;}const axis=[0,1,2].sort((a,b)=>(hi[b]-lo[b])-(hi[a]-lo[a]))[0];list.sort((a,b)=>(a.lo[axis]+a.hi[axis])-(b.lo[axis]+b.hi[axis]));const mid=Math.floor(list.length/2);node.left=build(list.slice(0,mid));node.right=build(list.slice(mid));return node;}
  const root=build(triangles);
  function box(node,a,d){let min=0,max=1;for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-12){if(a[k]<node.lo[k]-1e-8||a[k]>node.hi[k]+1e-8)return false;}else{let x=(node.lo[k]-a[k])/d[k],y=(node.hi[k]-a[k])/d[k];if(x>y)[x,y]=[y,x];min=Math.max(min,x);max=Math.min(max,y);if(max<min)return false;}}return true;}
  function triangle(i,a,d){const ax=vertices[i],ay=vertices[i+1],az=vertices[i+2],e1=[vertices[i+3]-ax,vertices[i+4]-ay,vertices[i+5]-az],e2=[vertices[i+6]-ax,vertices[i+7]-ay,vertices[i+8]-az],p=[d[1]*e2[2]-d[2]*e2[1],d[2]*e2[0]-d[0]*e2[2],d[0]*e2[1]-d[1]*e2[0]],det=e1[0]*p[0]+e1[1]*p[1]+e1[2]*p[2];if(Math.abs(det)<1e-14)return false;const t=[a[0]-ax,a[1]-ay,a[2]-az],u=(t[0]*p[0]+t[1]*p[1]+t[2]*p[2])/det;if(u<0||u>1)return false;const q=[t[1]*e1[2]-t[2]*e1[1],t[2]*e1[0]-t[0]*e1[2],t[0]*e1[1]-t[1]*e1[0]],v=(d[0]*q[0]+d[1]*q[1]+d[2]*q[2])/det;if(v<0||u+v>1)return false;const distance=(e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2])/det;return distance>=0&&distance<=1;}
  function hit(node,a,d){if(!box(node,a,d))return false;if(node.items)return node.items.some(t=>triangle(t.i,a,d));return hit(node.left,a,d)||hit(node.right,a,d);}
  return (a,b)=>hit(root,a,b.map((v,k)=>v-a[k]));
}
