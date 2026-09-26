// sim.js — Pure simulation logic for Tiny Living City.
// No rendering and no Three.js here: layout, waypoint graph, traffic signals,
// pedestrians, cars, clock and weather state. The render modules only *draw* this state.

export const CFG = {
  cols: 3, rows: 2,          // city blocks (6 total)
  block: 18, road: 8,        // block size / road width (world units)
  sidewalk: 2.5,
  floorH: 2.0,
  pedestrians: 44,
  seed: 20260926,
  startHour: 16.3,
};

export const PITCH = CFG.block + CFG.road;
export const HB = CFG.block / 2;                 // half block
export const RING = HB - CFG.sidewalk / 2;       // pedestrian walking ring (centre of sidewalk)
export const CURB = HB - 0.38;                   // street furniture line
export const LANE = 1.9;                         // lane offset from road centre
export const STOP_E = 7.0;                       // lane segments end this far from an intersection centre
export const OUTER_WALK = 1.8;
export const ROAD_X = Array.from({ length: CFG.cols + 1 }, (_, i) => (i - CFG.cols / 2) * PITCH);
export const ROAD_Z = Array.from({ length: CFG.rows + 1 }, (_, j) => (j - CFG.rows / 2) * PITCH);
export const CITY_X = ROAD_X[CFG.cols] + CFG.road / 2;
export const CITY_Z = ROAD_Z[CFG.rows] + CFG.road / 2;
export const BASE_X = CITY_X + OUTER_WALK + 5.5;
export const BASE_Z = CITY_Z + OUTER_WALK + 5.5;

// clock = game minutes per real second. Agents get a gentler multiplier so the
// city stays readable (time-lapse feel) and numerically stable at 100x.
export const SPEEDS = {
  1:   { clock: 1,   agents: 1 },
  10:  { clock: 10,  agents: 2.5 },
  100: { clock: 100, agents: 5 },
};
export const SIGNAL = { green: 12, yellow: 2.2, allRed: 1.3 };

const THEMES = [
  ['residential', 'office', 'mixed'],  // back row (-z)
  ['shops', 'park', 'shops'],          // front row (+z, facing the default camera)
];
export const SHOP_NAMES = ['CAFÉ', 'BAKERY', 'BOOKS', 'RAMEN', 'FLOWERS', 'PIZZA', 'GELATO', 'RECORDS', 'DELI', 'TEA'];

export const SIDES = {
  N: { n: [0, -1], t: [1, 0] },
  E: { n: [1, 0], t: [0, 1] },
  S: { n: [0, 1], t: [1, 0] },
  W: { n: [-1, 0], t: [0, 1] },
};

// ---------------------------------------------------------------- utils
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
const rnd = (a, b) => a + (b - a) * Math.random();

// perimeter parameter (clockwise from NW corner) <-> block-relative position
function perimToRel(p) {
  const R = RING, P = 8 * R;
  p = ((p % P) + P) % P;
  if (p < 2 * R) return [-R + p, -R];
  if (p < 4 * R) return [R, -R + (p - 2 * R)];
  if (p < 6 * R) return [R - (p - 4 * R), R];
  return [-R, R - (p - 6 * R)];
}
function relToPerim(side, along) {
  const R = RING;
  switch (side) {
    case 'N': return along + R;
    case 'E': return 3 * R + along;
    case 'S': return 5 * R - along;
    default:  return 7 * R - along;
  }
}

// ---------------------------------------------------------------- sun / moon
export function sunState(hour) {
  const h = ((hour % 24) + 24) % 24;
  const RISE = 5.5, SET = 19.0;
  let x, y, z, elev;
  if (h >= RISE && h <= SET) {
    const th = ((h - RISE) / (SET - RISE)) * Math.PI;
    elev = Math.sin(th);
    x = -Math.cos(th) * 0.9; y = elev; z = 0.45;
  } else {                                                // moon arc
    const nh = h > SET ? h - SET : h + 24 - SET;
    const th = (nh / (24 - (SET - RISE))) * Math.PI;
    const me = Math.sin(th);
    elev = -me;
    x = Math.cos(th) * 0.8; y = me * 0.9; z = 0.35;
  }
  y = Math.max(y, 0.06);
  const l = Math.hypot(x, y, z);
  return { dir: [x / l, y / l, z / l], elev, night: smoothstep(0.35, -0.05, elev), isDay: elev > 0 };
}

