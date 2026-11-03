import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {decimateVertices, decimateParts, triangleCount, DECIMATE_TARGET_TRIANGLES} from '../src/decimate.mjs';

const soup = g => g.toNonIndexed().attributes.position.array;
const sphere = (w = 200, h = 140) => soup(new T.SphereGeometry(.5, w, h));

function extent(v) {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) {
    if (v[i + k] < min[k]) min[k] = v[i + k];
    if (v[i + k] > max[k]) max[k] = v[i + k];
  }
  return {min, max};
}

test('a model already under the target is returned untouched', () => {
  const small = soup(new T.BoxGeometry(1, 1, 1));
  const r = decimateVertices(small, DECIMATE_TARGET_TRIANGLES);
  assert.equal(r.reduced, false);
  assert.equal(r.to, 12);
  assert.equal(r.vertices, small, 'should be the same array, not a copy');
});

test('a dense mesh is reduced to within the requested target', () => {
  const dense = sphere();
  const before = triangleCount(dense);
  assert.ok(before > 50000, 'fixture should be dense, got ' + before);
  for (const target of [20000, 5000, 1000]) {
    const r = decimateVertices(dense, target);
    assert.equal(r.reduced, true);
    assert.ok(r.to <= target, `got ${r.to} for target ${target}`);
    assert.ok(r.to > 0, 'decimation must not empty the model');
    assert.equal(r.from, before);
    assert.equal(r.vertices.length % 9, 0, 'output must be whole triangles');
  }
});

test('a target the first estimate narrowly overshoots still yields a usable mesh', () => {
  // Regression: the search used to rescale the grid by a ratio, which rounds back to
  // the same resolution when the count is only slightly over target. It then gave up
  // having found nothing and fell back to the coarsest grid, returning ~100 triangles
  // for a 2M-triangle model. The result must use a real share of the budget.
  const dense = sphere();
  const target = Math.round(triangleCount(dense) / 12); // lands just over on first pass
  const r = decimateVertices(dense, target);
  assert.ok(r.to <= target, `got ${r.to} for target ${target}`);
  assert.ok(r.to >= target * 0.5, `collapsed to ${r.to}, expected near ${target}`);
  assert.ok(r.grid > 8, 'should not fall back to the minimum grid, got ' + r.grid);
});

test('decimation preserves overall size and position', () => {
  const dense = sphere();
  const before = extent(dense);
  const after = extent(decimateVertices(dense, 4000).vertices);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(after.min[k] - before.min[k]) < .05, 'min drifted on axis ' + k);
    assert.ok(Math.abs(after.max[k] - before.max[k]) < .05, 'max drifted on axis ' + k);
  }
});

test('decimation keeps triangle winding, so outward normals survive', () => {
  // A sphere centred on the origin: every face normal should point away from centre.
  const r = decimateVertices(sphere(), 3000);
  const v = r.vertices;
  let outward = 0, total = 0;
  for (let i = 0; i < v.length; i += 9) {
    const ax = v[i + 3] - v[i], ay = v[i + 4] - v[i + 1], az = v[i + 5] - v[i + 2];
    const bx = v[i + 6] - v[i], by = v[i + 7] - v[i + 1], bz = v[i + 8] - v[i + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const cx = (v[i] + v[i + 3] + v[i + 6]) / 3, cy = (v[i + 1] + v[i + 4] + v[i + 7]) / 3, cz = (v[i + 2] + v[i + 5] + v[i + 8]) / 3;
    if (nx * cx + ny * cy + nz * cz > 0) outward++;
    total++;
  }
  assert.ok(outward / total > .95, `only ${outward}/${total} faces kept outward winding`);
});

test('degenerate slivers produced by clustering are dropped, not emitted', () => {
  const r = decimateVertices(sphere(), 2000);
  const v = r.vertices;
  for (let i = 0; i < v.length; i += 9) {
    const same = (a, b) => v[i + a] === v[i + b] && v[i + a + 1] === v[i + b + 1] && v[i + a + 2] === v[i + b + 2];
    assert.ok(!same(0, 3) && !same(3, 6) && !same(0, 6), 'emitted a collapsed triangle at ' + i);
  }
});

test('flat and degenerate-bounds input does not hang or divide by zero', () => {
  // All vertices coplanar, zero extent on one axis.
  const flat = [];
  for (let i = 0; i < 900; i++) flat.push(i % 10, (i * 7) % 10, 0, (i % 10) + 1, (i * 7) % 10, 0, i % 10, ((i * 7) % 10) + 1, 0);
  const r = decimateVertices(new Float32Array(flat), 50);
  assert.ok(r.to <= 50);
  assert.equal(r.vertices.length % 9, 0);
});

test('rejects malformed input instead of producing corrupt geometry', () => {
  assert.throws(() => decimateVertices(new Float32Array(10), 100), /whole triangles/);
  assert.throws(() => decimateVertices(null, 100), /triangle vertex data/);
  // Coordinates are only inspected on the decimation path, so make it actually decimate.
  const withNaN = new Float32Array(10 * 9).map((_, i) => i % 7);
  withNaN[13] = NaN;
  assert.throws(() => decimateVertices(withNaN, 4), /invalid coordinates/);
  assert.throws(() => decimateVertices(sphere(), 2), /at least 4 triangles/);
});

test('multi-solid parts share the budget and stay under it in total', () => {
  const parts = [sphere(120, 90), soup(new T.BoxGeometry(1, 1, 1)), sphere(80, 60)];
  const before = parts.reduce((s, p) => s + triangleCount(p), 0);
  const r = decimateParts(parts, 5000);
  assert.equal(r.reduced, true);
  assert.equal(r.from, before);
  assert.ok(r.to <= 5000, 'total ' + r.to + ' exceeded budget');
  assert.equal(r.parts.length, 3);
  for (const p of r.parts) assert.ok(triangleCount(p) > 0, 'a part was emptied');
});

test('parts already under budget are left alone', () => {
  const parts = [soup(new T.BoxGeometry(1, 1, 1)), soup(new T.BoxGeometry(2, 2, 2))];
  const r = decimateParts(parts, 10000);
  assert.equal(r.reduced, false);
  assert.equal(r.parts, parts);
});
