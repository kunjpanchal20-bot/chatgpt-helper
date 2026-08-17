'use strict';
/* ============================================================
   Neon Bay — util.js
   Math, RNG, spatial hashing and small helpers used everywhere.
   ============================================================ */

const TAU = Math.PI * 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
const choice = (arr) => arr[(Math.random() * arr.length) | 0];
const chance = (p) => Math.random() < p;

const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** Wrap an angle into (-PI, PI]. */
function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed delta from angle `from` to angle `to`. */
const angleDelta = (from, to) => wrapAngle(to - from);

/** Move a scalar toward a target by at most `step`. */
function approach(cur, tar, step) {
  if (cur < tar) return Math.min(cur + step, tar);
  return Math.max(cur - step, tar);
}

/** Deterministic PRNG so a seed always builds the same city. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded RNG with the same conveniences as the global helpers. */
class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  range(min, max) { return min + this.next() * (max - min); }
  int(min, max) { return Math.floor(min + this.next() * (max - min + 1)); }
  pick(arr) { return arr[(this.next() * arr.length) | 0]; }
  chance(p) { return this.next() < p; }
}

/**
 * Uniform grid for static geometry. The city never moves, so everything goes
 * in once at load and lookups stay O(cells touched).
 */
class SpatialHash {
  constructor(cellSize) {
    this.cell = cellSize;
    this.map = new Map();
  }
  _key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }
  insert(item) {
    const c = this.cell;
    const x0 = Math.floor(item.x / c), y0 = Math.floor(item.y / c);
    const x1 = Math.floor((item.x + item.w) / c), y1 = Math.floor((item.y + item.h) / c);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = this._key(cx, cy);
        let bucket = this.map.get(k);
        if (!bucket) { bucket = []; this.map.set(k, bucket); }
        bucket.push(item);
      }
    }
  }
  /** All items whose cells overlap the given AABB. May contain duplicates. */
  queryRect(x, y, w, h, out) {
    out = out || [];
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor(x / c), y0 = Math.floor(y / c);
    const x1 = Math.floor((x + w) / c), y1 = Math.floor((y + h) / c);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.map.get(this._key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const it = bucket[i];
          if (out.indexOf(it) === -1) out.push(it);
        }
      }
    }
    return out;
  }
  queryCircle(x, y, r, out) {
    return this.queryRect(x - r, y - r, r * 2, r * 2, out);
  }
}

/**
 * Push a circle out of an AABB along the shallowest axis.
 * Returns {nx, ny, depth} or null when there is no overlap.
 */
function circleRectHit(cx, cy, r, rect) {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - nx, dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;

  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  // Centre is inside the rect: escape through the nearest face.
  const left = cx - rect.x, right = rect.x + rect.w - cx;
  const top = cy - rect.y, bottom = rect.y + rect.h - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { nx: -1, ny: 0, depth: left + r };
  if (m === right) return { nx: 1, ny: 0, depth: right + r };
  if (m === top) return { nx: 0, ny: -1, depth: top + r };
  return { nx: 0, ny: 1, depth: bottom + r };
}

/** Segment vs AABB, used for bullets and line-of-sight checks. */
function segmentRectHit(x0, y0, x1, y1, rect) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - rect.x, rect.x + rect.w - x0, y0 - rect.y, rect.y + rect.h - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
  }
  return t0;
}

/** Closest point on segment AB to P, as a 0..1 parameter. */
function closestOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return 0;
  return clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
}

/** Rounded rectangle path (Path2D-free so it works on old canvases too). */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** 12345 -> "12,345" */
function commas(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return m + ':' + (r < 10 ? '0' : '') + r;
}