// ---------------------------------------------------------------- layout
export function buildLayout(rng) {
  const blocks = [];
  for (let j = 0; j < CFG.rows; j++) {
    for (let i = 0; i < CFG.cols; i++) {
      blocks.push({
        i, j,
        cx: (ROAD_X[i] + ROAD_X[i + 1]) / 2,
        cz: (ROAD_Z[j] + ROAD_Z[j + 1]) / 2,
        theme: THEMES[j][i],
        buildings: [], ringFeatures: [], benches: [], lights: [], trees: [],
      });
    }
  }
  let shopIdx = 0, bid = 0;
  for (const b of blocks) {
    for (const s of Object.keys(SIDES)) {                 // street lights on every block edge
      const { n, t } = SIDES[s];
      for (const a of [-5.2, 5.2]) {
        b.lights.push({ x: b.cx + n[0] * CURB + t[0] * a, z: b.cz + n[1] * CURB + t[1] * a, nx: n[0], nz: n[1] });
      }
    }
    if (b.theme === 'park') {
      b.park = true;
      for (const s of Object.keys(SIDES)) b.ringFeatures.push({ side: s, along: 0, type: 'gate', data: { side: s } });
      const pts = [];
      for (let k = 0; k < 400 && pts.length < 12; k++) {
        const x = (rng() * 2 - 1) * 5.8, z = (rng() * 2 - 1) * 5.8;
        if (Math.abs(x) < 2.4 || Math.abs(z) < 2.4 || Math.hypot(x, z) < 5.0) continue;
        if (pts.some(p => Math.hypot(p[0] - x, p[1] - z) < 2.5)) continue;
        pts.push([x, z]);
      }
      for (const [x, z] of pts) b.trees.push({ x: b.cx + x, z: b.cz + z, s: 0.85 + rng() * 0.5, park: true });
      continue;
    }

    // one curb bench per block + street trees
    const benchSide = ['S', 'E', 'W'][Math.floor(rng() * 3)];
    const benchAlong = rng() < 0.5 ? -2.5 : 2.5;
    {
      const { n, t } = SIDES[benchSide];
      const bx = b.cx + n[0] * CURB + t[0] * benchAlong, bz = b.cz + n[1] * CURB + t[1] * benchAlong;
      const face = [-n[0], -n[1]];
      const seat = { x: bx + face[0] * 0.12, z: bz + face[1] * 0.12 };
      b.benches.push({ x: bx, z: bz, face });
      b.ringFeatures.push({ side: benchSide, along: benchAlong, type: 'bench', data: { seat, face } });
    }
    for (const s of Object.keys(SIDES)) {
      const { n, t } = SIDES[s];
      const alongs = b.theme === 'residential' ? [0, -2.5, 2.5] : [0];
      for (const a of alongs) {
        if (s === benchSide && a === benchAlong) continue;
        if (a !== 0 && rng() < 0.5) continue;
        b.trees.push({ x: b.cx + n[0] * CURB + t[0] * a, z: b.cz + n[1] * CURB + t[1] * a, s: 0.6 + rng() * 0.3 });
      }
    }

    // buildings on a 2x2 parcel grid
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        let type = b.theme;
        if (type === 'mixed') type = sz < 0 ? 'office' : (rng() < 0.5 ? 'residential' : 'shops');
        const w = 5.3 + rng() * 0.9, d = 5.3 + rng() * 0.9;
        const x = b.cx + sx * (6.4 - w / 2), z = b.cz + sz * (6.4 - d / 2);
        let floors;
        if (type === 'office') floors = Math.round(5 + rng() * 4 + (sz < 0 ? 3 : 0) + (b.theme === 'office' ? 2 : 0));
        else if (type === 'residential') floors = 2 + Math.floor(rng() * 4);
        else floors = 2 + Math.floor(rng() * 2);

        // front-row buildings mostly open towards +z (the camera), back row to the sides
        const doorAxis = sz > 0 ? (rng() < 0.75 ? 'z' : 'x') : (rng() < 0.8 ? 'x' : 'z');
        const nx = doorAxis === 'x' ? sx : 0, nz = doorAxis === 'z' ? sz : 0;
        const faceLen = doorAxis === 'x' ? d : w;
        const fcx = x + nx * w / 2, fcz = z + nz * d / 2;
        const isShop = type === 'shops';
        let a = (rng() * 2 - 1) * (faceLen / 2 - 1.0);
        if (isShop) a = (rng() < 0.5 ? -1 : 1) * (faceLen / 2 - 0.85);
        const door = { x: doorAxis === 'z' ? fcx + a : fcx, z: doorAxis === 'x' ? fcz + a : fcz };
        const side = doorAxis === 'z' ? (sz < 0 ? 'N' : 'S') : (sx < 0 ? 'W' : 'E');
        const alongOf = (p) => (doorAxis === 'z' ? p.x - b.cx : p.z - b.cz);

        const bld = { id: bid++, type, x, z, w, d, floors, h: floors * CFG.floorH, seed: rng(), nx, nz, faceLen, fcx, fcz, door, doorA: a };
        b.ringFeatures.push({
          side, along: alongOf(door), type: 'door',
          data: { inside: { x: door.x - nx * 1.5, z: door.z - nz * 1.5 }, face: [-nx, -nz], building: bld.id },
        });
        if (isShop) {
          const aw = -Math.sign(a) * faceLen * 0.14;
          const win = { x: doorAxis === 'z' ? fcx + aw : fcx, z: doorAxis === 'x' ? fcz + aw : fcz };
          bld.shop = { name: SHOP_NAMES[shopIdx++ % SHOP_NAMES.length], window: win };
          b.ringFeatures.push({
            side, along: alongOf(win), type: 'window',
            data: { spot: { x: win.x + nx * 0.75, z: win.z + nz * 0.75 }, face: [-nx, -nz] },
          });
        }
        b.buildings.push(bld);
      }
    }
  }

  // outer ring street lights (on the outer sidewalk, arm pointing at the road)
  const outerLights = [];
  const ox = CITY_X + OUTER_WALK * 0.55, oz = CITY_Z + OUTER_WALK * 0.55;
  for (let x = -CITY_X + 8; x <= CITY_X - 8; x += 13) {
    if (ROAD_X.some(r => Math.abs(r - x) < 6)) continue;
    outerLights.push({ x, z: -oz, nx: 0, nz: 1 }, { x, z: oz, nx: 0, nz: -1 });
  }
  for (let z = -CITY_Z + 8; z <= CITY_Z - 8; z += 13) {
    if (ROAD_Z.some(r => Math.abs(r - z) < 6)) continue;
    outerLights.push({ x: -ox, z, nx: 1, nz: 0 }, { x: ox, z, nx: -1, nz: 0 });
  }

  // countryside trees around the diorama edge
  const outerTrees = [];
  const inX = CITY_X + OUTER_WALK + 0.9, inZ = CITY_Z + OUTER_WALK + 0.9;
  for (let k = 0; k < 3000 && outerTrees.length < 58; k++) {
    const x = (rng() * 2 - 1) * (BASE_X - 1.2), z = (rng() * 2 - 1) * (BASE_Z - 1.2);
    if (Math.abs(x) < inX && Math.abs(z) < inZ) continue;
    if (outerTrees.some(t => Math.hypot(t.x - x, t.z - z) < 2.7)) continue;
    outerTrees.push({ x, z, s: 0.8 + rng() * 0.6, pine: rng() < 0.35 });
  }

  return { blocks, outerLights, outerTrees, crossings: [] };
}

