import test from 'node:test';import assert from 'node:assert/strict';import packaging from '../package.cjs';
test('release includes runtime assets and replaceable CAD libraries, excluding local/development data',()=>{
 for(const name of ['/main.cjs','/dist/app.js','/vendor/occt-import-js.wasm','/vendor/licenses/LICENSE_LGPL_21.txt','/fusion/AeroDeskLink.py','/gpu-runtime/gpu-run.sh','/LICENSE','/package.json'])assert.equal(packaging.ignore(name),false,name);
 for(const name of ['/node_modules/electron/index.js','/tests/package.test.mjs','/src/app.js','/check-astra.mjs','/.env','/vendor/.env.local','/credentials.json','/package-lock.json','/build.cjs','/package.cjs'])assert.equal(packaging.ignore(name),true,name);
});
