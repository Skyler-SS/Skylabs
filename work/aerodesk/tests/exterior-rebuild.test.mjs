import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {rebuildExterior, wrapSettings, shellField, distanceTransform, floodExterior, SEAL_PRESETS} from '../src/exterior-rebuild.mjs';
import {cleanMesh} from '../src/clean-mesh.mjs';

const load = async () => {
  const m = await import(pathToFileURL(path.resolve('vendor/manifold.mjs')).href);
  const api = await m.default({wasmBinary: fs.readFileSync(path.resolve('vendor/manifold.wasm'))});
  api.setup();
  return api;
};

const soup = g => g.toNonIndexed().attributes.position.array;
const box = () => soup(new T.BoxGeometry(1, .7, .5));
const sphere = () => soup(new T.SphereGeometry(.5, 64, 40));

// A slab tessellated on a grid, optionally with circular holes drilled through the top
// and bottom faces. The hole walls are deliberately not modelled, so each hole leaves two
// open rims — what a fastener hole looks like once the part is exported loose.
function plate({sx = 1, sy = .08, sz = .4, step = .02, holes = [], holeRadius = .03, shift = 0, drillAxis = 'y'} = {}) {
  const out = [];
  const quad = (a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  const inHole = (u, v) => holes.some(([a, b]) => Math.hypot(u - a, v - b) < holeRadius);
  const nx = Math.round(sx / step), nz = Math.round(sz / step), ny = Math.max(1, Math.round(sy / step));
  const X = i => -sx / 2 + i * sx / nx + shift, Z = k => -sz / 2 + k * sz / nz, Y = j => -sy / 2 + j * sy / ny;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const x0 = X(i), x1 = X(i + 1), z0 = Z(k), z1 = Z(k + 1);
    if (drillAxis === 'y' && inHole((x0 + x1) / 2 - shift, (z0 + z1) / 2)) continue;
    quad([x0, sy / 2, z0], [x1, sy / 2, z0], [x1, sy / 2, z1], [x0, sy / 2, z1]);
    quad([x0, -sy / 2, z0], [x0, -sy / 2, z1], [x1, -sy / 2, z1], [x1, -sy / 2, z0]);
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const x0 = X(i), x1 = X(i + 1), y0 = Y(j), y1 = Y(j + 1);
    quad([x0, y0, -sz / 2], [x0, y1, -sz / 2], [x1, y1, -sz / 2], [x1, y0, -sz / 2]);
    quad([x0, y0, sz / 2], [x1, y0, sz / 2], [x1, y1, sz / 2], [x0, y1, sz / 2]);
  }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const z0 = Z(k), z1 = Z(k + 1), y0 = Y(j), y1 = Y(j + 1);
    // Only the -X face is opened, so a ray along +X exits once without entering.
    if (!(drillAxis === 'x' && inHole((y0 + y1) / 2, (z0 + z1) / 2)))
      quad([X(0), y0, z0], [X(0), y0, z1], [X(0), y1, z1], [X(0), y1, z0]);
    quad([X(nx), y0, z0], [X(nx), y1, z0], [X(nx), y1, z1], [X(nx), y0, z1]);
  }
  return new Float32Array(out);
}
const drilled = extra => plate({holes: [[-.3, 0], [0, .1], [.3, -.1]], holeRadius: .03, ...extra});
// A pocket opening on one end face. Rays along parity's own direction cross the surface
// an odd number of times here, which is the condition parity cannot resolve.
const pocket = () => plate({holes: [[0, 0]], holeRadius: .03, drillAxis: 'x'});

function extent(v) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i++) { lo[i % 3] = Math.min(lo[i % 3], v[i]); hi[i % 3] = Math.max(hi[i % 3], v[i]); }
  return {lo, hi};
}

// Hole diameter is .06 and the plate's longest side is 1, so at 128 cells a hole spans
// 7.7 cells and needs a seal radius above 3.9 cells to close. aggressive gives 3.84 at
// 128, so these tests ask for a little more.
const SEAL_OVER_HOLES = .04;

test('settings accept a bare resolution for the original positional call', () => {
  assert.equal(wrapSettings(48).resolution, 48);
  assert.equal(wrapSettings(48).mode, 'auto');
  assert.equal(wrapSettings().resolution, 384);
  assert.equal(wrapSettings().sealFraction, SEAL_PRESETS.standard);
  assert.throws(() => wrapSettings({resolution: 12}), /between 32 and 640/);
  assert.throws(() => wrapSettings({sealFraction: .5}), /between 0 and 10%/);
  assert.throws(() => wrapSettings({mode: 'magic'}), /Unknown exterior rebuild mode/);
});