// ---------------------------------------------------------------- pedestrian waypoint graph
export function buildGraph(layout) {
  const nodes = [];
  const add = (x, z, type = 'walk', data = null) => {
    const n = { id: nodes.length, x, z, type, data, links: [] };
    nodes.push(n);
    return n;
  };
  const link = (a, b, kind = 'walk', axis = null) => {
    a.links.push({ node: b, kind, axis });
    b.links.push({ node: a, kind, axis });
  };

  for (const b of layout.blocks) {
    const R = RING;
    const feats = b.ringFeatures.map(f => ({ p: relToPerim(f.side, f.along), type: f.type, data: f.data }));
    feats.push({ p: 0, type: 'corner', key: 'NW' }, { p: 2 * R, type: 'corner', key: 'NE' },
               { p: 4 * R, type: 'corner', key: 'SE' }, { p: 6 * R, type: 'corner', key: 'SW' });
    feats.sort((u, v) => u.p - v.p);
    const ring = [];
    b.corners = {};
    b.gates = {};
    for (const f of feats) {
      const [rx, rz] = perimToRel(f.p);
      const n = add(b.cx + rx, b.cz + rz, f.type, f.data);
      if (f.key) b.corners[f.key] = n;
      if (f.type === 'gate') b.gates[f.data.side] = n;
      ring.push(n);
    }
    for (let k = 0; k < ring.length; k++) link(ring[k], ring[(k + 1) % ring.length]);

    if (b.park) {                                           // park paths: gates -> benches -> plaza loop
      const PR = 3.3, c = { cx: b.cx, cz: b.cz };
      const plaza = {
        N: add(b.cx, b.cz - PR, 'plaza', c), E: add(b.cx + PR, b.cz, 'plaza', c),
        S: add(b.cx, b.cz + PR, 'plaza', c), W: add(b.cx - PR, b.cz, 'plaza', c),
      };
      link(plaza.N, plaza.E); link(plaza.E, plaza.S); link(plaza.S, plaza.W); link(plaza.W, plaza.N);
      let alt = 1;
      for (const s of Object.keys(SIDES)) {
        const { n, t } = SIDES[s];
        const bx = b.cx + n[0] * 5.4, bz = b.cz + n[1] * 5.4;
        const perp = [t[0] * alt, t[1] * alt];
        alt = -alt;
        const face = [-perp[0], -perp[1]];
        const seat = { x: bx + perp[0] * 1.1, z: bz + perp[1] * 1.1 };
        b.benches.push({ x: seat.x + perp[0] * 0.12, z: seat.z + perp[1] * 0.12, face });
        const bn = add(bx, bz, 'bench', { seat, face });
        link(b.gates[s], bn);
        link(bn, plaza[s]);
      }
    }
  }

  // zebra crossings between neighbouring blocks
  const at = (i, j) => layout.blocks.find(b => b.i === i && b.j === j);
  for (const b of layout.blocks) {
    const e = at(b.i + 1, b.j);
    if (e) {
      link(b.corners.NE, e.corners.NW, 'cross', 'x');
      link(b.corners.SE, e.corners.SW, 'cross', 'x');
      layout.crossings.push({ axis: 'x', x: ROAD_X[b.i + 1], z: b.corners.NE.z }, { axis: 'x', x: ROAD_X[b.i + 1], z: b.corners.SE.z });
    }
    const s = at(b.i, b.j + 1);
    if (s) {
      link(b.corners.SW, s.corners.NW, 'cross', 'z');
      link(b.corners.SE, s.corners.NE, 'cross', 'z');
      layout.crossings.push({ axis: 'z', x: b.corners.SW.x, z: ROAD_Z[b.j + 1] }, { axis: 'z', x: b.corners.SE.x, z: ROAD_Z[b.j + 1] });
    }
  }
  return { nodes };
}

