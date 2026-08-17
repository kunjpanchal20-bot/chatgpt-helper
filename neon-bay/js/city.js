'use strict';
/* ============================================================
   Neon Bay — city.js
   Procedural city: road grid, zoned blocks, extruded buildings,
   parks, beach, props and the lane graph traffic drives on.
   ============================================================ */

const CITY = {
  GRID: 12,        // blocks per axis
  BLOCK: 300,      // block interior size
  ROAD: 96,        // road width
  PITCH: 396,      // BLOCK + ROAD
  LANE: 24,        // lane centre offset from road centre
  SIDEWALK: 18,
};

const PALETTE = {
  road: '#33353f',
  roadLine: '#d8d29a',
  sidewalk: '#6a6d7d',
  grass: '#2f6b42',
  sand: '#c9ab72',
  water: '#123a52',
  lot: '#43454f',
};

const BUILDING_COLORS = {
  downtown: ['#6d7694', '#5b6a8c', '#7b84a4', '#4e5674', '#7a6d92', '#5f7597'],
  midtown: ['#9a8c66', '#a8967a', '#8c7f86', '#b08d6f', '#78908c', '#a8927f'],
  suburb: ['#b08a72', '#c1a184', '#8f8b9c', '#c4a385', '#a2998d', '#8fa39b'],
  industrial: ['#6f767c', '#818a90', '#5f676c', '#8b9298'],
  beach: ['#c6ab8e', '#d6bb98', '#b9ada2', '#cfae92'],
};

const NEON = ['#ff3d81', '#22d3ee', '#a78bfa', '#f59e0b', '#4ade80', '#f472b6'];

function generateCity(seed) {
  const rng = new Rng(seed);
  const G_ = CITY.GRID, P = CITY.PITCH, R = CITY.ROAD, B = CITY.BLOCK;
  const size = G_ * P + R;

  const world = {
    seed,
    size,
    blocks: [],
    buildings: [],
    props: [],
    decals: [],
    solids: [],
    landmarks: [],
    parkingSpots: [],
    hash: new SpatialHash(160),
    rng,
  };

  const roadPos = (i) => i * P;
  const roadCenter = (i) => i * P + R / 2;
  world.roadCenter = roadCenter;

  // ------------------------------------------------------------ zoning
  const c = (G_ - 1) / 2;
  function zoneFor(bx, by) {
    if (by === G_ - 1) return 'beach';
    const d = Math.max(Math.abs(bx - c), Math.abs(by - c));
    if (d <= 1.5) return 'downtown';
    if (d <= 3.5) return 'midtown';
    if (bx <= 1 && by <= 2) return 'industrial';
    return 'suburb';
  }

  const heightRange = {
    downtown: [130, 320],
    midtown: [70, 165],
    suburb: [34, 78],
    industrial: [44, 96],
    beach: [30, 80],
  };

  // ------------------------------------------------------------ blocks
  for (let by = 0; by < G_; by++) {
    for (let bx = 0; bx < G_; bx++) {
      const zone = zoneFor(bx, by);
      const blk = {
        bx, by, zone,
        x: roadPos(bx) + R,
        y: roadPos(by) + R,
        w: B, h: B,
        type: 'buildings',
      };

      const roll = rng.next();
      if (zone === 'beach') blk.type = roll < 0.7 ? 'beach' : 'buildings';
      else if (roll < 0.09) blk.type = 'park';
      else if (roll < 0.15) blk.type = 'lot';
      else if (roll < 0.19) blk.type = 'plaza';

      world.blocks.push(blk);
    }
  }

  // Guarantee a couple of landmark blocks in fixed spots.
  const blockAt = (bx, by) => world.blocks[by * G_ + bx];
  blockAt(1, G_ - 2).type = 'safehouse';
  blockAt(G_ - 2, 1).type = 'park';
  blockAt(Math.floor(c), Math.floor(c)).type = 'plaza';

  // ------------------------------------------------------------ contents
  for (const blk of world.blocks) {
    switch (blk.type) {
      case 'park': buildPark(world, blk, rng); break;
      case 'lot': buildParkingLot(world, blk, rng); break;
      case 'plaza': buildPlaza(world, blk, rng); break;
      case 'beach': buildBeach(world, blk, rng); break;
      case 'safehouse': buildSafehouse(world, blk, rng); break;
      default: buildBlockOfBuildings(world, blk, rng, heightRange[blk.zone]);
    }
  }

  // ------------------------------------------------------------ street furniture
  for (let i = 0; i <= G_; i++) {
    for (let j = 0; j <= G_; j++) {
      // Lamps at the four corners of each intersection.
      if (i < G_ && j < G_) {
        const bx = roadPos(i) + R, by = roadPos(j) + R;
        addLamp(world, bx - 12, by - 12);
        addLamp(world, bx + B + 12, by - 12);
        addLamp(world, bx - 12, by + B + 12);
        addLamp(world, bx + B + 12, by + B + 12);
      }
    }
  }

  // ------------------------------------------------------------ collision
  for (const b of world.buildings) world.solids.push(b);
  for (const p of world.props) if (p.solid) world.solids.push(p);
  for (const s of world.solids) world.hash.insert(s);

  // ------------------------------------------------------------ lane graph
  world.lanes = buildLaneGraph(world);

  world.isOnRoad = function (x, y) {
    const mx = ((x % P) + P) % P;
    const my = ((y % P) + P) % P;
    return mx < R || my < R;
  };

  world.clampToWorld = function (e, pad) {
    pad = pad || 12;
    e.x = clamp(e.x, pad, size - pad);
    e.y = clamp(e.y, pad, size - pad);
  };

  return world;
}

