// Display scales and surface sampling never modify solver values or force integration.
export const fields={
  pressure:{label:'Pressure coefficient',unit:'Cp',palette:'diverging',fixed:[-1,1],value:(p,q)=>p.pressurePa/q},
  pressurePa:{label:'Relative surface pressure',unit:'Pa',palette:'diverging',value:p=>p.pressurePa},
  friction:{label:'Wall shear stress',unit:'Pa',palette:'sequential',value:p=>p.shearPa},
  cf:{label:'Skin friction coefficient',unit:'Cf',palette:'sequential',value:(p,q)=>p.shearPa/q},
  drag:{label:'Local drag per area',unit:'N/m²',palette:'diverging',value:p=>p.force[0]/p.area},
  layers:{label:'Boundary-layer mesh',unit:'actual layers',palette:'coverage',value:p=>p.layers},
  yplus:{label:'Wall resolution',unit:'y+',palette:'sequential',value:p=>p.yPlus},
  slice:{label:'Near-surface flow speed',unit:'m/s',palette:'velocity'},
  flow:{label:'Streamline speed',unit:'m/s',palette:'velocity'}
};
export const ramps={coverage:['#b7393f','#e18b55','#f3dfa6','#bdd8d6','#5b94bd','#275d91'],velocity:['#273487','#226db1','#49b2d0','#e5eef1','#f5ca70','#ef8845','#bf3046'],diverging:['#244ba8','#4d95ce','#a8cee4','#f6f4ee','#f3bd8b','#dd744b','#a92338'],sequential:['#211858','#384d9b','#218eac','#54bfac','#c3de83','#f4d85d','#ee8c38','#b82c45']};
export function rgbAt(t,palette='sequential'){
  const ramp=ramps[palette],x=Math.max(0,Math.min(1,t))*(ramp.length-1),i=Math.min(ramp.length-2,Math.floor(x)),f=x-i;
  const rgb=h=>[1,3,5].map(k=>parseInt(h.slice(k,k+2),16)/255),a=rgb(ramp[i]),b=rgb(ramp[i+1]);return a.map((v,k)=>v*(1-f)+b[k]*f);
}
export function fieldScale(values,key,mode='auto',manual=null,speed=20){
  const def=fields[key]||fields.flow,sorted=Array.from(values).filter(v=>v!==null&&Number.isFinite(v)).sort((a,b)=>a-b);
  const range=sorted.length?[sorted[0],sorted.at(-1)]:[0,1],quantile=f=>sorted[Math.floor((sorted.length-1)*f)]??0;
  let min,max;
  if(mode==='manual'){if(!manual||!manual.every(Number.isFinite)||manual[1]<=manual[0])throw Error('Color maximum must be greater than minimum.');[min,max]=manual;}
  else if(mode==='fixed') [min,max]=def.fixed||(key==='flow'||key==='slice'||def.referenceSpeed?[0,1.6*speed]:range);
  else {min=quantile(.02);max=quantile(.98);if(def.palette==='diverging'){const a=Math.max(Math.abs(min),Math.abs(max));min=-a;max=a;}}
  if(!(max>min)||max-min<1e-10*Math.max(1,Math.abs(max))){const pad=Math.max(Math.abs(min)*.01,1e-6);min-=pad;max+=pad;}
  return {min,max,actualMin:range[0],actualMax:range[1],palette:def.palette,mode,clipped:sorted.filter(v=>v<min||v>max).length,count:sorted.length};
}
export function colorValue(value,scale){return value===null||!Number.isFinite(value)?[.65,.69,.73]:rgbAt((value-scale.min)/(scale.max-scale.min),scale.palette);}
// One range for the whole volume, so a color always means the same speed while
// moving the slice. Include inlet speed and never magnify sub-percent noise.
export function velocityContrast(values,speed){
 const sorted=Array.from(values).filter(Number.isFinite).sort((a,b)=>a-b);
 const q=f=>sorted[Math.floor((sorted.length-1)*f)]??speed;
 const min=Math.max(0,Math.min(q(.02),speed*.95)),max=Math.max(q(.98),speed*1.05);
 return {min,max,palette:'velocity',mode:'auto',actualMin:sorted[0]??speed,actualMax:sorted.at(-1)??speed,count:sorted.length,clipped:sorted.filter(v=>v<min||v>max).length};
}
export function loadBins(panels,count=20){
  if(!panels.length)return [];
  const min=Math.min(...panels.map(p=>p.center[2])),max=Math.max(...panels.map(p=>p.center[2])),width=(max-min||1)/count;
  const bins=Array.from({length:count},(_,i)=>({z:min+(i+.5)*width,lift:0,drag:0,width}));
  for(const p of panels){const b=bins[Math.max(0,Math.min(count-1,Math.floor((p.center[2]-min)/width)))];b.lift+=p.force[1];b.drag+=p.force[0];}return bins;
}
export function shiftedMoment(moment,force,origin){
  const [x,y,z]=origin,[fx,fy,fz]=force;return [moment[0]-(y*fz-z*fy),moment[1]-(z*fx-x*fz),moment[2]-(x*fy-y*fx)];
}
export function forceStability(history,key='cd'){
  const tail=history.slice(-Math.max(10,Math.ceil(history.length*.1))).map(a=>a[key]);
  if(tail.length<10)return null;const mean=tail.reduce((a,b)=>a+b,0)/tail.length,spread=Math.max(...tail)-Math.min(...tail);
  return {mean,spread,relative:Math.abs(mean)>1e-9?spread/Math.abs(mean):null,count:tail.length};
}
// Nearest neighbours on the same side of the surface, so thin wing skins do not mix.
export function surfaceSampler(panels){
  function tree(ids,depth=0){if(!ids.length)return null;const axis=depth%3;ids.sort((a,b)=>panels[a].center[axis]-panels[b].center[axis]);const m=ids.length>>1;return {id:ids[m],axis,left:tree(ids.slice(0,m),depth+1),right:tree(ids.slice(m+1),depth+1)};}
  const root=tree(panels.map((_,i)=>i));
  return (point,normal)=>{
    const best=[];
    function visit(n){if(!n)return;const p=panels[n.id],d=p.center.reduce((sum,v,k)=>sum+(v-point[k])**2,0),dot=p.normal.reduce((s,v,k)=>s+v*normal[k],0);
      if(dot>.15){best.push({id:n.id,d});best.sort((a,b)=>a.d-b.d);if(best.length>4)best.pop();}
      const diff=point[n.axis]-p.center[n.axis];visit(diff<0?n.left:n.right);if(best.length<4||diff*diff<best.at(-1).d)visit(diff<0?n.right:n.left);
    }visit(root);
    if(!best.length||best[0].d>Math.max(panels[best[0].id].area*9,1e-16))return [];
    const weights=best.map(b=>1/Math.max(b.d,1e-18)),sum=weights.reduce((a,b)=>a+b,0);return best.map((b,i)=>[b.id,weights[i]/sum]);
  };
}
