// Import-time mesh decimation.
//
// Large CAD exports routinely carry millions of triangles. The solver pipeline is
// capped at 200,000 (see clean-mesh.mjs and installGeometry), and surface tessellation
// density well past that does not improve an external-flow answer: the volume mesh
// resolution does. So instead of rejecting a big file, reduce it on import.
//
// Grid vertex clustering is used rather than quadric edge collapse because it is O(n),
// needs no connectivity, and tolerates the non-manifold, self-intersecting, duplicated
// geometry that real CAD exports contain. Triangle winding is preserved, so the cleanup
// report and orientation checks downstream still mean what they did before.
//
// Cell ids are packed into plain numbers, never strings: at these vertex counts a
// string-keyed Map is pathologically slow.

export const DECIMATE_TARGET_TRIANGLES = 180000;
const MIN_GRID = 4;
const MAX_GRID = 1024;
const MAX_PASSES = 6;

export function triangleCount(vertices) {
  return Math.floor((vertices?.length || 0) / 9);
}

function assertTriangleSoup(vertices) {
  if (!vertices || typeof vertices.length !== 'number') throw Error('Decimation needs triangle vertex data.');
  if (vertices.length % 9) throw Error('Decimation needs whole triangles (9 numbers each).');
}

function bounds(v) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw Error('The model contains invalid coordinates.');
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