// ---------------------------------------------------------------- helpers

function addBuilding(world, x, y, w, h, opts) {
  const b = {
    x, y, w, h,
    height: opts.height,
    color: opts.color,
    roof: opts.roof || '#2b2d36',
    kind: opts.kind || 'building',
    neon: opts.neon || null,
    seed: (Math.random() * 65535) | 0,
    solid: true,
  };
  world.buildings.push(b);
  return b;
}

function addProp(world, type, x, y, r, height, opts) {
  const p = Object.assign({
    type, x: x - r, y: y - r, w: r * 2, h: r * 2,
    cx: x, cy: y, r, height, solid: true,
  }, opts || {});
  world.props.push(p);
  return p;
}

function addLamp(world, x, y) {
  world.props.push({
    type: 'lamp', x: x - 4, y: y - 4, w: 8, h: 8,
    cx: x, cy: y, r: 4, height: 46, solid: false, light: true,
  });
}

/** Recursively split a rect into lots along its longer axis. */
function subdivide(rect, rng, minSize, out) {
  out = out || [];
  const canSplitW = rect.w > minSize * 2;
  const canSplitH = rect.h > minSize * 2;
  if (!canSplitW && !canSplitH) { out.push(rect); return out; }

  const splitVertical = canSplitW && (!canSplitH || rect.w >= rect.h);
  const t = rng.range(0.38, 0.62);
  if (splitVertical) {
    const cut = Math.round(rect.w * t);
    subdivide({ x: rect.x, y: rect.y, w: cut, h: rect.h }, rng, minSize, out);
    subdivide({ x: rect.x + cut, y: rect.y, w: rect.w - cut, h: rect.h }, rng, minSize, out);
  } else {
    const cut = Math.round(rect.h * t);
    subdivide({ x: rect.x, y: rect.y, w: rect.w, h: cut }, rng, minSize, out);
    subdivide({ x: rect.x, y: rect.y + cut, w: rect.w, h: rect.h - cut }, rng, minSize, out);
  }
  return out;
}

