const crypto=require('node:crypto');
function trustedUrl(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||!/^([a-z0-9-]+\.)+onshape\.com$/i.test(u.hostname)||u.port||u.username||u.password)throw Error('Use an https://…onshape.com address.');
  return u;
}
function parseLink(value){
  const u=trustedUrl(value),m=u.pathname.match(/^\/documents\/([a-f0-9]{24})\/([wvm])\/([a-f0-9]{24})\/e\/([a-f0-9]{24})\/?$/i);
  if(!m)throw Error('Open your Part Studio tab in Onshape and paste its full address, including /e/ and the tab ID.');
  const query=new URLSearchParams({mode:'binary',units:'meter',grouping:'true',chordTolerance:'0.0001',angleTolerance:'0.15'});
  if(u.searchParams.has('configuration'))query.set('configuration',u.searchParams.get('configuration'));
  const part=u.searchParams.get('aerodeskPart');if(part&&(part.length>256||/[\x00-\x1f]/.test(part)))throw Error('Invalid selected part.');
  const route=part?'/parts/d/'+m[1]+'/'+m[2]+'/'+m[3]+'/e/'+m[4]+'/partid/'+encodeURIComponent(part)+'/stl':'/partstudios/d/'+m[1]+'/'+m[2]+'/'+m[3]+'/e/'+m[4]+'/stl';
  return {origin:u.origin,url:u.origin+'/api/v16'+route+'?'+query,element:m[4],workspace:m[2]==='w',link:u.href};
}
function sign(url,keys,nonce=crypto.randomBytes(16).toString('hex'),date=new Date().toUTCString()){
  const u=trustedUrl(url),type='application/json';
  const canonical=['GET',nonce,date,type,u.pathname,u.search.slice(1),''].join('\n').toLowerCase();
  const signature=crypto.createHmac('sha256',keys.secret).update(canonical).digest('base64');
  return {'Content-Type':type,Accept:'application/octet-stream, application/json','On-Nonce':nonce,Date:date,Authorization:'On '+keys.access+':HmacSHA256:'+signature};
}
async function request(url,keys,fetcher=fetch){
  for(let hops=0;hops<5;hops++){
    trustedUrl(url);
    const response=await fetcher(url,{method:'GET',headers:sign(url,keys),redirect:'manual',signal:AbortSignal.timeout(90000)});
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');if(!location)throw Error('Onshape returned a redirect without an address.');
      url=trustedUrl(new URL(location,url).href).href;continue;
    }
    if(!response.ok){if(response.status===400){let reason='';try{const body=await response.json();reason=String(body.message||body.error||'').slice(0,400);for(const secret of [keys.access,keys.secret])if(secret)reason=reason.replaceAll(secret,'[redacted]');}catch{}throw Error('Onshape could not export this Part Studio. '+reason);}const messages={401:'Onshape rejected the API keys. Check the keys and your PC clock.',403:'This key cannot read that document. Enable read-document access and check document permissions.',404:'Part Studio not found. Assemblies are not supported in this prototype.',429:'Onshape API limit reached. Please try again later.'};throw Error(messages[response.status]||'Onshape returned HTTP '+response.status+'. Check the Part Studio link.');}
    const reader=response.body.getReader(),chunks=[];let length=0;
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>512*1024*1024){await reader.cancel();throw Error('The export exceeds 512 MB. Simplify the model in Onshape.');}chunks.push(value);}
    return Buffer.concat(chunks);
  }
  throw Error('Onshape returned too many redirects.');
}
const validId=id=>typeof id==='string'&&/^[a-f0-9]{24}$/i.test(id);
async function browse(keys,input={},fetcher=fetch){
 const origin=trustedUrl(keys.origin).origin,kind=input.kind||'documents';let route;
 if(kind==='documents'){
   const offset=input.offset??0;if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw Error('Invalid page.');
   route='/documents?'+new URLSearchParams({limit:'20',offset:String(offset),q:String(input.query||'').slice(0,160),sortColumn:'modifiedAt',sortOrder:'desc'});
 }else{
   if(!validId(input.document))throw Error('Choose a valid document.');
   if(kind==='workspaces')route='/documents/'+input.document+'/workspaces';
   else if(kind==='elements'&&validId(input.workspace))route='/documents/d/'+input.document+'/w/'+input.workspace+'/elements';
   else if(kind==='parts'&&validId(input.workspace)&&validId(input.element))route='/parts/d/'+input.document+'/w/'+input.workspace+'/e/'+input.element;
   else throw Error('Choose a valid workspace.');
 }
 const data=JSON.parse((await request(origin+'/api/v16'+route,keys,fetcher)).toString());
 const list=Array.isArray(data)?data:data.items;if(!Array.isArray(list))throw Error('Onshape returned an unexpected document list.');
 const ELEMENT_KINDS={PARTSTUDIO:'partstudio',ASSEMBLY:'assembly'};
 const items=kind==='parts'?list.filter(x=>typeof x.partId==='string'&&x.partId.length<=256&&(!x.bodyType||x.bodyType==='solid'||x.bodyType==='SOLID')).map(x=>({id:x.partId,name:String(x.name||'Part').slice(0,250)})):list.filter(x=>validId(x.id)&&(kind!=='elements'||ELEMENT_KINDS[x.elementType])).map(x=>({id:x.id,name:String(x.name||'Untitled').slice(0,250),...(kind==='elements'?{kind:ELEMENT_KINDS[x.elementType],link:origin+'/documents/'+input.document+'/w/'+input.workspace+'/e/'+x.id}:{})}));
 return {items,more:kind==='documents'&&!!data.next,origin};
}
function materialValue(value){
 if(!value||typeof value!=='object')return null;
 const name=value.displayName||value.name||value.materialName;
 const props=Array.isArray(value.properties)?value.properties:[];
 const p=props.find(p=>/density|^dens$/i.test(p.name||p.propertyId||''));
 const raw=p?.value??value.density,units=String(p?.units||p?.unit||'kg/m^3');let density=Number(raw);
 if(/g\s*\/\s*cm/.test(units))density*=1000;else if(/kg\s*\/\s*mm/.test(units))density*=1e9;else if(!/kg\s*\/\s*m|kilogram.*meter/.test(units))density=NaN;
 if(typeof name!=='string'||!Number.isFinite(density)||density<.1||density>30000)return null;
 const properties={};for(const p of props){const v=Number(p.value);if(Number.isFinite(v)&&typeof p.displayName==='string')properties[p.displayName+(p.units?' · '+p.units:'')]=v;}
 return {name:name.slice(0,80),density,properties};
}
async function assignedMaterial(keys,link,fetcher=fetch){
 const target=parseLink(link),u=new URL(target.link);if(target.origin!==keys.origin)throw Error('Use the connected Onshape server.');
 const m=u.pathname.match(/\/documents\/([^/]+)\/([wvm])\/([^/]+)\/e\/([^/]+)/),query=new URLSearchParams();if(u.searchParams.has('configuration'))query.set('configuration',u.searchParams.get('configuration'));
 const pid=u.searchParams.get('aerodeskPart'),route='/metadata/d/'+m[1]+'/'+m[2]+'/'+m[3]+'/e/'+m[4]+'/p'+(pid?'/'+encodeURIComponent(pid):'');
 const data=JSON.parse((await request(target.origin+'/api/v16'+route+'?'+query,keys,fetcher)).toString()),items=Array.isArray(data)?data:data.items||[data];
 const materials=items.map(part=>{const property=(part.properties||[]).find(p=>/^material$/i.test(p.name||''));return materialValue(property?.value);});
 const assigned=materials.filter(Boolean);if(!assigned.length)return {material:null,message:'No assigned material with usable density was returned. Choose an Onshape preset below.'};
 const same=assigned.length===items.length&&assigned.every(m=>m.name===assigned[0].name&&Math.abs(m.density-assigned[0].density)<1e-6);
 return {material:same?assigned[0]:null,parts:items.length,assigned:assigned.length,message:same?'Assigned Onshape material · '+items.length+' part(s)':'Parts use different or missing materials. A single density cannot represent this assembly; enter measured CG and flying mass.'};
}

