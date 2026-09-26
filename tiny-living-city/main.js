// main.js — Tiny Living City: renderer, camera, UI and the main loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sim, lerp, smoothstep } from './sim.js';
import { buildWorld, updateWorld } from './world.js';
import { PedestrianView, CarView } from './actors.js';
import { Atmosphere } from './atmosphere.js';

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 1, 1200);

const sim = new Sim();
const atmo = new Atmosphere(scene, renderer);
atmo.groundY = (x, z) => sim.groundY(x, z);
const world = buildWorld(scene, sim);
const pedView = new PedestrianView(scene, sim.peds);
const carView = new CarView(scene, sim.cars);

// post: subtle bloom that gets stronger at night (lamps, windows, signs glow)
const dpr = renderer.getPixelRatio();
const rt = new THREE.WebGLRenderTarget(window.innerWidth * dpr, window.innerHeight * dpr, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);          // multisampled HDR target keeps edges smooth
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.4, 0.55, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- camera
const HOME = { target: new THREE.Vector3(0, 1.5, 2), az: 0.62, polar: 0.93, dist: 128 };
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 22;
controls.maxDistance = 240;
controls.maxPolarAngle = 1.32;
controls.minPolarAngle = 0.12;
controls.screenSpacePanning = false;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.9;

function fitDist(d) {                           // keep the whole diorama framed on narrow screens
  const a = camera.aspect;
  return a < 1.55 ? d * Math.pow(1.55 / a, 0.85) : d;
}
function placeCamera(target, az, polar, dist) {
  camera.position.set(
    target.x + dist * Math.sin(polar) * Math.sin(az),
    target.y + dist * Math.cos(polar),
    target.z + dist * Math.sin(polar) * Math.cos(az));
  camera.lookAt(target);
}
function resetCamera() {
  controls.target.copy(HOME.target);
  placeCamera(HOME.target, HOME.az, HOME.polar, fitDist(HOME.dist));
  controls.update();
}
resetCamera();

// cinematic mode: slow orbit with breathing height / distance and occasional close fly-bys
const cine = { on: false, t: 0, blend: 0, pos: new THREE.Vector3(), look: new THREE.Vector3() };
function cinematicPose(t, outPos, outLook) {
  const az = 0.62 + t * 0.055;
  const w = 0.5 + 0.5 * Math.sin(t * 0.045);            // 0 = wide establishing, 1 = close street level
  const polar = lerp(0.9, 1.18, w);
  const dist = fitDist(lerp(125, 62, w));
  outLook.set(Math.sin(t * 0.03) * 10 * w, lerp(1.5, 3.0, w), Math.cos(t * 0.021) * 6 * w + 2);
  outPos.set(
    outLook.x + dist * Math.sin(polar) * Math.sin(az),
    outLook.y + dist * Math.cos(polar),
    outLook.z + dist * Math.sin(polar) * Math.cos(az));
}
function setCinematic(on) {
  cine.on = on;
  controls.enabled = !on;
  if (on) {
    // start the path at the camera's current azimuth so there is no jump
    const off = camera.position.clone().sub(controls.target);
    const az = Math.atan2(off.x, off.z);
    cine.t = (az - 0.62) / 0.055;
    cine.blend = 0;
    cine.fromPos = camera.position.clone();
    cine.fromLook = controls.target.clone();
  } else {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    // hand the current view back to the orbit controls (target on the ground plane)
    const tt = dir.y < -0.05 ? -(camera.position.y - 1.5) / dir.y : 80;
    controls.target.copy(camera.position).addScaledVector(dir, tt);
    controls.update();
  }
  ui.cine.classList.toggle('active', on);
  document.body.classList.toggle('cinematic', on);
}