test('squared distance transform matches brute force', () => {
  const nx = 7, ny = 6, nz = 5, mask = new Uint8Array(nx * ny * nz);
  const seeds = [[1, 1, 1], [5, 4, 3], [0, 5, 0]];
  for (const [x, y, z] of seeds) mask[x + nx * (y + ny * z)] = 1;
  const d = distanceTransform(mask, nx, ny, nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const best = Math.min(...seeds.map(([a, b, c]) => (x - a) ** 2 + (y - b) ** 2 + (z - c) ** 2));
    assert.equal(d[x + nx * (y + ny * z)], best, `at ${x},${y},${z}`);
  }
});

test('exterior fill reaches around a shell but not inside it', () => {
  const n = 9, blocked = new Uint8Array(n * n * n);
  const at = (x, y, z) => x + n * (y + n * z);
  for (let z = 3; z <= 5; z++) for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++)
    if (x === 3 || x === 5 || y === 3 || y === 5 || z === 3 || z === 5) blocked[at(x, y, z)] = 1;
  const outside = floodExterior(blocked, n, n, n);
  assert.equal(outside[at(0, 0, 0)], 1, 'corner must be outside');
  assert.equal(outside[at(4, 4, 4)], 0, 'shell centre must not be reachable');
  assert.equal(outside[at(4, 4, 2)], 1, 'just outside the shell is reachable');
});

test('dominant-axis shell voxelization blocks every straight path through a face', () => {
  const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const nx = 60, ny = 60, nz = 60;
  const {shell, marked} = shellField(quad, {nx, ny, nz, h: .05, origin: [-1.5, -1.5, -1.5]});
  assert.ok(marked > 1000, 'expected a populated shell, got ' + marked);
  let gaps = 0;
  for (let y = 12; y < 48; y++) for (let x = 12; x < 48; x++) {
    let hit = false;
    for (let z = 0; z < nz; z++) if (shell[x + nx * (y + ny * z)]) { hit = true; break; }
    if (!hit) gaps++;
  }
  assert.equal(gaps, 0, 'shell leaked on ' + gaps + ' columns');
});

test('dilating the shell by one cell makes a closed surface leak-proof', () => {
  // Dominant-axis scan conversion can leave diagonal pinholes, which is exactly why wrap
  // always dilates by at least one cell before filling. Check both halves of that claim.
  const nx = 73, ny = 73, nz = 73, h = 1 / 64, origin = [-.5625, -.5625, -.5625];
  const {shell} = shellField(sphere(), {nx, ny, nz, h, origin});
  const centre = Math.round(.5625 / h) * (1 + nx + nx * ny);
  const dilated = new Uint8Array(nx * ny * nz), d = distanceTransform(shell, nx, ny, nz);
  for (let i = 0; i < dilated.length; i++) if (d[i] <= 1) dilated[i] = 1;
  const outside = floodExterior(dilated, nx, ny, nz);
  assert.equal(outside[centre], 0, 'a closed sphere must not leak once dilated');
  assert.equal(outside[0], 1, 'the padded corner must be outside');
  let enclosed = 0;
  for (let i = 0; i < outside.length; i++) if (!outside[i] && !dilated[i]) enclosed++;
  assert.ok(enclosed > 10000, 'the sphere interior should be enclosed, got ' + enclosed);
});

test('parity mode rebuilds a clean closed model and refuses an open one', async () => {
  const r = await rebuildExterior(box(), load, {mode: 'parity', resolution: 64});
  assert.equal(r.method, 'parity');
  assert.equal(r.sealCells, 0, 'parity does not seal anything');
  assert.equal(cleanMesh(r.vertices).report.ready, true);
  await assert.rejects(
    () => rebuildExterior(pocket(), load, {mode: 'parity', resolution: 128}),
    /Close the large openings in CAD first, or turn on Seal openings/);
});

test('wrap closes fastener holes that leave the surface open', async () => {
  const holed = drilled();
  const before = cleanMesh(holed).report;
  assert.equal(before.ready, false, 'fixture must start unusable');
  assert.ok(before.boundaryEdges > 0, 'fixture must start with open edges');

  const r = await rebuildExterior(holed, load, {mode: 'wrap', resolution: 128, sealFraction: SEAL_OVER_HOLES});
  assert.equal(r.method, 'wrap');
  const after = cleanMesh(r.vertices).report;
  assert.equal(after.ready, true, 'wrapped surface must pass geometry checks');
  assert.equal(after.boundaryEdges, 0, 'wrapped surface must be closed');
  assert.equal(after.components, 1);
  // Three holes, each leaving a rim on the top and the bottom face.
  assert.equal(r.sealedOpenings, 6, 'should report one patch per open rim');
  assert.ok(r.sealedSpan > 0 && r.sealedSpan < .1, 'sealed span should be hole-sized, got ' + r.sealedSpan);
  assert.ok(r.sealedArea > 0, 'should report the sealed area');
});