// ---------------------------------------------------------------- road network helpers
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const inGrid = (i, j) => i >= 0 && i <= CFG.cols && j >= 0 && j <= CFG.rows;
export const degree = (i, j) => DIRS.filter(([dx, dz]) => inGrid(i + dx, j + dz)).length;
const nodePos = (i, j) => ({ x: ROAD_X[i], z: ROAD_Z[j] });

function linePath(ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az) || 1e-3;
  const hx = (bx - ax) / len, hz = (bz - az) / len;
  return { len, at(t, o) { o.x = ax + (bx - ax) * t; o.z = az + (bz - az) * t; o.hx = hx; o.hz = hz; } };
}
function bezPath(ax, az, cx, cz, bx, bz) {
  let len = 0, px = ax, pz = az;
  for (let k = 1; k <= 20; k++) {
    const t = k / 20, u = 1 - t;
    const x = u * u * ax + 2 * u * t * cx + t * t * bx, z = u * u * az + 2 * u * t * cz + t * t * bz;
    len += Math.hypot(x - px, z - pz); px = x; pz = z;
  }
  return {
    len,
    at(t, o) {
      const u = 1 - t;
      o.x = u * u * ax + 2 * u * t * cx + t * t * bx;
      o.z = u * u * az + 2 * u * t * cz + t * t * bz;
      const tx = 2 * u * (cx - ax) + 2 * t * (bx - cx), tz = 2 * u * (cz - az) + 2 * t * (bz - cz);
      const l = Math.hypot(tx, tz) || 1;
      o.hx = tx / l; o.hz = tz / l;
    },
  };
}
// straight lane between two intersections (right-hand traffic)
function segPath(i, j, d) {
  const [dx, dz] = d, rx = -dz, rz = dx;
  const a = nodePos(i, j), b = nodePos(i + dx, j + dz);
  return linePath(a.x + dx * STOP_E + rx * LANE, a.z + dz * STOP_E + rz * LANE,
                  b.x - dx * STOP_E + rx * LANE, b.z - dz * STOP_E + rz * LANE);
}
// movement through an intersection: straight line or quadratic-bezier turn
function turnPath(i, j, d1, d2) {
  const n = nodePos(i, j);
  const ax = n.x - d1[0] * STOP_E - d1[1] * LANE, az = n.z - d1[1] * STOP_E + d1[0] * LANE;
  const bx = n.x + d2[0] * STOP_E - d2[1] * LANE, bz = n.z + d2[1] * STOP_E + d2[0] * LANE;
  if (d1[0] === d2[0] && d1[1] === d2[1]) return linePath(ax, az, bx, bz);
  const cx = d1[0] !== 0 ? bx : ax, cz = d1[0] !== 0 ? az : bz;
  return bezPath(ax, az, cx, cz, bx, bz);
}

