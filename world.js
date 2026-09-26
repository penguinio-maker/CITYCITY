// world.js — builds the static diorama: ground, roads, markings, buildings, windows,
// shops, park, trees, benches, street lights and traffic signals.
// Static geometry is merged per material (few draw calls); repeated props use instancing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CFG, HB, RING, LANE, ROAD_X, ROAD_Z, CITY_X, CITY_Z, BASE_X, BASE_Z, OUTER_WALK,
  SIDES, DIRS, inGrid, degree, makeRng,
} from './sim.js';

const SIDEWALK_Y = 0.2;

// ---------------------------------------------------------------- materials & helpers
const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, envMapIntensity: 0.45, ...opts }));
  }
  return matCache.get(key);
}

// Collects transformed geometries per material and merges them into single meshes.
class Batcher {
  constructor() { this.groups = new Map(); this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); }
  add(material, geo, x, y, z, ry = 0, rx = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    this.e.set(rx, ry, rz, 'YXZ');
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this.m);
    if (!this.groups.has(material)) this.groups.set(material, []);
    this.groups.get(material).push(g);
  }
  box(material, w, h, d, x, y, z, ry = 0) { this.add(material, new THREE.BoxGeometry(w, h, d), x, y, z, ry); }
  build(parent, { cast = true, receive = true } = {}) {
    for (const [material, geos] of this.groups) {
      const merged = mergeGeometries(geos, false);
      geos.forEach(g => g.dispose());
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      parent.add(mesh);
    }
    this.groups.clear();
  }
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
export function radialTexture(stops = [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]) {
  return canvasTexture(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

const PALETTE = {
  residential: ['#f3d9b1', '#e8a87c', '#f6c6a0', '#d9e4c8', '#f2b5a0', '#c9dbe0', '#efe0c8', '#e3b38a'],
  office: ['#dfe6ee', '#c4d2df', '#e9ecef', '#b8c7d6', '#d3dbe3'],
  shops: ['#f7e3c3', '#f4cfb5', '#e7ecd9', '#f9dfd0', '#e5d6ee'],
  trim: { residential: '#fff6ea', office: '#8fa3b8', shops: '#fff8ef' },
};
const AWNINGS = [['#e4574c', '#fff4e6'], ['#2f8f83', '#f5f1e6'], ['#f0a93b', '#fff7e8'], ['#3f6fb5', '#f2f4f8'], ['#8a5fb8', '#f6effa'], ['#d9546e', '#fff0f3']];

// ---------------------------------------------------------------- ground, roads & markings
function buildGround(root, B, H) {
  // diorama base: grass top + layered soil sides
  const base = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(BASE_X * 2, 0.6, BASE_Z * 2), mat('#8cc26b'));
  top.position.y = -0.3; top.receiveShadow = true;
  const soil = new THREE.Mesh(new THREE.BoxGeometry(BASE_X * 2 - 0.02, 2.4, BASE_Z * 2 - 0.02), mat('#9c7654'));
  soil.position.y = -1.8;
  const rock = new THREE.Mesh(new THREE.BoxGeometry(BASE_X * 2 - 0.6, 1.4, BASE_Z * 2 - 0.6), mat('#6e5a4b'));
  rock.position.y = -3.6;
  base.add(top, soil, rock);
  root.add(base);

  // asphalt covers the whole city footprint; blocks sit on top
  H.roadMat = new THREE.MeshStandardMaterial({ color: '#4b515c', roughness: 0.88, metalness: 0, envMapIntensity: 0.5 });
  const road = new THREE.Mesh(new THREE.BoxGeometry(CITY_X * 2, 0.04, CITY_Z * 2), H.roadMat);
  road.position.y = -0.015; road.receiveShadow = true;
  root.add(road);

  H.walkMat = new THREE.MeshStandardMaterial({ color: '#dcd5c8', roughness: 0.9, envMapIntensity: 0.45 });
  const curbMat = mat('#b9b1a3');
  // outer sidewalk ring
  const ow = OUTER_WALK;
  for (const s of [-1, 1]) {
    B.box(curbMat, CITY_X * 2 + ow * 2, SIDEWALK_Y, ow, 0, SIDEWALK_Y / 2, s * (CITY_Z + ow / 2));
    B.box(curbMat, ow, SIDEWALK_Y, CITY_Z * 2, s * (CITY_X + ow / 2), SIDEWALK_Y / 2, 0);
    B.box(H.walkMat, CITY_X * 2 + ow * 2, 0.02, ow - 0.3, 0, SIDEWALK_Y + 0.01, s * (CITY_Z + ow / 2 + 0.15));
    B.box(H.walkMat, ow - 0.3, 0.02, CITY_Z * 2 + 0.3, s * (CITY_X + ow / 2 + 0.15), SIDEWALK_Y + 0.01, 0);
  }

  // markings
  const white = mat('#f4f1e8', { roughness: 0.7 });
  const yellow = mat('#f2c94c', { roughness: 0.7 });
  const dash = new THREE.BoxGeometry(0.16, 0.02, 1.5);
  const y = 0.012;
  const nearNode = (v, arr) => arr.some(r => Math.abs(v - r) < CFG.road / 2 + 3.2);
  for (const x of ROAD_X) {
    for (let z = -CITY_Z + 1; z <= CITY_Z - 1; z += 2.6) if (!nearNode(z, ROAD_Z)) B.add(yellow, dash, x, y, z);
  }
  for (const z of ROAD_Z) {
    for (let x = -CITY_X + 1; x <= CITY_X - 1; x += 2.6) if (!nearNode(x, ROAD_X)) B.add(yellow, dash, x, y, z, Math.PI / 2);
  }
  // stop lines at signalised approaches
  for (let i = 0; i <= CFG.cols; i++) for (let j = 0; j <= CFG.rows; j++) {
    if (degree(i, j) < 3) continue;
    for (const [dx, dz] of DIRS) {
      if (!inGrid(i - dx, j - dz)) continue;               // approach from (i-dx, j-dz)
      const rx = -dz, rz = dx;
      const cx = ROAD_X[i] - dx * 6.9 + rx * LANE, cz = ROAD_Z[j] - dz * 6.9 + rz * LANE;
      B.box(white, dx !== 0 ? 0.3 : 3.5, 0.02, dx !== 0 ? 3.5 : 0.3, cx, y, cz);
    }
  }
  return { white };
}

function buildCrossings(layout, B, white) {
  const stripe = new THREE.BoxGeometry(0.46, 0.02, 2.1);
  for (const c of layout.crossings) {
    for (let k = -3.3; k <= 3.31; k += 0.95) {
      if (c.axis === 'x') B.add(white, stripe, c.x + k, 0.014, c.z);
      else B.add(white, stripe, c.x, 0.014, c.z + k, Math.PI / 2);
    }
  }
}

// ---------------------------------------------------------------- windows (instanced + night glow shader)
// Each window has a threshold aLit; it glows once the global uLit level passes it, so windows
// switch on one by one at dusk and off again late at night.
function makeWindowMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: '#3b5773', roughness: 0.16, metalness: 0.35, envMapIntensity: 1.25 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLit = U.uLit;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;\nvarying float vWY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;\nvWY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLit;\nvarying float vLit;\nvarying float vWY;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float on = smoothstep(vLit, vLit + 0.03, uLit);
        float hue = fract(vLit * 53.17);
        vec3 warm = mix(vec3(1.0, 0.56, 0.22), vec3(1.0, 0.83, 0.55), hue);
        warm = mix(warm, vec3(0.62, 0.78, 1.0), step(0.92, hue));
        float grad = 0.6 + 0.4 * smoothstep(0.5, -0.5, vWY);
        totalEmissiveRadiance += warm * on * grad * 2.4;
        diffuseColor.rgb *= 1.0 - on * 0.65;`);
  };
  return m;
}

function signTexture(name, bg, fg) {
  return canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.globalAlpha = 0.5; g.lineWidth = 3; g.strokeRect(5, 5, w - 10, h - 10); g.globalAlpha = 1;
    g.fillStyle = fg; g.font = '800 34px system-ui, -apple-system, Segoe UI, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, w / 2, h / 2 + 2);
  });
}
function stripeTexture(a, b) {
  return canvasTexture(128, 16, (g, w, h) => {
    for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? b : a; g.fillRect(k * 16, 0, 16, h); }
  });
}

// ---------------------------------------------------------------- buildings
function buildBuilding(bld, B, H, W, rng) {
  const { type, x, z, w, d, h, floors } = bld;
  const FH = CFG.floorH, y0 = SIDEWALK_Y + 0.02;
  const pal = PALETTE[type];
  const body = mat(pal[Math.floor(bld.seed * pal.length)]);
  const trim = mat(PALETTE.trim[type]);
  const roof = mat(type === 'office' ? '#8e99a6' : '#a59d93');
  const plinth = mat(type === 'office' ? '#5f6d7c' : '#b49a86');

  B.box(body, w, h, d, x, y0 + h / 2, z);
  B.box(plinth, w + 0.08, 0.32, d + 0.08, x, y0 + 0.16, z);
  B.box(roof, w - 0.06, 0.03, d - 0.06, x, y0 + h + 0.015, z);
  const pt = 0.16, ph = 0.3;                                              // parapet
  B.box(trim, w + 0.1, ph, pt, x, y0 + h + ph / 2, z - d / 2 + pt / 2 - 0.05);
  B.box(trim, w + 0.1, ph, pt, x, y0 + h + ph / 2, z + d / 2 - pt / 2 + 0.05);
  B.box(trim, pt, ph, d + 0.1, x - w / 2 + pt / 2 - 0.05, y0 + h + ph / 2, z);
  B.box(trim, pt, ph, d + 0.1, x + w / 2 - pt / 2 + 0.05, y0 + h + ph / 2, z);
  if (type !== 'office') for (let f = 1; f < floors; f++) B.box(trim, w + 0.07, 0.08, d + 0.07, x, y0 + f * FH, z);
  else for (let f = 3; f < floors; f += 3) B.box(trim, w + 0.07, 0.12, d + 0.07, x, y0 + f * FH, z);

  // roof props
  const top = y0 + h + 0.03;
  const gray = mat('#c9ced3'), dark = mat('#6c737c');
  if (type === 'office') {
    B.box(gray, 1.1, 0.55, 0.8, x - w * 0.18, top + 0.27, z + d * 0.15);
    B.box(gray, 0.8, 0.45, 0.8, x + w * 0.2, top + 0.22, z - d * 0.2);
    if (floors >= 12) {
      B.add(dark, new THREE.CylinderGeometry(0.05, 0.07, 3.2, 6), x + w * 0.25, top + 1.6, z + d * 0.25);
      H.beacons.push([x + w * 0.25, top + 3.25, z + d * 0.25]);
    }
  } else if (type === 'residential') {
    if (bld.seed > 0.45) {                                                // water tank
      const tx = x + w * 0.2, tz = z - d * 0.18, wood = mat('#9a6a45');
      B.add(wood, new THREE.CylinderGeometry(0.5, 0.5, 0.85, 12), tx, top + 0.85, tz);
      B.add(wood, new THREE.ConeGeometry(0.58, 0.4, 12), tx, top + 1.47, tz);
      for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) B.box(dark, 0.06, 0.45, 0.06, tx + ox, top + 0.22, tz + oz);
    } else {                                                              // rooftop garden
      B.box(mat('#7fb069'), w * 0.5, 0.12, d * 0.4, x - w * 0.1, top + 0.06, z + d * 0.1);
      for (let k = 0; k < 3; k++) H.roofBushes.push([x - w * 0.3 + k * w * 0.2, top + 0.3, z + d * 0.1, 0.28 + rng() * 0.1]);
    }
    B.box(gray, 0.5, 0.35, 0.5, x - w * 0.28, top + 0.17, z - d * 0.28);
  } else {
    B.box(gray, 0.9, 0.45, 0.7, x + w * 0.15, top + 0.22, z - d * 0.2);
  }

  // facades: windows, door, storefront
  const faces = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [fnx, fnz] of faces) {
    const L = fnx !== 0 ? d : w;
    const cx = x + fnx * w / 2, cz = z + fnz * d / 2;
    const tx = fnz !== 0 ? 1 : 0, tz = fnx !== 0 ? 1 : 0;
    const ry = Math.atan2(fnx, fnz);
    const doorFace = fnx === bld.nx && fnz === bld.nz;
    const office = type === 'office';
    const cols = office ? Math.max(2, Math.floor(L / 1.12)) : Math.max(2, Math.floor(L / 1.45));
    const ww = office ? 0.84 : 0.62, wh = office ? 1.15 : 0.88;
    const sp = L / cols;
    for (let f = 0; f < floors; f++) {
      if (f === 0 && doorFace && type === 'shops') continue;
      const wy = y0 + f * FH + FH * 0.56;
      for (let c = 0; c < cols; c++) {
        const a = -L / 2 + sp * (c + 0.5);
        if (f === 0 && doorFace && Math.abs(a - bld.doorA) < 0.95) continue;
        const px = cx + tx * a + fnx * 0.012, pz = cz + tz * a + fnz * 0.012;
        const r = rng();
        const lit = r < 0.12 ? 1.5 : office ? 0.04 + rng() * 0.62 : 0.08 + rng() * 0.9;
        W.push({ x: px, y: wy, z: pz, ry, sx: ww, sy: wh, lit });
        if (!office) B.box(trim, ww + 0.16, 0.08, 0.12, px + fnx * 0.04, wy - wh / 2 - 0.04, pz + fnz * 0.04, ry);
      }
    }
    if (doorFace) {
      const a = bld.doorA;
      const dx = cx + tx * a, dz = cz + tz * a;
      if (type === 'shops') {
        const glassW = L - 0.5;
        B.box(H.shopGlassMat, glassW, 1.3, 0.06, cx + fnx * 0.02, y0 + 0.95, cz + fnz * 0.02, ry);
        B.box(mat('#3a3f47'), glassW + 0.14, 0.1, 0.12, cx + fnx * 0.03, y0 + 1.63, cz + fnz * 0.03, ry);
        B.box(mat('#2c3036'), 0.85, 1.35, 0.09, dx + fnx * 0.03, y0 + 0.68, dz + fnz * 0.03, ry);
        const [ca, cb] = AWNINGS[Math.floor(bld.seed * 97) % AWNINGS.length];
        const awn = new THREE.MeshStandardMaterial({ map: stripeTexture(ca, cb), roughness: 0.8, envMapIntensity: 0.4 });
        B.add(awn, new THREE.BoxGeometry(L - 0.25, 0.05, 1.15), cx + fnx * 0.52, y0 + 1.72, cz + fnz * 0.52, ry, 0.36);
        B.add(mat(ca), new THREE.BoxGeometry(L - 0.25, 0.2, 0.04), cx + fnx * 1.06, y0 + 1.42, cz + fnz * 1.06, ry);
        const tex = signTexture(bld.shop.name, ca, cb);
        const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.05, roughness: 0.6 });
        H.signMats.push(signMat);
        const sw = Math.min(L * 0.7, 3.6);
        B.box(mat('#2c3036'), sw + 0.12, 0.62, 0.08, cx + fnx * 0.04, y0 + 2.32, cz + fnz * 0.04, ry);
        B.add(signMat, new THREE.PlaneGeometry(sw, sw / 4), cx + fnx * 0.09, y0 + 2.32, cz + fnz * 0.09, ry);
      } else {
        B.box(mat(office ? '#2e4257' : '#6b4a35'), 0.95, 1.4, 0.08, dx + fnx * 0.03, y0 + 0.7, dz + fnz * 0.03, ry);
        H.doorLights.push([dx + fnx * 0.25, y0 + 1.62, dz + fnz * 0.25]);
        B.add(trim, new THREE.BoxGeometry(1.4, 0.07, 0.6), dx + fnx * 0.3, y0 + 1.58, dz + fnz * 0.3, ry);
      }
    }
  }
}

// ---------------------------------------------------------------- props
function localToWorld(x, z, ry, lx, lz) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}
function addBench(B, x, z, face) {
  const ry = Math.atan2(face[0], face[1]);
  const wood = mat('#b87d4b'), metal = mat('#3d4450');
  const y0 = SIDEWALK_Y + 0.02;
  let [px, pz] = localToWorld(x, z, ry, 0, 0);
  B.box(wood, 1.35, 0.07, 0.44, px, y0 + 0.36, pz, ry);
  [px, pz] = localToWorld(x, z, ry, 0, -0.22);
  B.add(wood, new THREE.BoxGeometry(1.35, 0.3, 0.06), px, y0 + 0.6, pz, ry, -0.15);
  for (const lx of [-0.55, 0.55]) {
    [px, pz] = localToWorld(x, z, ry, lx, -0.02);
    B.box(metal, 0.07, 0.34, 0.42, px, y0 + 0.17, pz, ry);
  }
}

function buildPark(b, B, H) {
  const y0 = SIDEWALK_Y + 0.02;
  const grass = mat('#86c264'), path = mat('#e3cfa6'), stone = mat('#dcd6cb');
  B.box(grass, 13, 0.05, 13, b.cx, y0 + 0.025, b.cz);
  B.box(path, 1.35, 0.06, 13, b.cx, y0 + 0.03, b.cz);
  B.box(path, 13, 0.06, 1.35, b.cx, y0 + 0.03, b.cz);
  B.add(path, new THREE.CylinderGeometry(4.2, 4.2, 0.07, 40), b.cx, y0 + 0.035, b.cz);
  B.add(stone, new THREE.CylinderGeometry(1.95, 2.05, 0.5, 28), b.cx, y0 + 0.3, b.cz);
  B.add(stone, new THREE.CylinderGeometry(0.22, 0.34, 1.0, 12), b.cx, y0 + 0.55, b.cz);
  B.add(stone, new THREE.CylinderGeometry(0.75, 0.3, 0.26, 20), b.cx, y0 + 1.12, b.cz);
  H.waterMat = new THREE.MeshStandardMaterial({ color: '#6cc4e0', roughness: 0.08, metalness: 0.1, emissive: '#1b6f8f', emissiveIntensity: 0.1, envMapIntensity: 1.4 });
  B.add(H.waterMat, new THREE.CylinderGeometry(1.72, 1.72, 0.05, 28), b.cx, y0 + 0.47, b.cz);
  B.add(H.waterMat, new THREE.CylinderGeometry(0.62, 0.62, 0.04, 20), b.cx, y0 + 1.24, b.cz);
  const jetMat = new THREE.MeshStandardMaterial({ color: '#d9f3fb', transparent: true, opacity: 0.6, roughness: 0.1, emissive: '#7fd3ee', emissiveIntensity: 0.15 });
  H.jet = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.1, 10, 1, true), jetMat);
  H.jet.position.set(b.cx, y0 + 1.8, b.cz);
  H.jet.rotation.x = Math.PI;
  H.jetBaseY = y0 + 1.8;
  // flower beds between the paths
  const soil = mat('#7a5a43'), flowers = ['#ff7aa2', '#ffd166', '#ffffff', '#c77dff', '#ff9f68'];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, fx = b.cx + Math.cos(a) * 3.75, fz = b.cz + Math.sin(a) * 3.75;
    B.add(soil, new THREE.CylinderGeometry(0.62, 0.62, 0.12, 14), fx, y0 + 0.08, fz);
    for (let m = 0; m < 6; m++) {
      const fa = m * 1.047 + k, fr = 0.34;
      B.add(mat(flowers[(m + k) % flowers.length], { roughness: 0.6 }), new THREE.IcosahedronGeometry(0.13, 0), fx + Math.cos(fa) * fr, y0 + 0.2, fz + Math.sin(fa) * fr);
    }
    B.add(mat('#5c9e4b'), new THREE.IcosahedronGeometry(0.2, 0), fx, y0 + 0.22, fz);
  }
}

function buildTrees(layout, root, rng) {
  const round = [], pines = [];
  for (const b of layout.blocks) for (const t of b.trees) round.push({ ...t, y: SIDEWALK_Y + 0.02, cherry: t.park && rng() < 0.3 });
  for (const t of layout.outerTrees) (t.pine ? pines : round).push({ ...t, y: 0 });

  const dummy = new THREE.Object3D(), col = new THREE.Color();
  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 1, 6); trunkGeo.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat('#8a5f3f'), round.length + pines.length);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, envMapIntensity: 0.4 }), round.length * 2);
  const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, envMapIntensity: 0.4 }), pines.length * 2);
  const greens = ['#5fa052', '#6db35a', '#4f9150', '#7cbf5e', '#88c46a', '#5c9a45'];
  let ti = 0, ci = 0;
  round.forEach((t) => {
    const s = t.s, th = 1.1 * s;
    dummy.position.set(t.x, t.y, t.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(s, th, s); dummy.updateMatrix();
    trunks.setMatrixAt(ti++, dummy.matrix);
    const c = t.cherry ? '#f5a9c0' : greens[Math.floor(rng() * greens.length)];
    dummy.position.set(t.x, t.y + th + 0.55 * s, t.z); dummy.rotation.set(rng(), rng() * 6, 0); dummy.scale.set(0.95 * s, 0.85 * s, 0.95 * s); dummy.updateMatrix();
    crowns.setMatrixAt(ci, dummy.matrix); crowns.setColorAt(ci++, col.set(c));
    dummy.position.set(t.x + 0.3 * s, t.y + th + 1.05 * s, t.z - 0.2 * s); dummy.scale.set(0.6 * s, 0.55 * s, 0.6 * s); dummy.updateMatrix();
    crowns.setMatrixAt(ci, dummy.matrix); crowns.setColorAt(ci++, col.set(c).offsetHSL(0, 0, 0.05));
  });
  let pi = 0;
  pines.forEach((t) => {
    const s = t.s;
    dummy.position.set(t.x, 0, t.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(s * 0.8, 0.8 * s, s * 0.8); dummy.updateMatrix();
    trunks.setMatrixAt(ti++, dummy.matrix);
    const c = ['#3f7d4d', '#4a8a55', '#3b7447'][Math.floor(rng() * 3)];
    dummy.position.set(t.x, 0.8 * s + 0.9 * s, t.z); dummy.rotation.set(0, rng() * 6, 0); dummy.scale.set(1.1 * s, 1.9 * s, 1.1 * s); dummy.updateMatrix();
    cones.setMatrixAt(pi, dummy.matrix); cones.setColorAt(pi++, col.set(c));
    dummy.position.set(t.x, 0.8 * s + 2.0 * s, t.z); dummy.scale.set(0.8 * s, 1.4 * s, 0.8 * s); dummy.updateMatrix();
    cones.setMatrixAt(pi, dummy.matrix); cones.setColorAt(pi++, col.set(c).offsetHSL(0, 0, 0.04));
  });
  for (const m of [trunks, crowns, cones]) { m.castShadow = true; m.receiveShadow = true; root.add(m); }
}

// street lights: merged poles + emissive heads, additive ground pools, point-sprite halos
function buildStreetLights(layout, B, H, root) {
  const all = [...layout.blocks.flatMap(b => b.lights), ...layout.outerLights];
  const pole = mat('#3a424e', { roughness: 0.5, metalness: 0.4 });
  H.lampMat = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffc877', emissiveIntensity: 0 });
  const glowTex = radialTexture([[0, 'rgba(255,214,150,0.9)'], [0.4, 'rgba(255,190,120,0.35)'], [1, 'rgba(255,170,90,0)']]);
  H.poolMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const pools = [], halos = [];
  for (const l of all) {
    const baseY = SIDEWALK_Y;
    B.add(pole, new THREE.CylinderGeometry(0.06, 0.09, 3.6, 8), l.x, baseY + 1.8, l.z);
    const hx = l.x + l.nx * 0.85, hz = l.z + l.nz * 0.85;
    B.box(pole, l.nx ? 1.0 : 0.08, 0.08, l.nz ? 1.0 : 0.08, l.x + l.nx * 0.45, baseY + 3.55, l.z + l.nz * 0.45);
    B.box(pole, l.nx ? 0.5 : 0.36, 0.1, l.nz ? 0.5 : 0.36, hx, baseY + 3.52, hz);
    B.box(H.lampMat, l.nx ? 0.42 : 0.28, 0.06, l.nz ? 0.42 : 0.28, hx, baseY + 3.45, hz);
    pools.push([hx + l.nx * 0.2, hz + l.nz * 0.2]);
    halos.push(hx, baseY + 3.35, hz);
  }
  const poolGeo = new THREE.PlaneGeometry(6.4, 6.4); poolGeo.rotateX(-Math.PI / 2);
  const pm = new THREE.InstancedMesh(poolGeo, H.poolMat, pools.length);
  const dummy = new THREE.Object3D();
  pools.forEach(([x, z], k) => { dummy.position.set(x, 0.235, z); dummy.updateMatrix(); pm.setMatrixAt(k, dummy.matrix); });
  pm.renderOrder = 2;
  root.add(pm);
  H.pools = pm;
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(halos, 3));
  H.haloMat = new THREE.PointsMaterial({ map: radialTexture([[0, 'rgba(255,230,180,1)'], [0.25, 'rgba(255,200,130,0.5)'], [1, 'rgba(255,180,100,0)']]), size: 2.6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false });
  const pts = new THREE.Points(hg, H.haloMat);
  pts.renderOrder = 3;
  root.add(pts);
}

function buildSignals(B, H) {
  const pole = mat('#2f353d', { roughness: 0.5, metalness: 0.4 }), headM = mat('#22262c');
  const cols = { r: '#ff3b30', y: '#ffc300', g: '#2fe07a' };
  H.sig = {};
  for (const axis of ['x', 'z']) {
    H.sig[axis] = {};
    for (const k of ['r', 'y', 'g']) H.sig[axis][k] = new THREE.MeshStandardMaterial({ color: '#333', emissive: cols[k], emissiveIntensity: 0.1, roughness: 0.4 });
  }
  const lampGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const off = CFG.road / 2 + 0.45;
  for (let i = 0; i <= CFG.cols; i++) for (let j = 0; j <= CFG.rows; j++) {
    if (degree(i, j) < 3) continue;
    for (const [dx, dz] of DIRS) {
      if (!inGrid(i - dx, j - dz)) continue;
      const rx = -dz, rz = dx;
      const px = ROAD_X[i] - dx * off + rx * off, pz = ROAD_Z[j] - dz * off + rz * off;
      const ry = Math.atan2(-dx, -dz), axis = dx !== 0 ? 'x' : 'z';
      B.add(pole, new THREE.CylinderGeometry(0.06, 0.07, 2.9, 8), px, SIDEWALK_Y + 1.45, pz);
      B.box(headM, 0.3, 0.86, 0.26, px, SIDEWALK_Y + 3.0, pz, ry);
      ['r', 'y', 'g'].forEach((k, n) => B.add(H.sig[axis][k], lampGeo, px - dx * 0.14, SIDEWALK_Y + 3.27 - n * 0.27, pz - dz * 0.14));
    }
  }
}

// ---------------------------------------------------------------- public API
export function buildWorld(scene, sim) {
  const layout = sim.layout;
  const root = new THREE.Group();
  scene.add(root);
  const rng = makeRng(CFG.seed + 99);
  const H = { beacons: [], roofBushes: [], doorLights: [], signMats: [], U: { uLit: { value: 0 } } };
  const B = new Batcher();
  const { white } = buildGround(root, B, H);
  buildCrossings(layout, B, white);

  H.shopGlassMat = new THREE.MeshStandardMaterial({ color: '#34495c', roughness: 0.15, metalness: 0.2, emissive: '#ffc58a', emissiveIntensity: 0.15, envMapIntensity: 1.2 });
  const curb = mat('#b9b1a3'), lot = mat('#cbc2b2'), planter = mat('#6f5440'), hydrant = mat('#d64545', { roughness: 0.5 });
  const W = [];
  for (const b of layout.blocks) {
    B.box(curb, CFG.block, SIDEWALK_Y, CFG.block, b.cx, SIDEWALK_Y / 2, b.cz);
    B.box(H.walkMat, CFG.block - 0.36, 0.02, CFG.block - 0.36, b.cx, SIDEWALK_Y + 0.01, b.cz);
    if (b.park) buildPark(b, B, H);
    else {
      B.box(lot, 13, 0.02, 13, b.cx, SIDEWALK_Y + 0.02, b.cz);
      for (const bld of b.buildings) buildBuilding(bld, B, H, W, rng);
      for (const t of b.trees) B.box(planter, 0.9, 0.03, 0.9, t.x, SIDEWALK_Y + 0.025, t.z);
      const [hx, hz] = [b.cx + (HB - 0.45), b.cz + 7.2];
      B.add(hydrant, new THREE.CylinderGeometry(0.1, 0.13, 0.42, 8), hx, SIDEWALK_Y + 0.23, hz);
      B.add(hydrant, new THREE.SphereGeometry(0.11, 8, 6), hx, SIDEWALK_Y + 0.45, hz);
    }
    for (const bn of b.benches) addBench(B, bn.x, bn.z, bn.face);
  }
  for (const [x, y, z, r] of H.roofBushes) B.add(mat('#5e9e4a'), new THREE.IcosahedronGeometry(r, 0), x, y, z);
  H.beaconMat = new THREE.MeshStandardMaterial({ color: '#550000', emissive: '#ff2a2a', emissiveIntensity: 0.5 });
  for (const [x, y, z] of H.beacons) B.add(H.beaconMat, new THREE.SphereGeometry(0.12, 8, 6), x, y, z);
  buildStreetLights(layout, B, H, root);
  for (const [x, y, z] of H.doorLights) B.add(H.lampMat, new THREE.BoxGeometry(0.16, 0.1, 0.16), x, y, z);
  buildSignals(B, H);
  B.build(root);
  buildTrees(layout, root, rng);
  if (H.jet) root.add(H.jet);

  // windows: one instanced mesh for the whole city
  const wgeo = new THREE.PlaneGeometry(1, 1);
  const aLit = new Float32Array(W.length);
  const wm = new THREE.InstancedMesh(wgeo, makeWindowMaterial(H.U), W.length);
  const dummy = new THREE.Object3D();
  W.forEach((w, k) => {
    dummy.position.set(w.x, w.y, w.z); dummy.rotation.set(0, w.ry, 0); dummy.scale.set(w.sx, w.sy, 1); dummy.updateMatrix();
    wm.setMatrixAt(k, dummy.matrix); aLit[k] = w.lit;
  });
  wgeo.setAttribute('aLit', new THREE.InstancedBufferAttribute(aLit, 1));
  wm.receiveShadow = true;
  root.add(wm);
  H.windowCount = W.length;

  H.dry = { road: new THREE.Color('#4b515c'), walk: new THREE.Color('#dcd5c8') };
  H.wetC = { road: new THREE.Color('#2b3039'), walk: new THREE.Color('#a39d93') };
  H.root = root;
  return H;
}

// per-frame updates of emissive levels, wetness and traffic lights
export function updateWorld(H, sim, L, t) {
  H.U.uLit.value = L.windows;
  H.lampMat.emissiveIntensity = 3.4 * L.lamps;
  H.poolMat.opacity = 0.5 * L.lamps * (1 + 0.7 * sim.wet);
  H.haloMat.opacity = 0.8 * L.lamps;
  H.shopGlassMat.emissiveIntensity = 0.15 + 1.9 * L.shops;
  for (const m of H.signMats) m.emissiveIntensity = 0.05 + 1.1 * L.shops;
  H.beaconMat.emissiveIntensity = (Math.sin(t * 3.2) > 0.55 ? 5 : 0.25) * (0.35 + 0.65 * L.night);
  if (H.waterMat) H.waterMat.emissiveIntensity = 0.08 + 0.35 * L.night;
  if (H.jet) {
    const p = sim.paused ? 0 : 1;
    H.jet.scale.set(1 + 0.06 * Math.sin(t * 11 * p), 1 + 0.14 * Math.sin(t * 7.3 * p), 1 + 0.06 * Math.cos(t * 9 * p));
  }
  const w = sim.wet;
  H.roadMat.color.lerpColors(H.dry.road, H.wetC.road, w);
  H.roadMat.roughness = 0.88 - 0.68 * w;
  H.roadMat.metalness = 0.25 * w;
  H.walkMat.color.lerpColors(H.dry.walk, H.wetC.walk, w);
  H.walkMat.roughness = 0.9 - 0.5 * w;
  for (const axis of ['x', 'z']) {
    const s = sim.signal(axis).s;
    for (const k of ['r', 'y', 'g']) H.sig[axis][k].emissiveIntensity = k === s ? 3.2 : 0.06;
  }
}