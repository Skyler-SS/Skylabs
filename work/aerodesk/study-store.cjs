const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),v8=require('node:v8');
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const {sameEnvironment}=require('./environment.cjs');
const conditionKeys=['length','speed','density','nu','referenceArea','intensity','yaw','pitch','roll','roughness','turbulenceRatio'];
function validateRecord(data){const r=data?.result,g=r?.grid;if(!g||!Number.isSafeInteger(g.N)||g.N<1||g.N>2000000||g.nx*g.ny*g.nz!==g.N||r.engine!=='openfoam'||!data.vertices?.length||data.vertices.length>1800000)throw Error('Invalid saved study.');for(const key of ['ux','uy','uz','solid'])if(r[key]?.length!==g.N)throw Error('Incomplete saved flow field.');return data;}
function encode(data){validateRecord(data);return zlib.gzipSync(v8.serialize(data),{level:3});}
function decode(bytes){if(bytes.length>128*1024*1024)throw Error('Study file is too large.');return validateRecord(v8.deserialize(zlib.gunzipSync(bytes,{maxOutputLength:256*1024*1024})));}
function assertMatch(data,settings,vertices){if(!sameEnvironment(data.settings,settings))throw Error('Study environment differs.');for(const k of conditionKeys){const a=settings[k]??(k==='turbulenceRatio'?10:0),b=data.settings[k]??(k==='turbulenceRatio'?10:0);if(!Number.isFinite(a)||Math.abs(a-b)>Math.max(1e-12,Math.abs(b)*1e-8))throw Error('Study condition differs: '+k);}if(vertices.length!==data.vertices.length||Array.from(vertices).some((v,i)=>!Number.isFinite(v)||Math.abs(v-data.vertices[i])>1e-6))throw Error('Saved study belongs to different geometry.');}
function store(root){
 const file=id=>{if(!validId(id))throw Error('Invalid study ID.');return path.join(root,id+'.gz');};
 return {
  async put(result,settings,vertices){const id=crypto.randomUUID();await fs.mkdir(root,{recursive:true});await fs.writeFile(file(id),encode({result,settings,vertices:new Float32Array(vertices)}));return id;},
  async get(id,settings,vertices){const data=decode(await fs.readFile(file(id)));assertMatch(data,settings,vertices);return {...data.result,resultId:id};},
  async export(ids,projectFile){const folder=projectFile+'.results';await fs.mkdir(folder,{recursive:true});for(const id of [...new Set(ids)])await fs.copyFile(file(id),path.join(folder,id+'.gz'));},
  async import(ids,projectFile){const missing=[];await fs.mkdir(root,{recursive:true});for(const id of [...new Set(ids)]){const target=file(id),source=path.join(projectFile+'.results',id+'.gz');try{const bytes=await fs.readFile(source);decode(bytes);await fs.writeFile(target,bytes);}catch(e){try{decode(await fs.readFile(target));}catch{missing.push(id);}}}return missing;}
 };
}
module.exports={store,encode,decode,assertMatch,validId};
