const esbuild = require('esbuild');
const fs = require('node:fs');
fs.mkdirSync('vendor',{recursive:true});
// License texts are source-controlled; a clean clone must ship them too.
fs.cpSync('licenses','vendor/licenses',{recursive:true});
for(const [from,to] of [['occt-import-js/dist/occt-import-js.js','occt-import-js.cjs'],['occt-import-js/dist/occt-import-js.wasm','occt-import-js.wasm'],['manifold-3d/manifold.js','manifold.mjs'],['manifold-3d/manifold.wasm','manifold.wasm']])fs.copyFileSync('node_modules/'+from,'vendor/'+to);
fs.mkdirSync('dist', {recursive:true});
esbuild.buildSync({entryPoints:['src/model-worker.js'],bundle:true,outfile:'dist/model-worker.cjs',platform:'node',format:'cjs'});
esbuild.buildSync({entryPoints:['src/app.js'],bundle:true,outfile:'dist/app.js',format:'iife',minify:true});
esbuild.buildSync({entryPoints:['src/worker.js'],bundle:true,outfile:'dist/worker.js',format:'iife',minify:true});
esbuild.buildSync({entryPoints:['src/clean-worker.js'],bundle:true,outfile:'dist/clean-worker.js',format:'iife',minify:true});
for (const name of ['index.html','style.css','manual.html','mark.svg','icon-256.png']) fs.copyFileSync('src/'+name,'dist/'+name);