// ---------------------------------------------------------------- pedestrians
// States: walk (edge to target node) | wait (at crosswalk for green) |
//         go -> stay -> back (short excursion: enter shop, sit on bench, browse window, idle at fountain)
export class Pedestrian {
  constructor(sim, rng, id) {
    this.sim = sim; this.id = id;
    this.speed = 1.05 + rng() * 0.5;
    this.lat = 0.16 + rng() * 0.42;          // personal lateral offset so people don't walk single-file
    this.latCur = this.lat;
    const nodes = sim.graph.nodes;
    const n = nodes[Math.floor(rng() * nodes.length)];
    const walkLinks = n.links.filter(l => l.kind === 'walk');
    const l = walkLinks[Math.floor(rng() * walkLinks.length)];
    this.node = n; this.prev = null; this.target = l.node; this.edgeKind = 'walk'; this.axis = null;
    this.state = 'walk';
    const f = rng();
    this.x = n.x + (l.node.x - n.x) * f; this.z = n.z + (l.node.z - n.z) * f;
    const dl = Math.hypot(l.node.x - n.x, l.node.z - n.z) || 1;
    this.dirX = (l.node.x - n.x) / dl; this.dirZ = (l.node.z - n.z) / dl;
    this.hx = this.dirX; this.hz = this.dirZ;
    this.rx = this.x; this.rz = this.z; this.ry = 0.2;
    this.vis = 1; this.umb = 0; this.umbDelay = rng();
    this.phase = rng() * 6.28; this.move = 1;
    this.cool = rng() * 4; this.timer = 0; this.mode = null; this.goal = null; this.faceDir = null;
    this.sitting = false;
  }

  moveTo(tx, tz, step) {
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    if (d <= step || d < 1e-5) { this.x = tx; this.z = tz; this.phase += d * 5.2; return true; }
    this.dirX = dx / d; this.dirZ = dz / d;
    this.x += this.dirX * step; this.z += this.dirZ * step;
    this.phase += step * 5.2;
    return false;
  }

  excursion(goal, mode, time, face) {
    this.state = 'go'; this.goal = goal; this.mode = mode; this.timer = time; this.faceDir = face;
  }

  arrive(n) {
    this.prev = this.node; this.node = n;
    const s = this.sim, r = Math.random();
    if (this.cool <= 0) {
      if (n.type === 'door' && r < 0.22 + 0.12 * s.night + 0.2 * s.rain) {
        return this.excursion(n.data.inside, 'inside', rnd(6, 16) * (1 + 0.6 * s.night), n.data.face);
      }
      if (n.type === 'window' && r < 0.45) return this.excursion(n.data.spot, 'browse', rnd(2, 5), n.data.face);
      if (n.type === 'bench' && s.rain < 0.35 && r < 0.45) return this.excursion(n.data.seat, 'sit', rnd(5, 14), n.data.face);
      if (n.type === 'plaza' && r < 0.3) {
        const a = Math.random() * Math.PI * 2, c = n.data;
        return this.excursion({ x: c.cx + Math.cos(a) * 2.3, z: c.cz + Math.sin(a) * 2.3 }, 'idle', rnd(2, 5), [-Math.cos(a), -Math.sin(a)]);
      }
    }
    this.chooseNext();
  }

  chooseNext() {
    const n = this.node;
    let opts = n.links.filter(l => l.node !== this.prev);
    if (!opts.length) opts = n.links;
    let total = 0;
    const w = opts.map(l => { const v = l.kind === 'cross' ? 0.9 : 1; total += v; return v; });
    let r = Math.random() * total, k = 0;
    while (k < opts.length - 1 && (r -= w[k]) > 0) k++;
    const l = opts[k];
    this.target = l.node; this.edgeKind = l.kind; this.axis = l.axis;
    this.state = l.kind === 'cross' ? 'wait' : 'walk';
    this.mode = null;
  }