// ---------------------------------------------------------------- UI
const $ = (id) => document.getElementById(id);
const ui = {
  clock: $('clock'), phase: $('phase'), icon: $('phaseIcon'),
  play: $('btnPlay'), weather: $('btnWeather'), cine: $('btnCine'),
  speeds: [...document.querySelectorAll('[data-speed]')],
  slider: $('timeSlider'), fps: $('fps'), stats: $('stats'),
};
function setSpeed(s) {
  sim.speed = s;
  ui.speeds.forEach(b => b.classList.toggle('active', +b.dataset.speed === s));
}
function setPaused(p) {
  sim.paused = p;
  ui.play.classList.toggle('paused', p);
  ui.play.setAttribute('aria-label', p ? 'Play' : 'Pause');
  ui.play.title = p ? 'Play (Space)' : 'Pause (Space)';
}
function setRain(r) {
  sim.setWeather(r);
  ui.weather.classList.toggle('rain', r);
  ui.weather.querySelector('.label').textContent = r ? 'Rain' : 'Clear';
}
ui.speeds.forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
ui.play.addEventListener('click', () => setPaused(!sim.paused));
ui.weather.addEventListener('click', () => setRain(sim.rainTarget < 0.5));
ui.cine.addEventListener('click', () => setCinematic(!cine.on));
$('btnHome').addEventListener('click', () => { if (cine.on) setCinematic(false); resetCamera(); });
ui.slider.addEventListener('input', () => { sim.hour = +ui.slider.value; });
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.key !== ' ') return;
  switch (e.key.toLowerCase()) {
    case ' ': setPaused(!sim.paused); e.preventDefault(); break;
    case '1': setSpeed(1); break;
    case '2': setSpeed(10); break;
    case '3': setSpeed(100); break;
    case 'r': setRain(sim.rainTarget < 0.5); break;
    case 'c': setCinematic(!cine.on); break;
    case 'h': document.body.classList.toggle('hide-ui'); break;
    case 'f': ui.stats.classList.toggle('show'); break;
    case 'home': case '0': if (cine.on) setCinematic(false); resetCamera(); break;
  }
});
// any manual drag cancels cinematic mode
canvas.addEventListener('pointerdown', () => { if (cine.on) setCinematic(false); }, { capture: true });
canvas.addEventListener('wheel', () => { if (cine.on) setCinematic(false); }, { passive: true, capture: true });

function phaseName(h) {
  if (h >= 5 && h < 7.5) return ['Sunrise', 'sunrise'];
  if (h >= 7.5 && h < 11.5) return ['Morning', 'day'];
  if (h >= 11.5 && h < 14) return ['Midday', 'day'];
  if (h >= 14 && h < 17.5) return ['Afternoon', 'day'];
  if (h >= 17.5 && h < 19.8) return ['Sunset', 'sunset'];
  if (h >= 19.8 && h < 23) return ['Evening', 'night'];
  return ['Night', 'night'];
}
let lastClockText = '', lastPhase = '';
function updateUI(L) {
  const h = sim.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  const txt = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  if (txt !== lastClockText) { ui.clock.textContent = txt; lastClockText = txt; }
  const [name, cls] = phaseName(h);
  const key = name + (sim.rain > 0.5 ? '/rain' : '');
  if (key !== lastPhase) {
    ui.phase.textContent = name + (sim.rain > 0.5 ? ' · Rain' : '');
    ui.icon.className = 'phase-icon ' + cls;
    lastPhase = key;
  }
  if (document.activeElement !== ui.slider) ui.slider.value = h.toFixed(3);
  document.body.classList.toggle('dark', L.night > 0.5);
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let elapsed = 0, fpsAcc = 0, fpsFrames = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsed += dt;
  sim.advance(dt);
  const L = atmo.update(sim, dt);
  updateWorld(world, sim, L, elapsed);
  pedView.update(sim.peds);
  carView.update(L);
  bloom.strength = lerp(0.18, 0.85, smoothstep(0.1, 0.8, Math.max(L.night, sim.rain * 0.4)));
  bloom.threshold = lerp(0.95, 0.72, L.night);

  if (cine.on) {
    cine.t += dt;
    cine.blend = Math.min(1, cine.blend + dt * 0.35);
    cinematicPose(cine.t, cine.pos, cine.look);
    const b = smoothstep(0, 1, cine.blend);
    camera.position.lerpVectors(cine.fromPos, cine.pos, b);
    const look = new THREE.Vector3().lerpVectors(cine.fromLook, cine.look, b);
    camera.lookAt(look);
    controls.target.copy(look);
  } else controls.update();

  updateUI(L);
  composer.render();

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 0.5) { ui.fps.textContent = Math.round(fpsFrames / fpsAcc) + ' fps'; fpsAcc = 0; fpsFrames = 0; }
  requestAnimationFrame(frame);
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w / 2, h / 2);
}
window.addEventListener('resize', onResize);

setSpeed(10);
setPaused(false);
setRain(false);
onResize();
resetCamera();
requestAnimationFrame(() => { document.body.classList.add('ready'); frame(); });

// handy for debugging / automated checks
window.__city = { sim, scene, camera, renderer, setSpeed, setRain, setPaused, setCinematic };