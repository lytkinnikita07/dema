import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";

import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

const $ = (id) => document.getElementById(id);

const settingsToggle = document.getElementById("settingsToggle");
const ui = document.getElementById("ui");

settingsToggle.addEventListener("click", () => {
  ui.classList.toggle("open");
});


// Renderer
const renderer = new THREE.WebGLRenderer({
  canvas: $("c"),
  antialias: true,
  powerPreference: "high-performance",
  alpha: false
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 12, 50);

// Camera + controls
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 1.65, 4.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 1.25, 0);
controls.maxDistance = 18;
controls.minDistance = 2.2;

// Lights
scene.add(new THREE.HemisphereLight(0xffffff, 0x080a10, 0.9));

const key = new THREE.DirectionalLight(0xffffff, 1.0);
key.position.set(5, 10, 4);
scene.add(key);

const rim = new THREE.DirectionalLight(0x88aaff, 0.22);
rim.position.set(-6, 3, -6);
scene.add(rim);

// Floor
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(10, 90),
  new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 1, metalness: 0 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
scene.add(floor);

// --- Soft particles (billboard sprites via Points) ---
function makeSoftParticleTexture() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.0, "rgba(255,255,255,0.55)");
  g.addColorStop(0.25, "rgba(255,255,255,0.20)");
  g.addColorStop(1.0, "rgba(255,255,255,0.00)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const particleTex = makeSoftParticleTexture();
const particleCount = 1200;

const particleGeom = new THREE.BufferGeometry();
const pos = new Float32Array(particleCount * 3);
const spd = new Float32Array(particleCount);

for (let i = 0; i < particleCount; i++) {
  const v = new THREE.Vector3().randomDirection().multiplyScalar(THREE.MathUtils.randFloat(2.5, 18));
  pos[i*3+0] = v.x;
  pos[i*3+1] = v.y * 0.35 + 1.2;
  pos[i*3+2] = v.z;
  spd[i] = THREE.MathUtils.randFloat(0.15, 0.6);
}

particleGeom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
particleGeom.setAttribute("aSpeed", new THREE.BufferAttribute(spd, 1));

const particles = new THREE.Points(
  particleGeom,
  new THREE.PointsMaterial({
    map: particleTex,
    transparent: true,
    opacity: 0.20,
    size: 0.35,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: 0x88aaff
  })
);
scene.add(particles);

// --- Selective bloom (only viruses) ---
const bloomLayer = new THREE.Layers();
bloomLayer.set(1);

const darkMaterial = new THREE.MeshBasicMaterial({ color: "black" });
const materials = new Map();

function darkenNonBloom(obj) {
  if (obj.isMesh && bloomLayer.test(obj.layers) === false) {
    materials.set(obj.uuid, obj.material);
    obj.material = darkMaterial;
  }
}
function restoreMaterial(obj) {
  if (materials.has(obj.uuid)) {
    obj.material = materials.get(obj.uuid);
    materials.delete(obj.uuid);
  }
}

const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  parseFloat($("bloomStrength").value),
  0.25, // radius
  0.62  // threshold
);

const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(renderScene);
bloomComposer.addPass(bloomPass);

const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(renderScene);

const finalPass = new ShaderPass(new THREE.ShaderMaterial({
  uniforms: {
    baseTexture: { value: null },
    bloomTexture: { value: bloomComposer.renderTarget2.texture }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D baseTexture;
    uniform sampler2D bloomTexture;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(baseTexture, vUv);
      vec4 bloom = texture2D(bloomTexture, vUv);
      gl_FragColor = base + bloom;
    }`
}), "baseTexture");
finalComposer.addPass(finalPass);

// FXAA
const fxaaPass = new ShaderPass(FXAAShader);
finalComposer.addPass(fxaaPass);

// Vignette
const vignettePass = new ShaderPass(new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.55 }, radius: { value: 0.75 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float radius;
    varying vec2 vUv;
    void main(){
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5;
      float d = length(p);
      float v = smoothstep(radius, 0.98, d);
      col.rgb *= (1.0 - v * strength);
      gl_FragColor = col;
    }`
}));
finalComposer.addPass(vignettePass);

function updateFXAA() {
  const pr = renderer.getPixelRatio();
  fxaaPass.material.uniforms["resolution"].value.set(1 / (window.innerWidth * pr), 1 / (window.innerHeight * pr));
}
updateFXAA();

// Loaders
const loader = new GLTFLoader();

// Human
loader.load("./assets/basic_human_mesh.glb", (gltf) => {
  const human = gltf.scene;

  human.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.frustumCulled = true;
      if (o.material) {
        o.material.roughness = Math.min(o.material.roughness ?? 0.9, 0.95);
        o.material.metalness = Math.min(o.material.metalness ?? 0.0, 0.2);
      }
    }
  });

  const box = new THREE.Box3().setFromObject(human);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  human.position.sub(center);

  const desiredHeight = 1.7;
  human.scale.setScalar(desiredHeight / Math.max(size.y, 0.0001));

  const box2 = new THREE.Box3().setFromObject(human);
  human.position.y -= box2.min.y;

  scene.add(human);
});

