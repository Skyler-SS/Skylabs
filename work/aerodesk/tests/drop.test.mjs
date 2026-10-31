import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseDroppedFile,MAX_MODEL_BYTES} from '../src/drop.mjs';
test('Accept a single STL or OBJ without relying on MIME types',()=>{
  for(const name of ['Car.STL','part.stl','assembly.obj']){const file={name,size:1234,type:''};assert.equal(chooseDroppedFile([file]),file);}
});
test('Reject ambiguous, oversized, empty, non-model and directory drops',()=>{
  const file={name:'part.stl',size:1};
  assert.throws(()=>chooseDroppedFile([]),/one/);assert.throws(()=>chooseDroppedFile([file,file]),/one/);
  assert.throws(()=>chooseDroppedFile([{name:'part.stl',size:MAX_MODEL_BYTES+1}]),/32 MB/);
  assert.throws(()=>chooseDroppedFile([{name:'part.stl',size:0}]),/empty/);
  for(const name of ['folder','link.url','mesh.stl.exe'])assert.throws(()=>chooseDroppedFile([{name,size:1}]),/STL or OBJ/);
});
test('Keep active runs and open dialogs protected from replacement',()=>{
  const files=[{name:'part.stl',size:1}];assert.throws(()=>chooseDroppedFile(files,true),/current import/);assert.throws(()=>chooseDroppedFile(files,false,true),/dialog/);
});
