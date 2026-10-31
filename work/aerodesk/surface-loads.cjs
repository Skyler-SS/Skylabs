const fs=require('node:fs/promises'),path=require('node:path');
const {surfaceLoads}=require('./physical-properties.cjs');
function parseSurfaceVTK(text){
  if(!/\nASCII\s/.test(text)||!/DATASET POLYDATA/.test(text))throw Error('Expected an ASCII polygon surface.');
  const tokens=text.trim().split(/\s+/),at=word=>{const i=tokens.indexOf(word);if(i<0)throw Error('Missing '+word+' surface data.');return i;};
  let i=at('POINTS')+1;const n=+tokens[i++];i++;const points=Array.from({length:n},()=>[+tokens[i++],+tokens[i++],+tokens[i++]]);
  i=at('POLYGONS')+1;const m=+tokens[i++];i++;const faces=Array.from({length:m},()=>{const count=+tokens[i++];return Array.from({length:count},()=>+tokens[i++]);});
  const cellAt=at('CELL_DATA');if(+tokens[cellAt+1]!==m)throw Error('Surface cell count mismatch.');
  const field=(name,components)=>{const start=tokens.indexOf(name,cellAt);if(start<0||+tokens[start+1]!==components||+tokens[start+2]!==m)throw Error('Missing surface field '+name);return tokens.slice(start+4,start+4+m*components).map(Number);};
  const pressure=field('p',1),shear=field('wallShearStress',3);
  if(!points.flat().concat(pressure,shear).every(Number.isFinite)||faces.some(f=>f.length<3||f.some(v=>!Number.isInteger(v)||v<0||v>=n)))throw Error('Invalid surface values.');
  const yPlus=tokens.indexOf('yPlus',cellAt)>=0?field('yPlus',1):null;
  if(yPlus&&!yPlus.every(Number.isFinite))throw Error('Invalid wall y+ values.');
  return {points,faces,pressure,shear,yPlus};
}
async function readSurfaceLoads(folder,density){
  const root=path.join(folder,'postProcessing/bodySurface'),times=(await fs.readdir(root)).filter(v=>Number.isFinite(+v)).sort((a,b)=>+b-+a);
  if(!times.length)throw Error('Surface load output is missing.');
  const {points,faces,pressure,shear,yPlus}=parseSurfaceVTK(await fs.readFile(path.join(root,times[0],'body.vtk'),'utf8'));
  const result=surfaceLoads(points,faces,pressure,shear,density);
  const layers=await fs.readFile(path.join(folder,'0/nSurfaceLayers'),'utf8').then(text=>require('./layer-mesh.cjs').boundaryLayers(text,faces.length),()=>null);
  for(const panel of result.panels){panel.yPlus=yPlus?.[panel.index]??null;panel.layers=layers?.[panel.index]??null;}
  return {...result,points,polygons:faces,faces:faces.length};
}
module.exports={parseSurfaceVTK,readSurfaceLoads};
