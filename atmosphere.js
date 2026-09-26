// atmosphere.js — sky, sun/moon, time-of-day palette, clouds, stars, rain and splashes.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, makeRng } from './sim.js';

// Time-of-day keyframes. All the colour grading of the diorama comes from here.
const KEYS = [
  { h: 0.0,  top: '#0a1330', hor: '#1f2d52', bot: '#0d1224', sun: '#8aa2ff', sunI: 0.55, sky: '#4a5f9e', gnd: '#1c2033', hemi: 0.75, exp: 1.12 },
  { h: 4.6,  top: '#0c1634', hor: '#28365e', bot: '#0d1224', sun: '#8aa2ff', sunI: 0.5,  sky: '#4a5f9e', gnd: '#1c2033', hemi: 0.75, exp: 1.12 },
  { h: 5.7,  top: '#3a5890', hor: '#f4a58a', bot: '#3a3448', sun: '#ffb08a', sunI: 1.0,  sky: '#9aa9d6', gnd: '#5a4a55', hemi: 0.85, exp: 1.05 },
  { h: 7.2,  top: '#6ba3de', hor: '#d9e7ef', bot: '#8a9aa6', sun: '#ffeccd', sunI: 2.3,  sky: '#c3dbf5', gnd: '#7d7560', hemi: 0.95, exp: 1.0 },
  { h: 12.0, top: '#4d93e4', hor: '#cfe6f6', bot: '#9fb2bf', sun: '#fffaf0', sunI: 2.9,  sky: '#d2e6ff', gnd: '#857a62', hemi: 1.0,  exp: 0.95 },
  { h: 16.3, top: '#5a94d8', hor: '#eadfc9', bot: '#a5a698', sun: '#ffe3b3', sunI: 2.6,  sky: '#cfe0f5', gnd: '#877a60', hemi: 0.95, exp: 0.97 },
  { h: 17.9, top: '#4d6aa8', hor: '#ffb277', bot: '#8a6a60', sun: '#ff9f5a', sunI: 2.1,  sky: '#e3b39a', gnd: '#6b4e42', hemi: 0.85, exp: 1.0 },
  { h: 18.9, top: '#2c3a78', hor: '#ff7e5f', bot: '#5a3a48', sun: '#ff7a45', sunI: 1.1,  sky: '#b88aa0', gnd: '#4a3440', hemi: 0.8,  exp: 1.05 },
  { h: 19.8, top: '#161f4e', hor: '#7a4a78', bot: '#1d1a30', sun: '#9c86ff', sunI: 0.5,  sky: '#5a5a96', gnd: '#2a2438', hemi: 0.75, exp: 1.1 },
  { h: 21.0, top: '#0b1432', hor: '#243058', bot: '#0d1224', sun: '#8aa2ff', sunI: 0.55, sky: '#4a5f9e', gnd: '#1c2033', hemi: 0.75, exp: 1.12 },
];
const COLOR_KEYS = ['top', 'hor', 'bot', 'sun', 'sky', 'gnd'];
for (const k of KEYS) for (const c of COLOR_KEYS) k[c] = new THREE.Color(k[c]);
const RAIN_DAY = { top: new THREE.Color('#7b8794'), hor: new THREE.Color('#a9b2ba'), bot: new THREE.Color('#6d767e') };
const RAIN_NIGHT = { top: new THREE.Color('#10151f'), hor: new THREE.Color('#1f2733'), bot: new THREE.Color('#0c1018') };

function sampleKeys(hour, out) {
  let a = KEYS[KEYS.length - 1], b = KEYS[0], t = 0;
  for (let i = 0; i < KEYS.length; i++) {
    const k0 = KEYS[i], k1 = KEYS[(i + 1) % KEYS.length];
    const h1 = i + 1 < KEYS.length ? k1.h : k1.h + 24;
    if (hour >= k0.h && hour < h1) { a = k0; b = k1; t = (hour - k0.h) / (h1 - k0.h); break; }
  }
  t = t * t * (3 - 2 * t);
  for (const c of COLOR_KEYS) out[c].lerpColors(a[c], b[c], t);
  for (const n of ['sunI', 'hemi', 'exp']) out[n] = lerp(a[n], b[n], t);
  return out;
}