function buildBlockOfBuildings(world, blk, rng, hRange) {
  const inset = CITY.SIDEWALK;
  const area = { x: blk.x + inset, y: blk.y + inset, w: blk.w - inset * 2, h: blk.h - inset * 2 };
  const minLot = blk.zone === 'downtown' ? 92 : blk.zone === 'suburb' ? 58 : 74;
  const lots = subdivide(area, rng, minLot);
  const colors = BUILDING_COLORS[blk.zone] || BUILDING_COLORS.midtown;

  for (const lot of lots) {
    if (rng.chance(0.08)) {           // courtyard / empty lot
      world.decals.push({ type: 'lot', x: lot.x, y: lot.y, w: lot.w, h: lot.h });
      if (rng.chance(0.6)) addProp(world, 'tree', lot.x + lot.w / 2, lot.y + lot.h / 2, 13, 34);
      continue;
    }
    const m = rng.range(3, 10);
    const x = lot.x + m, y = lot.y + m;
    const w = Math.max(24, lot.w - m * 2), h = Math.max(24, lot.h - m * 2);
    const height = rng.range(hRange[0], hRange[1]) * (blk.zone === 'downtown' ? rng.range(0.7, 1.25) : 1);
    const b = addBuilding(world, x, y, w, h, {
      height,
      color: rng.pick(colors),
      roof: rng.pick(['#585c69', '#4e525e', '#626675', '#545866']),
      kind: blk.zone,
    });
    if (rng.chance(blk.zone === 'downtown' ? 0.34 : 0.07)) b.neon = rng.pick(NEON);
  }
}

function buildPark(world, blk, rng) {
  world.decals.push({ type: 'grass', x: blk.x, y: blk.y, w: blk.w, h: blk.h });
  // Winding path.
  world.decals.push({ type: 'path', x: blk.x + blk.w * 0.42, y: blk.y, w: blk.w * 0.16, h: blk.h });
  world.decals.push({ type: 'path', x: blk.x, y: blk.y + blk.h * 0.44, w: blk.w, h: blk.h * 0.14 });
  if (rng.chance(0.55)) {
    const pw = blk.w * 0.38, ph = blk.h * 0.3;
    world.decals.push({
      type: 'pond',
      x: blk.x + blk.w * 0.55, y: blk.y + blk.h * 0.58, w: pw, h: ph,
    });
  }
  const trees = rng.int(14, 22);
  for (let i = 0; i < trees; i++) {
    const x = blk.x + rng.range(16, blk.w - 16);
    const y = blk.y + rng.range(16, blk.h - 16);
    addProp(world, 'tree', x, y, rng.range(11, 17), rng.range(28, 46));
  }
  blk.mapColor = PALETTE.grass;
}

function buildParkingLot(world, blk, rng) {
  world.decals.push({ type: 'lot', x: blk.x, y: blk.y, w: blk.w, h: blk.h });
  const rows = 3, cols = 6;
  const cw = blk.w / cols, ch = blk.h / rows;
  for (let r = 0; r < rows; r++) {
    for (let cI = 0; cI < cols; cI++) {
      const x = blk.x + cI * cw + 4, y = blk.y + r * ch + 6;
      world.decals.push({ type: 'stall', x, y, w: cw - 8, h: ch - 12 });
      if (rng.chance(0.45)) {
        world.parkingSpots.push({ x: x + cw / 2 - 4, y: y + ch / 2 - 3, angle: 0 });
      }
    }
  }
  blk.mapColor = PALETTE.lot;
}

function buildPlaza(world, blk, rng) {
  world.decals.push({ type: 'plaza', x: blk.x, y: blk.y, w: blk.w, h: blk.h });
  const cx = blk.x + blk.w / 2, cy = blk.y + blk.h / 2;
  world.decals.push({ type: 'fountainbase', x: cx - 46, y: cy - 46, w: 92, h: 92 });
  addProp(world, 'fountain', cx, cy, 30, 26, { solid: true });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    addProp(world, 'tree', cx + Math.cos(a) * 105, cy + Math.sin(a) * 105, 12, 32);
  }
  blk.mapColor = '#4a4438';
}

