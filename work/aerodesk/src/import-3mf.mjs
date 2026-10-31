import {unzipSync,strFromU8} from 'fflate';
import {DOMParser} from '@xmldom/xmldom';
import {Matrix4,Vector3} from 'three';
const units={micron:1e-6,millimeter:.001,centimeter:.01,inch:.0254,foot:.3048,meter:1};
const children=(e,name)=>Array.from(e?.childNodes||[]).filter(n=>n.nodeType===1&&n.localName===name);
function xml(bytes){const s=strFromU8(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(s))throw Error('3MF external XML entities are not supported.');return new DOMParser({onError:level=>{if(level==='fatalError')throw Error('Invalid 3MF XML.');}}).parseFromString(s,'text/xml');}
function transform(node,scale){const s=node.getAttribute('transform');if(!s)return new Matrix4();const t=s.trim().split(/\s+/).map(Number);if(t.length!==12||!t.every(Number.isFinite))throw Error('Invalid 3MF assembly transform.');return new Matrix4().set(t[0],t[3],t[6],t[9]*scale,t[1],t[4],t[7],t[10]*scale,t[2],t[5],t[8],t[11]*scale,0,0,0,1);}
function cleanPath(p){const parts=p.replace(/\\/g,'/').replace(/^\//,'').split('/');if(parts.includes('..'))throw Error('Invalid 3MF package path.');return parts.filter(Boolean).join('/');}
export function import3MF(bytes){
 let expanded=0,oversize=false;const files=unzipSync(bytes,{filter:e=>{expanded+=e.originalSize;if(expanded>128*1024*1024){oversize=true;return false;}return /\.model$|\.rels$/i.test(e.name);}});if(oversize)throw Error('Expanded 3MF exceeds 128 MB.');
 const models=new Map();for(const [file,data] of Object.entries(files)){if(!/\.model$/i.test(file))continue;const doc=xml(data),root=doc.documentElement,scale=units[root.getAttribute('unit')||'millimeter'];if(!scale)throw Error('Unsupported 3MF units.');const objects=new Map();for(const o of children(children(root,'resources')[0],'object'))objects.set(o.getAttribute('id'),o);models.set(cleanPath(file),{root,objects,scale});}
 let primary='3D/3dmodel.model';const rel=files['_rels/.rels'];if(rel){const r=Array.from(xml(rel).getElementsByTagName('Relationship')).find(r=>(r.getAttribute('Type')||'').endsWith('/3dmodel'));if(r)primary=cleanPath(r.getAttribute('Target'));}
 if(!models.has(primary))throw Error('3MF has no referenced build model.');
 const parts=[];let faceCount=0;
 function visit(file,id,matrix,stack=[]){const key=file+'#'+id;if(stack.includes(key)||stack.length>64)throw Error('Cyclic or too deeply nested 3MF assembly.');const m=models.get(file),o=m?.objects.get(id);if(!o)throw Error('Missing 3MF component '+key);const mesh=children(o,'mesh')[0];
  if(mesh){const vs=children(children(mesh,'vertices')[0],'vertex').map(v=>new Vector3(...['x','y','z'].map(k=>Number(v.getAttribute(k))*m.scale)).applyMatrix4(matrix));const ts=children(children(mesh,'triangles')[0],'triangle');faceCount+=ts.length;if(faceCount>200000)throw Error('3MF exceeds 200,000 triangles. Export a lower mesh resolution.');const out=new Float32Array(ts.length*9);let i=0;for(const t of ts){const ids=['v1','v2','v3'].map(k=>Number(t.getAttribute(k)));if(matrix.determinant()<0)[ids[1],ids[2]]=[ids[2],ids[1]];for(const n of ids){if(!Number.isInteger(n)||!vs[n])throw Error('Invalid 3MF triangle index.');const v=vs[n];if(![v.x,v.y,v.z].every(Number.isFinite))throw Error('Invalid 3MF coordinate.');out.set([v.x,v.y,v.z],i);i+=3;}}if(out.length)parts.push(out);}
  for(const c of children(children(o,'components')[0],'component')){const ref=Array.from(c.attributes).find(a=>a.localName==='path')?.value;const next=ref?cleanPath(ref.startsWith('/')?ref:file.slice(0,file.lastIndexOf('/')+1)+ref):file;visit(next,c.getAttribute('objectid'),matrix.clone().multiply(transform(c,m.scale)),[...stack,key]);}
 }
 const m=models.get(primary);for(const item of children(children(m.root,'build')[0],'item')){if(item.getAttribute('printable')==='0')continue;const ref=Array.from(item.attributes).find(a=>a.localName==='path')?.value;visit(ref?cleanPath(ref):primary,item.getAttribute('objectid'),transform(item,m.scale));}
 if(!parts.length)throw Error('3MF build contains no triangle solids. Beam lattices and slice-only packages must be exported as meshes.');return {parts,unit:'meter',sourceUp:'Z'};
}
