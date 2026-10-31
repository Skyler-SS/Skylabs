import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import onshape from '../onshape.cjs';
const link='https://cad.onshape.com/documents/012345678901234567890123/w/012345678901234567890124/e/012345678901234567890125';
const keys={access:'test-access',secret:'test-secret'};
test('document browsing encodes search and returns only safe Part Studio metadata',async()=>{
 const k={...keys,origin:'https://cad.onshape.com'},id='012345678901234567890123',wid='012345678901234567890124';let called;
 const list=await onshape.browse(k,{query:'wing & tail',offset:20},async url=>{called=new URL(url);return new Response(JSON.stringify({items:[{id,name:'Wing',secret:'not exposed'}],next:'untrusted'}));});assert.equal(called.searchParams.get('q'),'wing & tail');assert.equal(called.searchParams.get('offset'),'20');assert.deepEqual(Object.keys(list.items[0]),['id','name']);assert.equal(list.more,true);
 const r=await onshape.browse(k,{kind:'elements',document:id,workspace:wid},async()=>new Response(JSON.stringify([{id,name:'Plane',elementType:'PARTSTUDIO'},{id,name:'Assembly',elementType:'ASSEMBLY'}])));assert.equal(r.items.length,1);assert.equal(onshape.parseLink(r.items[0].link).workspace,true);
 await assert.rejects(()=>onshape.browse(k,{kind:'elements',document:'../bad',workspace:wid}),/valid document/);
});
test('Parse document links and preserve configuration with correct encoding',()=>{
  const target=onshape.parseLink(link+'?configuration=Length%3D20%2Bmm');const u=new URL(target.url);
  assert.equal(u.searchParams.get('configuration'),'Length=20+mm');assert.equal(u.searchParams.get('units'),'meter');assert.ok(u.pathname.includes('/partstudios/d/'));assert.equal(target.workspace,true);
  for(const v of ['https://evil.com',link.replace('cad.onshape.com','cad.onshape.com.evil.com'),link.replace('https:','http:'),link.replace('/e/','/x/'),'https://user:pass@cad.onshape.com/documents/x'])assert.throws(()=>onshape.parseLink(v));
});
test('selected solid exports in meters with explicit tessellation and survives refresh',()=>{
 const u=onshape.parseLink(link+'?aerodeskPart=a%2Fb%2Bc'),target=new URL(u.url);
 assert.ok(target.pathname.includes('/partid/a%2Fb%2Bc/stl'));assert.equal(target.searchParams.get('units'),'meter');assert.equal(target.searchParams.get('chordTolerance'),'0.0001');assert.equal(onshape.parseLink(u.link).url,u.url);
});
test('Signature matches documented canonical string and never contains secret',()=>{
  const url=onshape.parseLink(link).url,u=new URL(url),nonce='0123456789abcdef',date='Mon, 26 Oct 2026 12:00:00 GMT';
  const canonical=`get\n${nonce}\n${date.toLowerCase()}\napplication/json\n${u.pathname.toLowerCase()}\n${u.search.slice(1).toLowerCase()}\n`;
  const expected=crypto.createHmac('sha256',keys.secret).update(canonical).digest('base64'),headers=onshape.sign(url,keys,nonce,date);
  assert.equal(headers.Authorization,'On test-access:HmacSHA256:'+expected);assert.ok(!JSON.stringify(headers).includes(keys.secret));
});
test('STL redirects are re-signed and binary bytes survive',async()=>{
  const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});return calls.length===1?new Response(null,{status:307,headers:{location:'https://cad.onshape.com/api/download/test?token=CaseSensitive'}}):new Response(new Uint8Array([0,1,128,255]));};
  const bytes=await onshape.request(onshape.parseLink(link).url,keys,fetcher);assert.deepEqual([...bytes],[0,1,128,255]);assert.equal(calls.length,2);assert.notEqual(calls[0].options.headers.Authorization,calls[1].options.headers.Authorization);assert.equal(calls[1].url,'https://cad.onshape.com/api/download/test?token=CaseSensitive');
});
test('Do not send credentials outside Onshape; handle API errors clearly',async()=>{
  let calls=0;await assert.rejects(()=>onshape.request(onshape.parseLink(link).url,keys,async()=>{calls++;return new Response(null,{status:307,headers:{location:'https://attacker.example/file'}});}),/onshape.com/);assert.equal(calls,1);
  await assert.rejects(()=>onshape.request(onshape.parseLink(link).url,keys,async()=>new Response('',{status:401})),/rejected the API keys/);
});