// Viruses (instanced)
let virusInstanced = null;
let virusData = [];
const dummy = new THREE.Object3D();
const qY = new THREE.Quaternion();
const qX = new THREE.Quaternion();
const axisY = new THREE.Vector3(0, 1, 0);
const axisX = new THREE.Vector3(1, 0, 0);
const tmp = new THREE.Vector3();

function makeMergedGeometry(root) {
  root.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const geoms = [];

  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    const m = new THREE.Matrix4().multiplyMatrices(invRoot, o.matrixWorld);
    g.applyMatrix4(m);
    geoms.push(g);
  });

  if (!geoms.length) return null;
  const merged = BufferGeometryUtils.mergeGeometries(geoms.map(g => g.toNonIndexed()), false);
  merged.computeVertexNormals();
  return merged;
}

function buildVirusData(count) {
  virusData = [];
  for (let i = 0; i < count; i++) {
    virusData.push({
      dir: new THREE.Vector3().randomDirection(),
      aY: Math.random() * Math.PI * 2,
      aX: Math.random() * Math.PI * 2,
      speed: THREE.MathUtils.randFloat(0.7, 1.45),
      phase: Math.random() * Math.PI * 2
    });
  }
}

function rebuildViruses(count) {
  if (!virusInstanced) return;

  const geom = virusInstanced.geometry;
  const mat = virusInstanced.material;

  scene.remove(virusInstanced);
  virusInstanced = new THREE.InstancedMesh(geom, mat, count);
  virusInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  virusInstanced.frustumCulled = true;
  virusInstanced.layers.enable(1); // bloom

  scene.add(virusInstanced);
  buildVirusData(count);
}

loader.load("./assets/influenzavirus.glb", (gltf) => {
  const geom = makeMergedGeometry(gltf.scene);
  if (!geom) return;

  const mat = new THREE.MeshStandardMaterial({
    color: 0x2fff5a,
    roughness: 0.35,
    metalness: 0.05,
    emissive: 0x15ff40,
    emissiveIntensity: 0.35
  });

  virusInstanced = new THREE.InstancedMesh(geom, mat, 1);
  virusInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  virusInstanced.layers.enable(1);
  scene.add(virusInstanced);

  rebuildViruses(parseInt($("count").value, 10));
});

// UI
$("count").addEventListener("input", () => rebuildViruses(parseInt($("count").value, 10)));
$("bloomStrength").addEventListener("input", () => bloomPass.strength = parseFloat($("bloomStrength").value));

// Music placeholder
const audio = new Audio("./assets/IAmYourShadow.mp3");
audio.loop = true;
audio.volume = 0.7;
$("playBtn").addEventListener("click", async () => {
  try { await audio.play(); } catch (e) {}
});

// Animate
const clock = new THREE.Clock();

function animate() {
  const t = clock.getElapsedTime();
  const speedMul = parseFloat($("speed").value);
  const vscale = parseFloat($("vscale").value);
  const radius = parseFloat($("radius").value);

  // auto camera
  if ($("autoCam").checked) {
    const ang = t * 0.08;
    const dist = 6.2;
    camera.position.x = Math.cos(ang) * dist;
    camera.position.z = Math.sin(ang) * dist;
  }

  // particle drift
  const pAttr = particles.geometry.getAttribute("position");
  const sAttr = particles.geometry.getAttribute("aSpeed");
  for (let i = 0; i < particleCount; i++) {
    const ix = i * 3;
    const sp = sAttr.getX(i);
    pAttr.array[ix + 1] += Math.sin(t * 0.2 + i) * 0.0003 * sp;
    if (pAttr.array[ix + 1] > 6) pAttr.array[ix + 1] = 0.5;
  }
  pAttr.needsUpdate = true;

  // virus sphere shell
  if (virusInstanced) {
    for (let i = 0; i < virusData.length; i++) {
      const d = virusData[i];
      d.aY += d.speed * speedMul * 0.008;
      d.aX += d.speed * speedMul * 0.004;

      qY.setFromAxisAngle(axisY, d.aY);
      qX.setFromAxisAngle(axisX, d.aX);

      tmp.copy(d.dir).applyQuaternion(qY).applyQuaternion(qX).multiplyScalar(radius);
      tmp.y += Math.sin(t * 1.1 + d.phase) * 0.06;

      dummy.position.set(tmp.x, tmp.y + 1.25, tmp.z);
      dummy.rotation.set(0, d.aY + t * 0.2, 0);
      dummy.scale.setScalar(vscale);
      dummy.updateMatrix();
      virusInstanced.setMatrixAt(i, dummy.matrix);
    }
    virusInstanced.instanceMatrix.needsUpdate = true;
  }

  controls.update();

  if ($("bloomOn").checked) {
    scene.traverse(darkenNonBloom);
    bloomComposer.render();
    scene.traverse(restoreMaterial);
    finalComposer.render();
  } else {
    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  bloomComposer.setSize(window.innerWidth, window.innerHeight);
  finalComposer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth, window.innerHeight);
  updateFXAA();
});