  update(dt) {
    const s = this.sim;
    this.cool -= dt;
    let moving = false, fx = null, fz = null;
    const spd = this.speed * (1 + 0.18 * s.rain);            // people hurry a bit in the rain
    switch (this.state) {
      case 'walk': {
        const k = this.edgeKind === 'cross' ? 1.3 : 1;
        moving = true;
        if (this.moveTo(this.target.x, this.target.z, spd * k * dt)) this.arrive(this.target);
        break;
      }
      case 'wait': {
        fx = this.target.x - this.x; fz = this.target.z - this.z;
        const sig = s.signal(this.axis), dist = Math.hypot(fx, fz);
        if (sig.s === 'g' && sig.rem > dist / (spd * 1.3) + 0.4) this.state = 'walk';
        break;
      }
      case 'go':
        moving = true;
        if (this.moveTo(this.goal.x, this.goal.z, spd * 0.8 * dt)) this.state = 'stay';
        break;
      case 'stay':
        if (this.faceDir) { fx = this.faceDir[0]; fz = this.faceDir[1]; }
        this.timer -= dt;
        if (this.timer <= 0) this.state = 'back';
        break;
      case 'back':
        moving = true;
        if (this.moveTo(this.node.x, this.node.z, spd * 0.8 * dt)) { this.cool = rnd(6, 12); this.chooseNext(); }
        break;
    }
    if (moving) { fx = this.dirX; fz = this.dirZ; }
    if (fx !== null) {                                        // smooth heading
      const l = Math.hypot(fx, fz);
      if (l > 1e-4) {
        fx /= l; fz /= l;
        const k = 1 - Math.exp(-dt * 9);
        let hx = this.hx + (fx - this.hx) * k, hz = this.hz + (fz - this.hz) * k;
        const hl = Math.hypot(hx, hz);
        if (hl < 1e-3) { hx = fx; hz = fz; } else { hx /= hl; hz /= hl; }
        this.hx = hx; this.hz = hz;
      }
    }
    const e = (rate) => 1 - Math.exp(-dt * rate);
    this.move += ((moving ? 1 : 0) - this.move) * e(8);
    const latT = (this.state === 'walk' || this.state === 'wait') ? this.lat : 0;
    this.latCur += (latT - this.latCur) * e(2.5);
    this.rx = this.x - this.hz * this.latCur;                // render position (lateral offset applied)
    this.rz = this.z + this.hx * this.latCur;
    const hidden = this.state === 'stay' && this.mode === 'inside';
    this.vis += ((hidden ? 0 : 1) - this.vis) * e(5);
    this.sitting = this.state === 'stay' && this.mode === 'sit';
    const umbT = s.rain > 0.2 + this.umbDelay * 0.35 ? 1 : 0;
    this.umb += (umbT - this.umb) * e(4);
    this.ry += (s.groundY(this.rx, this.rz) - this.ry) * e(14);
  }
}