// Total surface area, used only to pick a sensible starting grid resolution.
function surfaceArea(v) {
  let area = 0;
  for (let i = 0; i < v.length; i += 9) {
    const ax = v[i + 3] - v[i], ay = v[i + 4] - v[i + 1], az = v[i + 5] - v[i + 2];
    const bx = v[i + 6] - v[i], by = v[i + 7] - v[i + 1], bz = v[i + 8] - v[i + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    area += Math.hypot(cx, cy, cz) / 2;
  }
  return area;
}

// One clustering pass at grid resolution n across the longest axis.
function clusterPass(v, n, b) {
  const spanX = b.maxX - b.minX, spanY = b.maxY - b.minY, spanZ = b.maxZ - b.minZ;
  const span = Math.max(spanX, spanY, spanZ, 1e-12);
  const cell = span / n;
  const nx = Math.max(1, Math.min(n, Math.ceil(spanX / cell) || 1));
  const ny = Math.max(1, Math.min(n, Math.ceil(spanY / cell) || 1));
  const nz = Math.max(1, Math.min(n, Math.ceil(spanZ / cell) || 1));

  const vertexCount = v.length / 3;
  const ids = new Int32Array(vertexCount);
  const index = new Map();
  const sumX = [], sumY = [], sumZ = [], hits = [];

  for (let i = 0, p = 0; i < v.length; i += 3, p++) {
    let ix = Math.floor((v[i] - b.minX) / cell);
    let iy = Math.floor((v[i + 1] - b.minY) / cell);
    let iz = Math.floor((v[i + 2] - b.minZ) / cell);
    if (ix < 0) ix = 0; if (ix >= nx) ix = nx - 1;
    if (iy < 0) iy = 0; if (iy >= ny) iy = ny - 1;
    if (iz < 0) iz = 0; if (iz >= nz) iz = nz - 1;
    const key = (iz * ny + iy) * nx + ix;
    let c = index.get(key);
    if (c === undefined) {
      c = hits.length;
      index.set(key, c);
      sumX.push(0); sumY.push(0); sumZ.push(0); hits.push(0);
    }
    sumX[c] += v[i]; sumY[c] += v[i + 1]; sumZ[c] += v[i + 2]; hits[c]++;
    ids[p] = c;
  }

  // Representative = centroid of the cell's vertices. Holds the surface closer to the
  // original than snapping to cell centres would.
  const reps = new Float32Array(hits.length * 3);
  for (let c = 0; c < hits.length; c++) {
    reps[c * 3] = sumX[c] / hits[c];
    reps[c * 3 + 1] = sumY[c] / hits[c];
    reps[c * 3 + 2] = sumZ[c] / hits[c];
  }

  const triangles = vertexCount / 3;
  const clusters = hits.length;
  const keep = new Uint8Array(triangles);
  // Many source triangles collapse onto the same cell triple. Emitting all of them
  // would leave the output full of coincident faces and defeat the reduction, so keep
  // the first of each. Rotation is canonical but order-preserving, so an opposite-wound
  // duplicate stays distinct and is still reported by the downstream cleanup checks.
  const seen = new Map();
  let kept = 0;
  for (let t = 0; t < triangles; t++) {
    const a = ids[t * 3], b2 = ids[t * 3 + 1], c2 = ids[t * 3 + 2];
    if (a === b2 || b2 === c2 || a === c2) continue; // collapsed to a sliver, drop it
    let x = a, y = b2, z = c2;
    if (y < x && y <= z) { x = b2; y = c2; z = a; }
    else if (z < x && z <= y) { x = c2; y = a; z = b2; }
    let bucket = seen.get(x);
    if (bucket === undefined) { bucket = new Set(); seen.set(x, bucket); }
    const key = y * clusters + z;
    if (bucket.has(key)) continue;
    bucket.add(key);
    keep[t] = 1;
    kept++;
  }

  const out = new Float32Array(kept * 9);
  let o = 0;
  for (let t = 0; t < triangles; t++) {
    if (!keep[t]) continue;
    const a = ids[t * 3], b2 = ids[t * 3 + 1], c2 = ids[t * 3 + 2];
    out[o++] = reps[a * 3]; out[o++] = reps[a * 3 + 1]; out[o++] = reps[a * 3 + 2];
    out[o++] = reps[b2 * 3]; out[o++] = reps[b2 * 3 + 1]; out[o++] = reps[b2 * 3 + 2];
    out[o++] = reps[c2 * 3]; out[o++] = reps[c2 * 3 + 1]; out[o++] = reps[c2 * 3 + 2];
  }
  return out;
}

// Pick a starting resolution from surface area: occupied cells scale with A/cell^2, and
// a closed surface yields roughly two triangles per occupied cell.
function initialGrid(v, b, target) {
  const spanX = b.maxX - b.minX, spanY = b.maxY - b.minY, spanZ = b.maxZ - b.minZ;
  const span = Math.max(spanX, spanY, spanZ, 1e-12);
  const area = surfaceArea(v);
  if (!(area > 0)) return MIN_GRID;
  const n = span * Math.sqrt(target / (2 * area));
  return Math.max(MIN_GRID, Math.min(MAX_GRID, Math.round(n)));
}

/**
 * Reduce a triangle soup to at most `target` triangles.
 * Returns the original array untouched when it already fits.
 */
export function decimateVertices(vertices, target = DECIMATE_TARGET_TRIANGLES) {
  assertTriangleSoup(vertices);
  const from = triangleCount(vertices);
  if (!(target >= 4)) throw Error('Decimation target must be at least 4 triangles.');
  if (from <= target) return { vertices, from, to: from, reduced: false, grid: 0 };

  const b = bounds(vertices);
  let n = initialGrid(vertices, b, target);
  let best = null, bestGrid = 0;
  // Triangle count rises monotonically with grid resolution, so bracket the target and
  // bisect. A pure ratio rescale cannot be used alone: near the target it rounds back
  // to the same resolution and the search stalls before finding any valid result.
  let under = null;  // largest n known to land within target
  let over = null;   // smallest n known to exceed target

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const out = clusterPass(vertices, n, b);
    const count = out.length / 9;
    let next;
    if (count <= target) {
      if (!best || count > best.length / 9) { best = out; bestGrid = n; }
      under = n;
      if (count >= target * 0.7) break;          // using enough of the budget, stop
      if (over !== null && over - n <= 1) break; // bracketed as tightly as it goes
      next = over === null
        ? Math.min(MAX_GRID, Math.max(n + 1, Math.round(n * 1.4)))
        : Math.floor((n + over) / 2);
    } else {
      over = n;
      if (under !== null && n - under <= 1) break;
      next = under === null
        ? Math.max(MIN_GRID, Math.min(n - 1, Math.round(n * 0.7)))
        : Math.floor((under + n) / 2);
      if (next >= n) next = n - 1;
    }
    next = Math.max(MIN_GRID, Math.min(MAX_GRID, next));
    if (next === n) break;
    n = next;
  }

  // Only reachable if even the coarsest grid overshoots, which needs a pathological mesh.
  if (!best) { best = clusterPass(vertices, MIN_GRID, b); bestGrid = MIN_GRID; }
  return { vertices: best, from, to: best.length / 9, reduced: true, grid: bestGrid };
}

/**
 * Decimate a multi-solid model, splitting the budget across parts by their share of the
 * triangles so one dense part cannot starve the rest.
 */
export function decimateParts(parts, target = DECIMATE_TARGET_TRIANGLES) {
  if (!Array.isArray(parts) || !parts.length) return { parts, from: 0, to: 0, reduced: false };
  const counts = parts.map(triangleCount);
  const from = counts.reduce((s, c) => s + c, 0);
  if (from <= target) return { parts, from, to: from, reduced: false };
  const out = parts.map((p, i) => {
    const share = Math.max(4, Math.floor(target * (counts[i] / from)));
    return decimateVertices(p, share).vertices;
  });
  return { parts: out, from, to: out.reduce((s, p) => s + triangleCount(p), 0), reduced: true };
}
