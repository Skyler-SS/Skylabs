// Measure actual wall-layer coverage on the native mesh before expensive solving.
function layerSurface(text,requested){
 if(!/\nASCII\s/.test(text)||!text.includes('DATASET POLYDATA'))throw Error('Expected an ASCII native wall mesh.');
 const t=text.trim().split(/\s+/);let i=t.indexOf('POINTS')+1,n=+t[i++];i++;
 if(!Number.isSafeInteger(n)||n<3||n>4000000)throw Error('Invalid wall point count.');
 const points=Array.from({length:n},()=>[+t[i++],+t[i++],+t[i++]]);i=t.indexOf('POLYGONS')+1;const count=+t[i++];i++;
 if(!Number.isSafeInteger(count)||count<1||count>2000000)throw Error('Invalid wall face count.');
 const areas=[];
 for(let f=0;f<count;f++){const size=+t[i++];if(!Number.isSafeInteger(size)||size<3||size>100)throw Error('Invalid wall polygon.');const face=Array.from({length:size},()=>+t[i++]);if(face.some(v=>!Number.isSafeInteger(v)||v<0||v>=n))throw Error('Invalid wall vertex.');const vector=[0,0,0];for(let j=0;j<size;j++){const a=points[face[j]],b=points[face[(j+1)%size]];vector[0]+=a[1]*b[2]-a[2]*b[1];vector[1]+=a[2]*b[0]-a[0]*b[2];vector[2]+=a[0]*b[1]-a[1]*b[0];}const area=Math.hypot(...vector)/2;if(!Number.isFinite(area)||area<=0)throw Error('Invalid wall area.');areas.push(area);}
 i=t.indexOf('nSurfaceLayers');if(i<0||+t[i+1]!==1||+t[i+2]!==count)throw Error('Layer field does not match the wall mesh.');const values=t.slice(i+4,i+4+count).map(Number);if(values.length!==count||values.some(v=>!Number.isFinite(v)||v<0||v>requested))throw Error('Invalid native layer counts.');
 const area=areas.reduce((a,v)=>a+v,0),weighted=fn=>values.reduce((a,v,j)=>a+fn(v)*areas[j],0)/area;
 return {requested,faces:count,area,mean:weighted(v=>v),coverage:weighted(v=>v>0?1:0),fullCoverage:weighted(v=>v===requested?1:0)};
}
function boundaryLayers(text,count,patch='model'){
 if(!['model','ground'].includes(patch))throw Error('Unknown wall patch.');
 const body=new RegExp('\\b'+patch+'\\s*\\{([^}]*)\\}').exec(text.slice(text.indexOf('boundaryField')))?.[1];if(!body)return null;
 const uniform=/\bvalue\s+uniform\s+([\deE+.-]+)/.exec(body),list=/\bvalue\s+nonuniform\s+List<scalar>\s+(\d+)\s*\(([^)]*)\)/s.exec(body);
 const values=uniform?Array(count).fill(+uniform[1]):list?list[2].trim().split(/\s+/).map(Number):null;
 return values?.length===count&&values.every(v=>Number.isFinite(v)&&v>=0&&v<=256)?values:null;
}
module.exports={layerSurface,boundaryLayers};