// ---------------------------------------------------------------- cars
const TMP = { x: 0, z: 0, hx: 1, hz: 0 };
export class Car {
  constructor(sim, spec, i, j, d, s0) {
    this.sim = sim; this.spec = spec; this.type = spec.type;
    this.len = spec.len; this.maxSpeed = spec.speed; this.speed = spec.speed * 0.5;
    this.x = 0; this.z = 0; this.hx = 1; this.hz = 0; this.braking = false; this.odo = 0;
    this.enterSeg(i, j, d);
    this.s = Math.min(s0, this.path.len * 0.6);
    this.pose();
  }
  enterSeg(i, j, d) {
    this.fi = i; this.fj = j; this.d = d; this.ti = i + d[0]; this.tj = j + d[1];
    this.mode = 'seg'; this.path = segPath(i, j, d); this.s = 0;
    this.next = this.pickNext();
  }
  pickNext() {
    const [dx, dz] = this.d, opts = [], w = [];
    let total = 0;
    for (const nd of DIRS) {
      if (nd[0] === -dx && nd[1] === -dz) continue;
      if (!inGrid(this.ti + nd[0], this.tj + nd[1])) continue;
      const straight = nd[0] === dx && nd[1] === dz;
      const right = nd[0] === -dz && nd[1] === dx;
      const v = straight ? 2.2 : right ? 1.3 : 0.9;
      opts.push(nd); w.push(v); total += v;
    }
    if (!opts.length) return [-dx, -dz];
    let r = Math.random() * total, k = 0;
    while (k < opts.length - 1 && (r -= w[k]) > 0) k++;
    return opts[k];
  }
  pose() {
    this.path.at(clamp(this.s / this.path.len, 0, 1), TMP);
    this.x = TMP.x; this.z = TMP.z; this.hx = TMP.hx; this.hz = TMP.hz;
  }
  // Can we enter the intersection ahead? Simple reservation rule: cars already inside must be
  // on a compatible path, and the exit lane must have room (don't block the box).
  canEnter() {
    const [dx, dz] = this.d, [nx, nz] = this.next;
    const myLeft = nx === dz && nz === -dx;
    for (const o of this.sim.cars) {
      if (o === this) continue;
      if (o.mode === 'turn' && o.ti === this.ti && o.tj === this.tj) {
        const same = o.d[0] === dx && o.d[1] === dz;
        if (same && o.next[0] === nx && o.next[1] === nz) continue;         // same path: gap rule handles it
        const opp = o.d[0] === -dx && o.d[1] === -dz;
        const oLeft = o.next[0] === o.d[1] && o.next[1] === -o.d[0];
        if (opp && !myLeft && !oLeft) continue;                                // opposing straight/right: fine
        return false;
      }
      if (o.mode === 'seg' && o.fi === this.ti && o.fj === this.tj && o.d[0] === nx && o.d[1] === nz
          && o.s < this.len / 2 + o.len / 2 + 1.2) return false;               // exit lane full
    }
    return true;
  }
  update(dt) {
    const sim = this.sim;
    let vT = this.maxSpeed;
    const rem = this.path.len - this.s;
    const turning = !(this.next[0] === this.d[0] && this.next[1] === this.d[1]);
    const ghost = this.stuck > 25;                          // watchdog: never deadlock forever
    if (this.mode === 'seg') {
      const stopRem = rem - (this.len / 2 + 0.4);
      let hold = false;
      if (degree(this.ti, this.tj) >= 3) {                  // signalised intersection ahead
        const sig = sim.signal(this.d[0] !== 0 ? 'x' : 'z');
        hold = !(sig.s === 'g' || (sig.s === 'y' && stopRem < 1.2));
      }
      if (!hold && stopRem < 5 && !ghost && !this.canEnter()) hold = true;
      if (hold && stopRem > -0.3) vT = Math.min(vT, Math.sqrt(2 * 7 * Math.max(0, stopRem)));
      if (turning) vT = Math.min(vT, 3.2 + rem * 0.35);
    } else if (turning) vT = Math.min(vT, 3.4);

    if (!ghost) {
      for (const o of sim.cars) {
        if (o === this) continue;
        const vx = o.x - this.x, vz = o.z - this.z;
        const fwd = vx * this.hx + vz * this.hz;
        if (fwd <= 0 || fwd > 13) continue;
        const side = Math.abs(-vx * this.hz + vz * this.hx);
        const dot = this.hx * o.hx + this.hz * o.hz;
        if (dot >= 0.25) {                                  // follow the car ahead in our lane
          if (side > 1.7) continue;
          const gap = fwd - (this.len + o.len) / 2;
          vT = Math.min(vT, Math.max(0, (gap - 1.3) * 1.8));
        } else if (fwd < 9 && side < 2.2) {                 // something crossing right in front of us
          vT = Math.min(vT, Math.max(0, (fwd - this.len / 2 - 1.6) * 1.8));
        }
      }
    }
    for (const p of sim.peds) {                             // yield to pedestrians on zebra crossings
      if (p.state !== 'walk' || p.edgeKind !== 'cross') continue;
      const vx = p.rx - this.x, vz = p.rz - this.z;
      const fwd = vx * this.hx + vz * this.hz;
      if (fwd <= 0 || fwd > this.len / 2 + 6) continue;
      if (Math.abs(-vx * this.hz + vz * this.hx) > 1.7) continue;
      vT = Math.min(vT, Math.max(0, (fwd - this.len / 2 - 1.3) * 2));
    }
    this.stuck = this.speed < 0.05 ? (this.stuck || 0) + dt : 0;

    const acc = vT > this.speed ? 4.5 : 14;
    this.speed += clamp(vT - this.speed, -acc * dt, acc * dt);
    this.braking = this.speed < this.maxSpeed * 0.9 && vT < this.speed + 0.05;
    const ds = this.speed * dt;
    this.s += ds; this.odo += ds;
    let guard = 0;
    while (this.s >= this.path.len && guard++ < 4) {
      const over = this.s - this.path.len;
      if (this.mode === 'seg') {
        this.mode = 'turn'; this.path = turnPath(this.ti, this.tj, this.d, this.next); this.s = over;
      } else {
        this.enterSeg(this.ti, this.tj, this.next); this.s = over;
      }
    }
    this.pose();
  }
}