test('wrap reports nothing sealed when the model was already closed', async () => {
  const r = await rebuildExterior(plate(), load, {mode: 'wrap', resolution: 128, sealFraction: SEAL_PRESETS.standard});
  assert.equal(cleanMesh(r.vertices).report.ready, true);
  assert.equal(r.sealedOpenings, 0);
  assert.equal(r.sealedArea, 0);
});

test('auto mode falls back to wrap instead of dead-ending, and labels it', async () => {
  const r = await rebuildExterior(pocket(), load, {resolution: 128, sealFraction: SEAL_OVER_HOLES});
  assert.equal(r.method, 'wrap');
  assert.equal(r.automaticWrap, true);
  assert.match(r.parityError, /ray columns could not be resolved/);
  assert.equal(cleanMesh(r.vertices).report.ready, true);
});

test('auto mode keeps parity when the model is already clean', async () => {
  const r = await rebuildExterior(box(), load, {resolution: 64});
  assert.equal(r.method, 'parity');
  assert.equal(r.automaticWrap, false);
  assert.equal(r.sealedOpenings, 0);
});

test('wrap turns a soup of separate open shells into one closed surface', async () => {
  // Two overlapping drilled plates: separate components, both unclosed. This is the shape
  // of a real assembly export that defeats parity and a manifold boolean union alike.
  const a = drilled(), b = drilled({shift: .35});
  const both = new Float32Array(a.length + b.length);
  both.set(a); both.set(b, a.length);
  assert.ok(cleanMesh(both).report.components > 1, 'fixture should start as several components');
  const r = await rebuildExterior(both, load, {mode: 'wrap', resolution: 128, sealFraction: SEAL_OVER_HOLES});
  const after = cleanMesh(r.vertices).report;
  assert.equal(after.ready, true);
  assert.equal(after.components, 1, 'wrap must merge the soup into one exterior');
  assert.equal(after.boundaryEdges, 0);
});

test('closing preserves outer dimensions within the seal radius', async () => {
  const closed = plate(), before = extent(closed);
  const r = await rebuildExterior(closed, load, {mode: 'wrap', resolution: 128, sealFraction: SEAL_PRESETS.light});
  const after = extent(r.vertices), tolerance = r.spacing * (r.sealCells + 3);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(after.lo[k] - before.lo[k]) < tolerance, `low side drifted on axis ${k}`);
    assert.ok(Math.abs(after.hi[k] - before.hi[k]) < tolerance, `high side drifted on axis ${k}`);
  }
});

test('an opening wider than the seal radius is refused, not silently bridged', async () => {
  await assert.rejects(
    () => rebuildExterior(drilled(), load, {mode: 'wrap', resolution: 128, sealFraction: SEAL_PRESETS.light}),
    /openings are wider than the seal size/);
});

test('a surface too detailed for the triangle budget is coarsened, never torn open', async () => {
  // Regression: reducing the output by decimating the mesh welds vertices and rips the
  // surface apart - 2900 components and 1200 open edges on a real assembly. Only reducing
  // the field resolution keeps marching tetrahedra watertight by construction.
  const r = await rebuildExterior(drilled(), load, {mode: 'wrap', resolution: 512, sealFraction: SEAL_OVER_HOLES});
  const after = cleanMesh(r.vertices).report;
  assert.ok(after.outputFaces <= 200000, 'must respect the downstream triangle cap, got ' + after.outputFaces);
  assert.equal(after.ready, true);
  assert.equal(after.boundaryEdges, 0, 'reduction must not open the surface');
  assert.equal(after.nonManifoldEdges, 0);
  assert.equal(after.components, 1);
  if (r.resolution < 512) {
    assert.equal(r.reducedDetail, 512, 'a reduction must be reported, not silent');
    assert.ok(r.resolution >= 64, 'should not collapse to the coarsest grid, got ' + r.resolution);
  }
});

test('seal size scales with detail so the same fraction seals the same real opening', async () => {
  for (const resolution of [96, 128]) {
    const r = await rebuildExterior(drilled(), load, {mode: 'wrap', resolution, sealFraction: SEAL_OVER_HOLES});
    assert.equal(cleanMesh(r.vertices).report.ready, true, 'failed at resolution ' + resolution);
    assert.ok(Math.abs(r.sealCells / resolution - SEAL_OVER_HOLES) < 1e-9, 'seal fraction should be detail-independent');
  }
});
