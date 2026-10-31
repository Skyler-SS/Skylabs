import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const {register}=createRequire(import.meta.url)('../connections.cjs');
test('AI verifies a key, persists encrypted bytes, sends only supplied evidence and handles quota errors',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aerodesk-connections-')),handlers=new Map(),oldFetch=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
 register({app:{getPath:()=>dir},ipcMain:{handle:(n,f)=>handlers.set(n,f)},safeStorage:{encryptStringAsync:async s=>Buffer.from('encrypted:'+Buffer.from(s).toString('base64')),decryptStringAsync:async b=>Buffer.from(b.toString().slice(10),'base64').toString()},shell:{openExternal:async()=>{}}});
 const call=(n,v)=>handlers.get(n)(null,v);let request;
 try{globalThis.fetch=async(url,options)=>{request={url,options};return {ok:true,json:async()=>url.endsWith('/models')?{data:[{id:'gpt-test'},{id:'embedding-test'}]}:{model:'gpt-test',output:[{content:[{type:'output_text',text:'Check region D1.'}]}]}};};
 assert.equal((await call('ai-status')).connected,false);const key='test-key-no-real-credential-123456';assert.deepEqual((await call('ai-connect',key)).models,['gpt-test']);assert.ok(!(await fs.readFile(path.join(dir,'ai-key.bin'),'utf8')).includes(key));assert.equal((await call('ai-status')).connected,true);
 const evidence={spatial:{drag:[{id:'D1',dragN:2}]}};assert.equal((await call('ai-review',{model:'gpt-test',evidence})).text,'Check region D1.');const body=JSON.parse(request.options.body);assert.equal(body.store,false);assert.deepEqual(JSON.parse(body.input),evidence);assert.equal(request.url,'https://api.openai.com/v1/responses');assert.ok(!body.input.includes(key));
 globalThis.fetch=async()=>({ok:false,status:429});await assert.rejects(call('ai-models'),/quota/);await call('ai-disconnect');assert.equal((await call('ai-status')).connected,false);
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;await fs.rm(dir,{recursive:true,force:true});}
});
