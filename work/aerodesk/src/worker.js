import {grid,voxelize,Solver} from './solver.mjs';
self.onmessage=({data})=>{
  try{
    const g=grid(data.nx),mask=voxelize(data.vertices,g),solver=new Solver(g,mask.solid,data.re);
    self.postMessage({type:'mesh',grid:g,solid:mask.solid,count:mask.count,area:mask.area,tau:solver.tau});
    for(let n=0;n<data.steps;n++){
      solver.step();
      if((n+1)%40===0||n===data.steps-1){
        const snap=solver.snapshot();
        self.postMessage({type:n===data.steps-1?'done':'progress',...snap},[snap.ux.buffer,snap.uy.buffer,snap.uz.buffer,snap.rho.buffer]);
      }
    }
  }catch(e){self.postMessage({type:'error',message:e.message});}
};