// --- Assemblies ------------------------------------------------------------------
// Assembly tabs expose their solved pose through occurrence transforms, so an
// assembly is imported as its individual parts plus those transforms rather than as
// one flattened export. Mate features come along in the same request.
function parseAssemblyLink(value){
  const u=trustedUrl(value),m=u.pathname.match(/^\/documents\/([a-f0-9]{24})\/([wvm])\/([a-f0-9]{24})\/e\/([a-f0-9]{24})\/?$/i);
  if(!m)throw Error('Open your Assembly tab in Onshape and paste its full address, including /e/ and the tab ID.');
  const query=new URLSearchParams({includeMateFeatures:'true',includeMateConnectors:'true',includeNonSolids:'false'});
  if(u.searchParams.has('configuration'))query.set('configuration',u.searchParams.get('configuration'));
  const route='/assemblies/d/'+m[1]+'/'+m[2]+'/'+m[3]+'/e/'+m[4];
  return {origin:u.origin,url:u.origin+'/api/v16'+route+'?'+query,document:m[1],wvm:m[2],wvmid:m[3],element:m[4],workspace:m[2]==='w',link:u.href};
}
// A part is addressed by the microversion its instance reports, so parts that live in
// linked documents resolve the same way as parts in this one.
function partStlUrl(origin,instance){
  const id=v=>typeof v==='string'&&/^[a-f0-9]{24}$/i.test(v);
  if(!id(instance.documentId)||!id(instance.elementId))throw Error('An assembly instance is missing its document or tab.');
  if(!id(instance.documentMicroversion))throw Error('An assembly instance is missing its microversion.');
  if(typeof instance.partId!=='string'||!instance.partId||instance.partId.length>256||/[ -]/.test(instance.partId))throw Error('An assembly instance has an unusable part id.');
  const query=new URLSearchParams({mode:'binary',units:'meter',chordTolerance:'0.0001',angleTolerance:'0.15'});
  if(instance.configuration)query.set('configuration',String(instance.configuration).slice(0,2000));
  return trustedUrl(origin+'/api/v16/parts/d/'+instance.documentId+'/m/'+instance.documentMicroversion+
    '/e/'+instance.elementId+'/partid/'+encodeURIComponent(instance.partId)+'/stl?'+query).href;
}
async function assemblyDefinition(keys,link,fetcher=fetch){
  const target=parseAssemblyLink(link);
  if(target.origin!==keys.origin)throw Error('This document uses a different Onshape server. Reconnect using a key from '+target.origin+'.');
  const body=(await request(target.url,keys,fetcher)).toString();
  let data;try{data=JSON.parse(body);}catch{throw Error('Onshape returned an unreadable assembly definition.');}
  return {definition:data,target};
}
module.exports={trustedUrl,parseLink,parseAssemblyLink,partStlUrl,assemblyDefinition,sign,request,browse,materialValue,assignedMaterial};