function buildBeach(world, blk, rng) {
  world.decals.push({ type: 'sand', x: blk.x - CITY.ROAD / 2, y: blk.y, w: blk.w + CITY.ROAD, h: blk.h });
  const palms = rng.int(5, 9);
  for (let i = 0; i < palms; i++) {
    addProp(world, 'palm', blk.x + rng.range(20, blk.w - 20), blk.y + rng.range(10, blk.h * 0.6), 10, rng.range(44, 66));
  }
  for (let i = 0; i < 4; i++) {
    const x = blk.x + rng.range(20, blk.w - 40), y = blk.y + rng.range(blk.h * 0.3, blk.h - 30);
    world.decals.push({ type: 'umbrella', x, y, w: 26, h: 26 });
  }
  blk.mapColor = PALETTE.sand;
}

function buildSafehouse(world, blk, rng) {
  world.decals.push({ type: 'lot', x: blk.x, y: blk.y, w: blk.w, h: blk.h });
  const hw = blk.w * 0.55, hh = blk.h * 0.5;
  addBuilding(world, blk.x + 10, blk.y + 10, hw, hh, {
    height: 62, color: '#a97fb0', roof: '#6d5a78', kind: 'safehouse', neon: '#22d3ee',
  });
  const gx = blk.x + blk.w * 0.5, gy = blk.y + blk.h * 0.78;
  world.decals.push({ type: 'garage', x: gx - 46, y: gy - 34, w: 92, h: 68 });
  world.landmarks.push({ type: 'safehouse', name: 'Safehouse', x: gx, y: gy, r: 34 });
  for (let i = 0; i < 3; i++) {
    world.parkingSpots.push({ x: blk.x + blk.w * 0.22 + i * 44, y: blk.y + blk.h * 0.62, angle: 0 });
  }
  blk.mapColor = '#4a3f52';
}

// ---------------------------------------------------------------- lanes

/**
 * Directed lane graph. A node is an (i, j) intersection entered while
 * travelling in one of four directions; the position is offset to the
 * right-hand lane so traffic keeps to one side.
 */
const DIRS = [
  { dx: 1, dy: 0, rx: 0, ry: 1 },    // 0 east
  { dx: 0, dy: 1, rx: -1, ry: 0 },   // 1 south
  { dx: -1, dy: 0, rx: 0, ry: -1 },  // 2 west
  { dx: 0, dy: -1, rx: 1, ry: 0 },   // 3 north
];

function buildLaneGraph(world) {
  const N = CITY.GRID;           // intersections are 0..N on each axis
  const L = CITY.LANE;
  const nodes = [];
  const index = (i, j, d) => ((j * (N + 1) + i) * 4 + d);

  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      for (let d = 0; d < 4; d++) {
        const dir = DIRS[d];
        nodes.push({
          i, j, d,
          x: world.roadCenter(i) + dir.rx * L,
          y: world.roadCenter(j) + dir.ry * L,
          next: [],
        });
      }
    }
  }

  // Connect each node to the nodes reachable without a U-turn.
  for (const n of nodes) {
    const dir = DIRS[n.d];
    const ni = n.i + dir.dx, nj = n.j + dir.dy;
    if (ni < 0 || ni > N || nj < 0 || nj > N) continue;
    for (let d2 = 0; d2 < 4; d2++) {
      if ((d2 + 2) % 4 === n.d) continue;              // no U-turn
      const d2dir = DIRS[d2];
      if (ni + d2dir.dx < 0 || ni + d2dir.dx > N) continue;
      if (nj + d2dir.dy < 0 || nj + d2dir.dy > N) continue;
      n.next.push(index(ni, nj, d2));
    }
  }

  const usable = nodes.filter((n) => n.next.length > 0);
  return { nodes, usable, index, N };
}

/** Nearest lane node to a point, optionally biased toward a heading. */
function nearestLaneNode(world, x, y, preferAngle) {
  let best = null, bestScore = Infinity;
  const nodes = world.lanes.usable;
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    const d = dist2(x, y, n.x, n.y);
    if (d > 700 * 700) continue;
    let score = d;
    if (preferAngle !== undefined) {
      const dir = DIRS[n.d];
      const a = Math.atan2(dir.dy, dir.dx);
      score *= 1 + Math.abs(angleDelta(preferAngle, a)) * 0.35;
    }
    if (score < bestScore) { bestScore = score; best = n; }
  }
  return best;
}