export const CAR_SPECS = [
  { type: 'bus', len: 6.2, speed: 5.2, color: '#f2a93b' },
  { type: 'taxi', len: 3.1, speed: 7.0, color: '#ffd23f' },
  { type: 'car', len: 3.0, speed: 6.8, color: '#e8574f' },
  { type: 'car', len: 3.0, speed: 6.4, color: '#3f8fd2' },
  { type: 'van', len: 3.6, speed: 6.0, color: '#f4f1ea' },
  { type: 'car', len: 3.0, speed: 7.2, color: '#57b894' },
  { type: 'car', len: 3.0, speed: 6.6, color: '#8a6bd1' },
  { type: 'car', len: 3.0, speed: 6.9, color: '#2f3a4a' },
];

// ---------------------------------------------------------------- the simulation
export class Sim {
  constructor() {
    const rng = makeRng(CFG.seed);
    this.layout = buildLayout(rng);
    this.graph = buildGraph(this.layout);
    this.hour = CFG.startHour;
    this.sigT = 0;
    this.rain = 0; this.rainTarget = 0; this.wet = 0;
    this.speed = 10; this.paused = false;
    this.peds = [];
    for (let k = 0; k < CFG.pedestrians; k++) this.peds.push(new Pedestrian(this, rng, k));
    this.cars = [];
    const segs = [];
    for (let i = 0; i <= CFG.cols; i++) for (let j = 0; j <= CFG.rows; j++)
      for (const d of DIRS) if (inGrid(i + d[0], j + d[1])) segs.push([i, j, d]);
    for (let k = segs.length - 1; k > 0; k--) { const m = Math.floor(rng() * (k + 1)); [segs[k], segs[m]] = [segs[m], segs[k]]; }
    CAR_SPECS.forEach((spec, k) => { const [i, j, d] = segs[k]; this.cars.push(new Car(this, spec, i, j, d, rng() * 6)); });
    this.sun = sunState(this.hour);
    this.night = this.sun.night;
  }

  // global two-phase signal plan: 'z' axis traffic, then 'x' axis traffic
  signal(axis) {
    const { green: g, yellow: y, allRed: ar } = SIGNAL;
    const half = g + y + ar, u = this.sigT % (2 * half);
    const active = u < half ? 'z' : 'x', local = u < half ? u : u - half;
    if (axis !== active) return { s: 'r', rem: 0 };
    if (local < g) return { s: 'g', rem: g - local };
    if (local < g + y) return { s: 'y', rem: 0 };
    return { s: 'r', rem: 0 };
  }

  groundY(x, z) {
    for (const b of this.layout.blocks) if (Math.abs(x - b.cx) < HB && Math.abs(z - b.cz) < HB) return 0.2;
    return 0.02;
  }

  setWeather(rain) { this.rainTarget = rain ? 1 : 0; }

  advance(realDt) {
    realDt = Math.min(realDt, 0.1);
    const sp = SPEEDS[this.speed];
    const wr = realDt * 0.4;                                // weather fades in real time: toggle always feels responsive
    this.rain += clamp(this.rainTarget - this.rain, -wr, wr);
    if (this.rain > this.wet) this.wet = Math.min(this.rain, this.wet + realDt * 0.3);
    else if (!this.paused) this.wet = Math.max(this.rain, this.wet - realDt * 0.012 * sp.agents);
    if (!this.paused) {
      this.hour = (this.hour + (realDt * sp.clock) / 60) % 24;
      const adt = realDt * sp.agents;
      const steps = Math.max(1, Math.ceil(adt / 0.05)), h = adt / steps;   // fixed-ish substeps for stability
      for (let k = 0; k < steps; k++) {
        this.sigT += h;
        for (const p of this.peds) p.update(h);
        for (const c of this.cars) c.update(h);
      }
    }
    this.sun = sunState(this.hour);
    this.night = this.sun.night;
  }
}