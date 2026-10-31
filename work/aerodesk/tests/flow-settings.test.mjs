import test from 'node:test';
import assert from 'node:assert/strict';
import {reynoldsNumber,speedForReynolds} from '../src/flow-settings.mjs';

test('setting Reynolds changes velocity consistently with physical length and viscosity',()=>{
  const speed=speedForReynolds(1e6,1,1.5e-5);
  assert.equal(speed,15);
  assert.equal(reynoldsNumber({speed,length:1,nu:1.5e-5}),1e6);
  assert.equal(speedForReynolds(1e6,2,1.5e-5),7.5);
  assert.equal(speedForReynolds(1e6,1,3e-5),30);
});
test('impossible or invalid Reynolds inputs are rejected rather than silently clamped',()=>{
  for(const re of [0,-1,NaN,Infinity,1,1e9])assert.throws(()=>speedForReynolds(re,1,1.5e-5));
  assert.throws(()=>speedForReynolds(1e6,0,1.5e-5));
  assert.throws(()=>speedForReynolds(1e6,1,0));
});