const SKY_VERT = `varying vec3 vDir;
void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uBot; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uDisc;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 col = mix(uHor, uTop, smoothstep(0.0, 0.6, d.y));
  col = mix(col, uBot, smoothstep(0.0, -0.3, d.y));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(s, 6.0) * 0.28 + pow(s, 60.0) * 0.35 + smoothstep(0.9985, 0.9992, s) * uDisc);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Atmosphere {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.cur = { top: new THREE.Color(), hor: new THREE.Color(), bot: new THREE.Color(), sun: new THREE.Color(), sky: new THREE.Color(), gnd: new THREE.Color() };
    this.U = {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uBot: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uDisc: { value: 1 },
    };
    const skyMat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), skyMat);
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    // separate tiny scene used to bake a sky reflection map (PMREM) for glossy windows / wet roads
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null; this.envTimer = 0; this.envKey = '';

    // stars
    const rng = makeRng(77), sp = [];
    for (let i = 0; i < 900; i++) {
      const u = rng() * Math.PI * 2, v = 0.08 + rng() * 0.92;
      const r = 420, y = v, rr = Math.sqrt(1 - y * y);
      sp.push(Math.cos(u) * rr * r, y * r, Math.sin(u) * rr * r);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(sg, this.starMat);
    scene.add(this.stars);

    // lights
    this.hemi = new THREE.HemisphereLight('#ffffff', '#666666', 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.5);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -66; sc.right = 66; sc.top = 66; sc.bottom = -66; sc.near = 1; sc.far = 300;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);
    scene.fog = new THREE.Fog('#cfe6f6', 170, 520);

    this.buildClouds();
    this.buildRain();
  }

  buildClouds() {
    // clouds live on a ring around the diorama so they frame it without ever blocking the view
    const rng = makeRng(9);
    this.cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, transparent: true, opacity: 0.94, envMapIntensity: 0.3 });
    this.cloudRing = new THREE.Group();
    this.clouds = [];
    const geo = new THREE.IcosahedronGeometry(1, 1);
    for (let c = 0; c < 14; c++) {
      const g = new THREE.Group();
      const puffs = 4 + Math.floor(rng() * 4);
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(geo, this.cloudMat);
        const s = 2.6 + rng() * 2.8;
        m.position.set((p - puffs / 2) * 3.0 + rng(), rng() * 1.4, rng() * 2.5 - 1.25);
        m.scale.set(s * 1.25, s * 0.75, s);
        g.add(m);
      }
      const a = (c / 14) * Math.PI * 2 + rng() * 0.3, r = 125 + rng() * 55;
      g.position.set(Math.cos(a) * r, 18 + rng() * 26, Math.sin(a) * r);
      g.rotation.y = -a + Math.PI / 2;
      this.cloudRing.add(g);
      this.clouds.push(g);
    }
    this.scene.add(this.cloudRing);
  }

  buildRain() {
    const N = 3200;
    this.rainN = N;
    this.rainPos = new Float32Array(N * 6);
    this.rainVel = new Float32Array(N);
    for (let i = 0; i < N; i++) this.resetDrop(i, Math.random() * 55);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMat = new THREE.LineBasicMaterial({ color: '#c3d2e4', transparent: true, opacity: 0, depthWrite: false });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
    // splashes: tiny expanding rings
    this.splashN = 220;
    const rg = new THREE.RingGeometry(0.06, 0.13, 12); rg.rotateX(-Math.PI / 2);
    this.splashMat = new THREE.MeshBasicMaterial({ color: '#e3edf8', transparent: true, opacity: 0, depthWrite: false });
    this.splash = new THREE.InstancedMesh(rg, this.splashMat, this.splashN);
    this.splash.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splash.frustumCulled = false;
    this.splashLife = new Float32Array(this.splashN).fill(1);
    this.splashXYZ = new Float32Array(this.splashN * 3);
    this.splashNext = 0;
    this.scene.add(this.splash);
    this.d = new THREE.Object3D();
  }

  resetDrop(i, y) {
    const p = this.rainPos, o = i * 6;
    const x = (Math.random() * 2 - 1) * 80, z = (Math.random() * 2 - 1) * 65;
    p[o] = x; p[o + 1] = y; p[o + 2] = z;
    p[o + 3] = x - 0.12; p[o + 4] = y - 1.0; p[o + 5] = z - 0.04;
    this.rainVel[i] = 34 + Math.random() * 10;
  }

  // Returns lighting levels used by the world / actors: { night, lamps, windows, shops }.
  update(sim, dt) {
    const hour = sim.hour, rain = sim.rain, S = sim.sun;
    const c = sampleKeys(hour, this.cur);
    const night = S.night;
    // rain palette: overcast grey by day, deep blue-grey by night
    const rd = rain * 0.78;
    const tmp = this._tmp || (this._tmp = new THREE.Color());
    for (const k of ['top', 'hor', 'bot']) {
      tmp.lerpColors(RAIN_DAY[k], RAIN_NIGHT[k], night);
      c[k].lerp(tmp, rd);
    }
    this.U.uTop.value.copy(c.top); this.U.uHor.value.copy(c.hor); this.U.uBot.value.copy(c.bot);
    this.U.uSunDir.value.set(S.dir[0], S.dir[1], S.dir[2]);
    this.U.uSunCol.value.copy(c.sun).multiplyScalar(1 - 0.85 * rain);
    this.U.uDisc.value = (S.isDay ? 1.6 : 0.9) * (1 - rain);

    // lights
    const sunI = c.sunI * (1 - 0.62 * rain);
    this.sun.color.copy(c.sun);
    this.sun.intensity = sunI;
    this.sun.position.set(S.dir[0] * 110, S.dir[1] * 110, S.dir[2] * 110);
    this.sun.target.position.set(0, 0, 0);
    this.hemi.color.copy(c.sky).lerp(tmp.set('#9aa3ad'), rain * 0.5);
    this.hemi.groundColor.copy(c.gnd);
    this.hemi.intensity = c.hemi * (1 - 0.15 * rain) * (1.0 + 0.25 * night);
    this.renderer.toneMappingExposure = c.exp * (1 - 0.06 * rain);
    this.scene.fog.color.copy(c.hor);
    this.scene.fog.near = lerp(170, 70, rain);
    this.scene.fog.far = lerp(520, 260, rain);
    this.starMat.opacity = smoothstep(0.35, 0.95, night) * (1 - rain) * 0.9;
    this.stars.rotation.y = hour * 0.02;

    // clouds drift, thicken and darken with rain
    const cloudCol = tmp.copy(c.hor).lerp(new THREE.Color('#ffffff'), 0.55 * (1 - night)).lerp(new THREE.Color('#6b7580'), rain * 0.6);
    this.cloudMat.color.copy(cloudCol);
    const cloudDt = sim.paused ? 0 : dt * (1 + Math.log10(sim.speed) * 1.5);
    this.cloudRing.rotation.y += cloudDt * 0.006 * (1 + rain);
    const cs = 1 + 0.35 * rain;
    for (const g of this.clouds) g.scale.set(cs, 1 + 0.2 * rain, cs);

    // rain streaks (real time, so it always looks like rain — not a strobe at 100x)
    const rv = rain > 0.01;
    this.rain.visible = rv;
    this.rainMat.opacity = 0.55 * rain;
    this.rainMat.color.set(night > 0.5 ? '#8fa3bf' : '#c9d6e6');
    if (rv) {
      const p = this.rainPos;
      const active = Math.floor(this.rainN * clamp(rain * 1.2, 0, 1));
      for (let i = 0; i < this.rainN; i++) {
        const o = i * 6;
        if (i >= active) { p[o + 1] = p[o + 4] = -50; continue; }
        const dy = this.rainVel[i] * dt;
        p[o + 1] -= dy; p[o + 4] -= dy; p[o] -= dy * 0.12; p[o + 3] -= dy * 0.12;
        if (p[o + 4] < 0.1) {
          if (Math.random() < 0.07) this.spawnSplash(p[o + 3], p[o + 5]);
          this.resetDrop(i, 40 + Math.random() * 15);
        } else if (p[o + 1] < -40) this.resetDrop(i, Math.random() * 55);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    // splashes
    const d = this.d;
    this.splashMat.opacity = 0.55 * rain;
    this.splash.visible = rv;
    if (rv) {
      for (let i = 0; i < this.splashN; i++) {
        this.splashLife[i] = Math.min(1, this.splashLife[i] + dt * 3.2);
        const l = this.splashLife[i];
        const s = l >= 1 ? 0 : 0.4 + l * 2.2;
        d.position.set(this.splashXYZ[i * 3], this.splashXYZ[i * 3 + 1], this.splashXYZ[i * 3 + 2]);
        d.scale.set(s, s, s); d.updateMatrix();
        this.splash.setMatrixAt(i, d.matrix);
      }
      this.splash.instanceMatrix.needsUpdate = true;
    }

    // re-bake the sky reflection map occasionally (cheap: 1 small scene)
    this.envTimer -= dt;
    const key = c.hor.getHexString() + c.top.getHexString();
    if (this.envTimer <= 0 && key !== this.envKey) {
      this.envTimer = 0.35;
      this.envKey = key;
      const rt = this.pmrem.fromScene(this.envScene, 0.02);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    }

    // lighting levels for the city
    const h = hour;
    let win;                                   // fraction of windows lit (thresholded per window)
    if (h >= 8 && h < 16) win = 0;
    else if (h >= 16 && h < 20) win = smoothstep(16.6, 19.6, h) * 0.95;
    else if (h >= 20 && h < 22) win = 0.95;
    else if (h >= 22) win = lerp(0.95, 0.5, smoothstep(22, 24, h));
    else if (h < 4.5) win = lerp(0.5, 0.3, smoothstep(0, 3, h));
    else if (h < 6.3) win = lerp(0.3, 0.55, smoothstep(4.5, 6.2, h));
    else win = lerp(0.55, 0, smoothstep(6.3, 8, h));
    win = Math.max(win, rain * 0.3);
    const lamps = Math.max(smoothstep(0.25, 0.65, night), rain * 0.35);
    const open = (h > 7 && h < 22.5) ? 1 : 0.15;
    const shops = Math.max(smoothstep(0.2, 0.7, night), rain * 0.5) * open;
    return { night, lamps, windows: win, shops };
  }

  spawnSplash(x, z) {
    if (Math.abs(x) > 52 || Math.abs(z) > 40) return;
    const i = this.splashNext = (this.splashNext + 1) % this.splashN;
    let y = 0.03;
    if (this.groundY) y = this.groundY(x, z) + 0.03;
    this.splashXYZ[i * 3] = x; this.splashXYZ[i * 3 + 1] = y; this.splashXYZ[i * 3 + 2] = z;
    this.splashLife[i] = 0;
  }
}