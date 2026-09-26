// actors.js — visuals for pedestrians (fully instanced) and cars (small groups).
import * as THREE from 'three';
import { makeRng } from './sim.js';
import { radialTexture } from './world.js';

const SHIRTS = ['#e76f51', '#f4a261', '#2a9d8f', '#e9c46a', '#264653', '#8ab17d', '#f28482', '#84a59d', '#6d597a', '#b56576', '#4d908e', '#f9c74f', '#577590', '#fdfcdc', '#ff8fab', '#90be6d'];
const PANTS = ['#2b2d42', '#3d405b', '#5c677d', '#6b4f3a', '#1d3557', '#3a3a3a'];
const SKIN = ['#f1c7a5', '#e0ac85', '#c68863', '#8d5a3b', '#f6d5bd', '#a86f4c'];
const HAIR = ['#2b1d14', '#5a3825', '#d9a86c', '#1a1a1a', '#9a9a9a', '#b5542f', '#3b2a20'];
const UMBR = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#073b4c', '#f78c6b', '#9b5de5', '#222831', '#e63946', '#f1faee'];

export class PedestrianView {
  constructor(scene, peds) {
    const n = peds.length, rng = makeRng(4242);
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const std = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.75, envMapIntensity: 0.4, ...o });
    const legGeo = new THREE.BoxGeometry(0.11, 0.36, 0.13); legGeo.translate(0, -0.18, 0);
    const handle = new THREE.CylinderGeometry(0.014, 0.014, 0.62, 5);
    const hairGeo = new THREE.SphereGeometry(0.162, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    this.body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.17, 0.3, 3, 8), std(), n);
    this.head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 10, 8), std({ roughness: 0.6 }), n);
    this.hair = new THREE.InstancedMesh(hairGeo, std({ roughness: 0.9 }), n);
    this.legs = new THREE.InstancedMesh(legGeo, std(), n * 2);
    this.canopy = new THREE.InstancedMesh(new THREE.ConeGeometry(0.62, 0.26, 8, 1, true), std({ side: THREE.DoubleSide, roughness: 0.55 }), n);
    this.stick = new THREE.InstancedMesh(handle, std({ color: '#333' }), n);
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      this.body.setColorAt(k, c.set(pick(SHIRTS)));
      this.head.setColorAt(k, c.set(pick(SKIN)));
      this.hair.setColorAt(k, c.set(pick(HAIR)));
      const p = pick(PANTS);
      this.legs.setColorAt(2 * k, c.set(p)); this.legs.setColorAt(2 * k + 1, c.set(p));
      this.canopy.setColorAt(k, c.set(pick(UMBR)));
      peds[k].scale = 0.92 + rng() * 0.2;
    }
    this.all = [this.body, this.head, this.hair, this.legs, this.canopy, this.stick];
    for (const m of this.all) {
      m.castShadow = true; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }
    this.d = new THREE.Object3D();
    this.d.rotation.order = 'YXZ';
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  update(peds) {
    const d = this.d;
    const put = (mesh, idx, x, y, z, yaw, pitch = 0, s = 1, sy = s) => {
      d.position.set(x, y, z); d.rotation.set(pitch, yaw, 0); d.scale.set(s, sy, s); d.updateMatrix();
      mesh.setMatrixAt(idx, d.matrix);
    };
    for (let k = 0; k < peds.length; k++) {
      const p = peds[k];
      const vis = p.vis;
      if (vis < 0.03) {
        for (const m of [this.body, this.head, this.hair, this.canopy, this.stick]) m.setMatrixAt(k, this.zero);
        this.legs.setMatrixAt(2 * k, this.zero); this.legs.setMatrixAt(2 * k + 1, this.zero);
        continue;
      }
      const s = p.scale * (0.35 + 0.65 * vis);
      const yaw = Math.atan2(p.hx, p.hz);
      const rX = Math.cos(yaw), rZ = -Math.sin(yaw);
      const fX = Math.sin(yaw), fZ = Math.cos(yaw);
      const gy = p.ry;
      const sw = Math.sin(p.phase) * 0.62 * p.move;
      const bob = Math.abs(Math.cos(p.phase)) * 0.035 * p.move;
      const back = p.sitting ? -0.1 : 0;
      const bx = p.rx + fX * back, bz = p.rz + fZ * back;
      const hipY = gy + 0.36 * s;
      put(this.body, k, bx, gy + (0.62 + bob) * s, bz, yaw, p.sitting ? -0.08 : 0.05 * p.move, s);
      put(this.head, k, bx + fX * 0.02, gy + (1.0 + bob) * s, bz + fZ * 0.02, yaw, 0, s);
      put(this.hair, k, bx - fX * 0.015, gy + (1.02 + bob) * s, bz - fZ * 0.015, yaw, -0.25, s);
      for (const side of [-1, 1]) {
        const pitch = p.sitting ? -1.35 : sw * side;
        put(this.legs, 2 * k + (side > 0 ? 1 : 0), bx + rX * 0.085 * side * s, hipY + bob * s, bz + rZ * 0.085 * side * s, yaw, pitch, s);
      }
      const u = p.umb * vis;
      if (u > 0.02) {
        const ux = bx + rX * 0.16 * s + fX * 0.05, uz = bz + rZ * 0.16 * s + fZ * 0.05;
        put(this.canopy, k, ux, gy + (1.5 + bob) * s, uz, yaw + p.phase * 0.02, 0, s * u, s * (0.4 + 0.6 * u));
        put(this.stick, k, ux, gy + (1.2 + bob) * s, uz, yaw, 0, s * Math.min(1, u * 1.5), s * u);
      } else {
        this.canopy.setMatrixAt(k, this.zero); this.stick.setMatrixAt(k, this.zero);
      }
    }
    for (const m of this.all) m.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- cars
export class CarView {
  constructor(scene, cars) {
    this.groups = [];
    this.headMat = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff1c4', emissiveIntensity: 0.2 });
    const beamTex = radialTexture([[0, 'rgba(255,240,200,0.85)'], [0.5, 'rgba(255,230,180,0.3)'], [1, 'rgba(255,220,160,0)']]);
    this.beamMat = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const glass = new THREE.MeshStandardMaterial({ color: '#23313f', roughness: 0.12, metalness: 0.5, envMapIntensity: 1.3 });
    const tire = new THREE.MeshStandardMaterial({ color: '#1d1f23', roughness: 0.9 });
    const hub = new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.4, metalness: 0.6 });
    const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.24, 12); wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.26, 8); hubGeo.rotateZ(Math.PI / 2);
    const beamGeo = new THREE.PlaneGeometry(2.6, 5.5); beamGeo.rotateX(-Math.PI / 2);

    for (const car of cars) {
      const g = new THREE.Group();
      const L = car.len, spec = car.spec;
      const paint = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.32, metalness: 0.15, envMapIntensity: 0.9 });
      const tail = new THREE.MeshStandardMaterial({ color: '#5a0d0d', emissive: '#ff2a2a', emissiveIntensity: 0.3 });
      const add = (geo, m, x, y, z) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true; g.add(me); return me; };
      const W = car.type === 'bus' ? 2.0 : 1.6;
      let lightY = 0.62;
      if (car.type === 'bus') {
        add(new THREE.BoxGeometry(W, 1.9, L), paint, 0, 1.25, 0);
        add(new THREE.BoxGeometry(W + 0.02, 0.62, L - 0.9), glass, 0, 1.55, -0.15);
        add(new THREE.BoxGeometry(W - 0.2, 0.08, L - 0.6), new THREE.MeshStandardMaterial({ color: '#f7f4ec', roughness: 0.6 }), 0, 2.24, 0);
        add(new THREE.BoxGeometry(W - 0.1, 0.7, 0.04), glass, 0, 1.55, L / 2 + 0.005);
        add(new THREE.BoxGeometry(W + 0.03, 0.16, L - 0.2), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }), 0, 0.95, 0);
        lightY = 0.7;
      } else if (car.type === 'van') {
        add(new THREE.BoxGeometry(W, 1.35, L - 0.6), paint, 0, 1.0, -0.3);
        add(new THREE.BoxGeometry(W, 0.7, 0.9), paint, 0, 0.67, L / 2 - 0.45);
        add(new THREE.BoxGeometry(W - 0.1, 0.5, 0.5), glass, 0, 1.22, L / 2 - 0.75);
        add(new THREE.BoxGeometry(W + 0.02, 0.3, L - 1.2), new THREE.MeshStandardMaterial({ color: '#3f8fd2', roughness: 0.5 }), 0, 1.0, -0.4);
      } else {
        add(new THREE.BoxGeometry(W, 0.55, L), paint, 0, 0.6, 0);
        add(new THREE.BoxGeometry(W - 0.16, 0.46, L * 0.52), glass, 0, 1.1, -0.1);
        add(new THREE.BoxGeometry(W - 0.2, 0.06, L * 0.46), paint, 0, 1.35, -0.1);
        if (car.type === 'taxi') {
          add(new THREE.BoxGeometry(0.55, 0.18, 0.3), new THREE.MeshStandardMaterial({ color: '#222', emissive: '#ffe28a', emissiveIntensity: 0.6 }), 0, 1.47, -0.1);
          add(new THREE.BoxGeometry(W + 0.02, 0.1, L * 0.6), new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.6 }), 0, 0.6, 0);
        }
      }
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(0.3, 0.14, 0.05), this.headMat, sx * (W / 2 - 0.3), lightY, L / 2 + 0.01);
        add(new THREE.BoxGeometry(0.3, 0.12, 0.05), tail, sx * (W / 2 - 0.3), lightY, -L / 2 - 0.01);
      }
      const wheels = [];
      const wz = car.type === 'bus' ? [L / 2 - 1.1, -L / 2 + 1.1] : [L / 2 - 0.62, -L / 2 + 0.62];
      for (const z of wz) for (const sx of [-1, 1]) {
        const wg = new THREE.Group();
        wg.position.set(sx * (W / 2 - 0.08), 0.3, z);
        const t = new THREE.Mesh(wheelGeo, tire); t.castShadow = true;
        const h = new THREE.Mesh(hubGeo, hub);
        wg.add(t, h); g.add(wg); wheels.push(wg);
      }
      const beam = new THREE.Mesh(beamGeo, this.beamMat);
      beam.position.set(0, 0.04, L / 2 + 2.9);
      beam.renderOrder = 2;
      g.add(beam);
      scene.add(g);
      this.groups.push({ g, wheels, tail, car });
    }
  }
  update(L) {
    this.headMat.emissiveIntensity = 0.3 + 3.2 * L.lamps;
    this.beamMat.opacity = 0.55 * L.lamps;
    for (const o of this.groups) {
      const c = o.car;
      o.g.position.set(c.x, 0, c.z);
      o.g.rotation.y = Math.atan2(c.hx, c.hz);
      for (const w of o.wheels) w.rotation.x = c.odo / 0.3;
      o.tail.emissiveIntensity = (c.braking ? 3.2 : 0.35) + 1.2 * L.lamps;
    }
  }
}
