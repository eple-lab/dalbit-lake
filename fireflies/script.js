'use strict';
// 반딧불이 모으기 — 요정의 눈(1인칭)으로 달빛 호수 숲을 날며 반딧불이 5마리를 병에 담는 3D 게임.
// 규칙은 docs/fireflies-prd.md를 따릅니다.

// ===================================================================
// 기본 값
// ===================================================================
const LAKE_R = 28;          // 호수 반지름
const WORLD_R = 72;         // 날 수 있는 범위
const DRAGON_R = 11;        // 용이 헤엄치는 둥근 길
const MAX_SPEED = 14;
const ACCEL = 9;            // ↑ 누르고 있을 때 빨라지는 정도 (초당)
const BRAKE = 12;           // ↓ 누르고 있을 때 느려지는 정도
const COAST = 1.4;          // 손을 떼면 점점 느려지는 정도
const FAST = 7.5;           // 이보다 빠르면 반딧불이가 흩어져요
const CALL_RANGE = 13;      // 손을 내밀면 이 거리 안의 반딧불이가 다가와요
const SPEED_NAMES = ['둥둥', '느림', '느림', '빠름', '빠름'];
const speedStep = s => s < 0.3 ? 0 : s < 3.8 ? 1 : s < FAST ? 2 : s < 11 ? 3 : 4;
const TIME_LIMIT = 180;
const GOAL = 5;
const MIN_Y = 1.1, MAX_Y = 38;
const START = new THREE.Vector3(0, 6, LAKE_R + 7);

const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
function angleLerp(a, b, k) {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261028);
const rr = (a, b) => a + rand() * (b - a);
const setLayer = (obj, n) => obj.traverse(o => o.layers.set(n));

// ===================================================================
// 렌더러, 장면, 카메라
// ===================================================================
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060a1c);
scene.fog = new THREE.FogExp2(0x0b1230, 0.014);

// 메인 화면: 요정의 눈. 레이어 0 = 세상, 레이어 2 = 내 팔·다리·병
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 900);
camera.rotation.order = 'YXZ';
scene.add(camera);

// 오른쪽 위 작은 창: 뒤쪽 위에서 따라가는 3인칭. 레이어 1 = 요정 모습
const miniCam = new THREE.PerspectiveCamera(50, 1.5, 0.5, 900);
miniCam.layers.enable(1);

function std(color, extra) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.95, metalness: 0, flatShading: true }, extra));
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.22, 'rgba(255,255,255,.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW = makeGlowTexture();
function glowSprite(color, size, opacity) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW, color, transparent: true, opacity: opacity == null ? 1 : opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  s.scale.setScalar(size);
  return s;
}

// ===================================================================
// 하늘, 달, 별
// ===================================================================
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(600, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x02040f) }, bottom: { value: new THREE.Color(0x1d2758) } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.55, h)), 1.0); }',
  })
);
scene.add(sky);

{
  const n = 1400, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rand() * Math.PI * 2, v = rr(0.04, 1);
    const r = 560, ch = Math.sqrt(1 - v * v);
    pos.set([Math.cos(u) * ch * r, v * r, Math.sin(u) * ch * r], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xdfe7ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 })));
}

const MOON_DIR = new THREE.Vector3(-0.45, 0.4, -0.8).normalize();
{
  // 달은 화면 가장자리에서도 둥글게 보이도록 스프라이트로 그려요
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f6f1dc';
  g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(180,176,160,.35)';
  for (const [x, y, r] of [[44, 50, 14], [80, 74, 10], [60, 92, 8], [86, 40, 6]]) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false, depthWrite: false }));
  moon.scale.setScalar(44);
  moon.position.copy(MOON_DIR).multiplyScalar(480);
  scene.add(moon);
  const halo = glowSprite(0xc9d6ff, 230, 0.55);
  halo.position.copy(moon.position);
  scene.add(halo);
}

scene.add(new THREE.HemisphereLight(0x7282c8, 0x0c1a14, 0.65));
scene.add(new THREE.AmbientLight(0x222a48, 0.4));
{
  const moonLight = new THREE.DirectionalLight(0xc8d6ff, 0.75);
  moonLight.position.copy(MOON_DIR).multiplyScalar(100);
  scene.add(moonLight);
}
// 요정이 품은 작은 빛 — 팔과 가까운 나무를 은은하게 비춤
const fairyLight = new THREE.PointLight(0xffe2b0, 0.9, 4.5);
camera.add(fairyLight);

// ===================================================================
// 땅, 호수, 먼 산
// ===================================================================
{
  const ground = new THREE.Mesh(new THREE.CircleGeometry(170, 64), std(0x13261c));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const shore = new THREE.Mesh(new THREE.RingGeometry(LAKE_R - 0.5, LAKE_R + 3, 64), std(0x2b3a2c));
  shore.rotation.x = -Math.PI / 2;
  shore.position.y = 0.02;
  scene.add(shore);

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(LAKE_R, 64),
    new THREE.MeshLambertMaterial({ color: 0x1a2860, emissive: 0x070d28 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.05;
  scene.add(water);

  // 물 위의 반짝이는 달빛 길
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 256; y += 2) {
    const w = 10 + Math.random() * 44;
    g.fillStyle = `rgba(235,240,255,${Math.random() * 0.8})`;
    g.fillRect(32 - w / 2, y, w, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(9, LAKE_R * 1.7),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.09, -LAKE_R * 0.1);
  const holder = new THREE.Group();
  holder.rotation.y = Math.atan2(-MOON_DIR.x, -MOON_DIR.z);
  holder.add(path);
  scene.add(holder);
  path.userData.tex = tex;
  window.moonPath = path;

  const hillMat = new THREE.MeshBasicMaterial({ color: 0x0b1230 });
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + rr(-0.05, 0.05), d = rr(150, 185), h = rr(25, 60);
    const hill = new THREE.Mesh(new THREE.ConeGeometry(rr(30, 50), h, 6), hillMat);
    hill.position.set(Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d);
    scene.add(hill);
  }

  // 풀숲의 작은 꽃빛
  const n = 500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const palette = [[0.55, 0.6, 1], [0.8, 0.55, 1], [0.6, 0.95, 0.9], [1, 0.85, 0.6]];
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, d = rr(LAKE_R + 3, 110);
    pos.set([Math.cos(a) * d, rr(0.1, 0.5), Math.sin(a) * d], i * 3);
    col.set(palette[Math.floor(rand() * palette.length)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, opacity: 0.7 })));
}

// ===================================================================
// 나무 — 아주 크고 긴 나무 / 넓고 짧은 나무 / 길고 가는 나무
// ===================================================================
const trees = [];     // 부딪힘 판정용
const branches = [];  // 앉을 수 있는 가지
const barkMat = std(0x3b2b23);
const leafMats = [0x1e4a36, 0x245a3c, 0x1b4040, 0x2f5f3d].map(c => std(c));

function addTree(type, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  scene.add(g);
  const leaf = leafMats[Math.floor(rand() * leafMats.length)];
  const t = { x, z, trunkR: 0, trunkTop: 0, trunkH: 0, canopy: [] };

  const trunk = (rTop, rBot, h) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 7), barkMat);
    m.position.y = h / 2;
    g.add(m);
    t.trunkR = rBot; t.trunkTop = rTop; t.trunkH = h;
  };
  const ball = (y, r, sy, dx, dz) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leaf);
    m.position.set(dx || 0, y, dz || 0);
    m.scale.y = sy;
    m.rotation.y = rand() * 6;
    g.add(m);
    t.canopy.push({ c: new THREE.Vector3(x + (dx || 0), y, z + (dz || 0)), r: r * 0.92, sy });
  };
  const branch = (y, len) => {
    const a = rand() * Math.PI * 2;
    const r0 = t.trunkR * lerp(1, t.trunkTop / t.trunkR, y / t.trunkH) * 0.8;
    const geo = new THREE.CylinderGeometry(0.22, 0.34, len, 6);
    geo.rotateZ(Math.PI / 2);
    geo.translate(len / 2, 0, 0);
    const m = new THREE.Mesh(geo, barkMat);
    m.position.set(Math.cos(a) * r0, y, Math.sin(a) * r0);
    m.rotation.y = -a;
    g.add(m);
    const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 0), leaf);
    tuft.position.set(Math.cos(a) * (r0 + len), y + 0.4, Math.sin(a) * (r0 + len));
    g.add(tuft);
    branches.push({
      ax: x + Math.cos(a) * r0, az: z + Math.sin(a) * r0,
      bx: x + Math.cos(a) * (r0 + len * 0.85), bz: z + Math.sin(a) * (r0 + len * 0.85),
      top: y + 0.32,
    });
  };

  if (type === 'giant') {
    const h = rr(30, 42), r = rr(1.6, 2.2);
    trunk(r * 0.55, r, h);
    ball(h * 0.72, rr(7, 8.5), 0.8);
    ball(h * 0.88, rr(5.5, 6.5), 0.85);
    ball(h + 1.5, rr(3.8, 4.6), 1);
    branch(rr(7, 10), rr(5, 6.5));
    branch(rr(13, 17), rr(5, 6.5));
    branch(rr(19, 23), rr(4, 5.5));
  } else if (type === 'wide') {
    const h = rr(5, 7.5), r = rr(1.1, 1.5);
    trunk(r * 0.8, r, h);
    const cr = rr(7, 8.5);
    ball(h + 2.4, cr, 0.5);
    ball(h + 3.4, cr * 0.55, 0.7, rr(-2, 2), rr(-2, 2));
    branch(h * 0.65, rr(4, 5));
  } else if (type === 'thin') {
    const h = rr(19, 27), r = rr(0.45, 0.65);
    trunk(r * 0.6, r, h);
    const ch = h * 0.62;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(rr(2.6, 3.4), ch, 7), leaf);
    cone.position.y = h - ch / 2 + 2;
    g.add(cone);
    t.canopy.push({ c: new THREE.Vector3(x, h - ch * 0.75 + 2, z), r: 2.6, sy: 1 });
    t.canopy.push({ c: new THREE.Vector3(x, h - ch * 0.4 + 2, z), r: 1.9, sy: 1 });
    branch(rr(5, 9), rr(3, 4));
  } else {
    // 호수 섬의 작은 나무 — 낮은 가지에 앉아 쉬기 좋아요
    const h = rr(6, 8), r = rr(0.45, 0.6);
    trunk(r * 0.7, r, h);
    ball(h + 1.6, rr(2.6, 3.2), 0.8);
    branch(rr(2.8, 3.6), rr(2.4, 3));
    branch(rr(4.4, 5.2), rr(2.2, 2.8));
  }
  trees.push(t);
}

{
  const placed = [];
  let tries = 0;
  while (placed.length < 32 && tries < 4000) {
    tries++;
    const a = rand() * Math.PI * 2, d = rr(LAKE_R + 5, WORLD_R + 14);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x - START.x, z - START.z) < 11) continue;
    const roll = rand();
    const type = roll < 0.25 ? 'giant' : roll < 0.6 ? 'wide' : 'thin';
    const need = type === 'giant' ? 14 : type === 'wide' ? 13 : 8;
    if (placed.some(p => Math.hypot(p.x - x, p.z - z) < Math.max(need, p.need))) continue;
    placed.push({ x, z, need });
    addTree(type, x, z);
  }

  // 호수 위 작은 섬 세 개 (용이 헤엄치는 길과 물가 사이)
  const islandMat = std(0x2b3a2c);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6, d = (DRAGON_R + LAKE_R) / 2 + 1.5;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const island = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3, 0.5, 9), islandMat);
    island.position.set(x, 0.1, z);
    scene.add(island);
    addTree('island', x, z);
  }
}

// ===================================================================
// 호수의 수호신 용 — 온화하고 따뜻하게
// ===================================================================
const dragon = (() => {
  // 길고 가는 몸이 지렁이처럼 꿈틀꿈틀 — 마디를 촘촘히 겹쳐 하나로 이어 보이게
  const SEG = 34;
  const bodyMat = std(0xc3ece0, { emissive: 0x24463f, roughness: 0.6, flatShading: false });
  const finMat = std(0xffb7c9, { emissive: 0x5a2a36 });
  const goldMat = std(0xffd98a, { emissive: 0x6a4a10 });
  const segs = [];
  for (let i = 0; i < SEG; i++) {
    const k = i / (SEG - 1);
    const r = k < 0.1 ? lerp(0.6, 0.8, k / 0.1) : k > 0.7 ? lerp(0.8, 0.25, (k - 0.7) / 0.3) : 0.8;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), bodyMat);
    m.scale.setScalar(r);
    if (i % 3 === 1 && i < SEG - 4) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 5), finMat);
      fin.position.y = 0.95;
      m.add(fin);
    }
    scene.add(m);
    segs.push({ m, r });
  }

  const head = new THREE.Group();
  head.scale.setScalar(0.62);
  scene.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 12), bodyMat);
  skull.scale.set(1.1, 0.9, 1.2);
  head.add(skull);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), bodyMat);
  snout.scale.set(0.85, 0.6, 1.0);
  snout.position.set(0, -0.35, -1.5);
  head.add(snout);
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.3, 6), goldMat);
    horn.position.set(s * 0.6, 1.2, 0.5);
    horn.rotation.x = 0.5;
    horn.rotation.z = -s * 0.3;
    head.add(horn);
    for (let k = 0; k < 3; k++) {
      const mane = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.8, 5), finMat);
      mane.position.set(s * (0.9 + k * 0.1), 0.6 - k * 0.3, 0.9 + k * 0.25);
      mane.rotation.z = -s * 1.1;
      head.add(mane);
    }
    const blush = glowSprite(0xff9fb8, 0.9, 0.35);
    blush.position.set(s * 0.95, -0.2, -0.8);
    head.add(blush);
  }
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(s * 0.68, 0.42, -1.42);
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfffbf0 }));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshBasicMaterial({ color: 0x2a1d33 }));
    ball.position.set(s * 0.04, 0, -0.17);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    shine.position.set(s * -0.04, 0.11, -0.4);
    eye.add(white, ball, shine);
    head.add(eye);
    eyes.push(eye);
  }
  const warmth = new THREE.PointLight(0xffc890, 1.0, 22);
  warmth.position.set(0, 1.5, -1);
  head.add(warmth);
  const aura = glowSprite(0xffe2b8, 9, 0.12);
  head.add(aura);

  return {
    head, segs, eyes, angle: rand() * 6, squint: 0,
    headPos: new THREE.Vector3(), lastGreet: -99, blinkIn: 2, blink: 0,
  };
})();

function dragonPathPos(theta, out) {
  return out.set(Math.cos(theta) * DRAGON_R, 0, Math.sin(theta) * DRAGON_R);
}

function updateDragon(dt, t) {
  dragon.angle += 0.07 * dt;
  const th = dragon.angle;
  const hp = dragonPathPos(th, dragon.headPos);
  hp.y = 1.9 + Math.sin(t * 0.6) * 0.4;
  dragon.head.position.copy(hp);
  const ahead = dragonPathPos(th + 0.06, new THREE.Vector3());
  ahead.y = hp.y - 0.4;
  dragon.head.lookAt(ahead);
  dragon.head.rotateY(Math.PI); // 머리 모델은 -z를 바라봄

  // 위아래로 물결치고, 옆으로도 꿈틀거려요
  dragon.segs.forEach((s, i) => {
    const a = th - (i + 1) * 0.042;
    const r = DRAGON_R + Math.sin(t * 1.3 - i * 0.32) * 0.9 * Math.min(1, i / 6);
    const bodyY = 0.2 + Math.sin(t * 1.7 - i * 0.42) * 0.85;
    s.m.position.set(Math.cos(a) * r, i < 4 ? lerp(hp.y - 0.5, bodyY, (i + 1) / 5) : bodyY, Math.sin(a) * r);
  });

  // 눈 깜박임 (몇 초마다 한 번), 요정이 다가오면 눈을 가늘게 뜨고 반겨요
  dragon.blinkIn -= dt;
  if (dragon.blinkIn <= 0) { dragon.blink = 0.22; dragon.blinkIn = rr(2, 4.5); }
  dragon.blink = Math.max(0, dragon.blink - dt);
  const blinkScale = dragon.blink > 0 ? 0.08 : 1;
  const near = state === 'play' && player.pos.distanceTo(hp) < 14;
  dragon.squint = lerp(dragon.squint, near ? 1 : 0, damp(4, dt));
  for (const e of dragon.eyes) e.scale.y = Math.min(blinkScale, lerp(1, 0.25, dragon.squint));
  if (near && t - dragon.lastGreet > 25) {
    dragon.lastGreet = t;
    say('용이 눈을 가늘게 뜨고 반겨요 ☺', 3, true);
  }
}

// ===================================================================
// 숲의 친구들 — 사슴, 토끼, 새
// ===================================================================
const animals = [];

function randomGroundSpot() {
  const a = rand() * Math.PI * 2, d = rr(LAKE_R + 5, WORLD_R - 4);
  return new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
}

function makeDeer() {
  const g = new THREE.Group();
  const fur = std(0x7a5a40), light = std(0xb89a78), antler = std(0xd8c7a0);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 1.6), fur);
  body.position.y = 1.3;
  g.add(body);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.85, 0.3), fur);
  neck.position.set(0, 1.85, -0.72);
  neck.rotation.x = 0.4;
  g.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 2.3, -0.95);
  g.add(head);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.6), light);
  face.position.z = -0.15;
  head.add(face);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.12), fur);
    ear.position.set(s * 0.2, 0.2, 0.05);
    ear.rotation.z = s * 0.6;
    head.add(ear);
    const a1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.7, 4), antler);
    a1.position.set(s * 0.14, 0.45, 0.08);
    a1.rotation.z = -s * 0.35;
    head.add(a1);
    const a2 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.35, 4), antler);
    a2.position.set(s * 0.28, 0.65, -0.05);
    a2.rotation.z = -s * 1.0;
    head.add(a2);
  }
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), std(0xeee6d8));
  tail.position.set(0, 1.5, 0.82);
  g.add(tail);
  const legs = [];
  for (const [lx, lz] of [[-0.24, -0.6], [0.24, -0.6], [-0.24, 0.6], [0.24, 0.6]]) {
    const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 1.0, 5);
    legGeo.translate(0, -0.5, 0);
    const leg = new THREE.Mesh(legGeo, fur);
    leg.position.set(lx, 1.0, lz);
    g.add(leg);
    legs.push(leg);
  }
  g.scale.setScalar(1.25);
  scene.add(g);
  return { kind: 'deer', g, head, legs, speed: 1.3, target: randomGroundSpot(), wait: 0, phase: rand() * 6 };
}

function makeRabbit() {
  const g = new THREE.Group();
  const fur = std(0xcfc6b4);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), fur);
  body.scale.set(1, 0.85, 1.25);
  body.position.y = 0.3;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), fur);
  head.position.set(0, 0.55, -0.3);
  g.add(head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.32, 0.1), fur);
    ear.position.set(s * 0.07, 0.82, -0.27);
    ear.rotation.z = s * 0.15;
    g.add(ear);
  }
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), std(0xffffff));
  tail.position.set(0, 0.35, 0.36);
  g.add(tail);
  scene.add(g);
  return { kind: 'rabbit', g, speed: 2.2, target: randomGroundSpot(), wait: 0, phase: rand() * 6 };
}

function makeBird() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x1a2238, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 5), mat);
  body.rotation.x = -Math.PI / 2;
  g.add(body);
  const wings = [];
  for (const s of [-1, 1]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.2, s * 1.3, 0, 0.15, 0, 0, 0.35]), 3));
    const w = new THREE.Mesh(geo, mat);
    g.add(w);
    wings.push({ w, s });
  }
  scene.add(g);
  return { kind: 'bird', g, wings, R: rr(30, 62), h: rr(22, 34), ang: rand() * 6, w: rr(0.08, 0.16) * (rand() < 0.5 ? -1 : 1), phase: rand() * 6 };
}

for (let i = 0; i < 3; i++) { const a = makeDeer(); a.g.position.copy(randomGroundSpot()); animals.push(a); }
for (let i = 0; i < 6; i++) { const a = makeRabbit(); a.g.position.copy(randomGroundSpot()); animals.push(a); }
for (let i = 0; i < 6; i++) animals.push(makeBird());

function updateAnimals(dt, t) {
  for (const a of animals) {
    if (a.kind === 'bird') {
      a.ang += a.w * dt;
      a.g.position.set(Math.cos(a.ang) * a.R, a.h + Math.sin(t * 0.5 + a.phase) * 2, Math.sin(a.ang) * a.R);
      a.g.rotation.y = -a.ang + (a.w > 0 ? Math.PI : 0);
      const flap = Math.sin(t * 9 + a.phase) * 0.7;
      for (const { w, s } of a.wings) w.rotation.z = s * flap;
      continue;
    }
    const pos = a.g.position;
    let moving = false;
    if (a.wait > 0) {
      a.wait -= dt;
    } else {
      const dx = a.target.x - pos.x, dz = a.target.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) {
        a.wait = rr(2, 6);
        a.target = randomGroundSpot();
      } else {
        moving = true;
        const step = Math.min(d, a.speed * dt);
        pos.x += dx / d * step;
        pos.z += dz / d * step;
        a.g.rotation.y = angleLerp(a.g.rotation.y, Math.atan2(-dx, -dz), damp(3, dt));
      }
    }
    a.phase += dt * (moving ? 1 : 0);
    if (a.kind === 'deer') {
      a.legs.forEach((leg, i) => { leg.rotation.x = moving ? Math.sin(a.phase * 6 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.45 : 0; });
      a.head.rotation.x = lerp(a.head.rotation.x, moving ? 0 : 0.9, damp(2, dt)); // 쉴 때는 풀을 뜯어요
    } else {
      pos.y = moving ? Math.abs(Math.sin(a.phase * 9)) * 0.3 : 0;
    }
  }
}

// ===================================================================
// 요정 (작은 창에서 보이는 3인칭 모습, 레이어 1)
// ===================================================================
const fairy = (() => {
  const g = new THREE.Group();
  const skin = std(0xffd6b5, { emissive: 0x553322, emissiveIntensity: 0.6, flatShading: false });
  const dressM = std(0x6fd38a, { emissive: 0x1d5a2c });
  const hairM = std(0xffe08a, { emissive: 0x6a4a10, flatShading: false });
  const dress = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 8), dressM);
  dress.position.y = 0.05;
  g.add(dress);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), skin);
  head.position.y = 0.48;
  g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 12), hairM);
  hair.scale.set(1, 0.75, 1.05);
  hair.position.set(0, 0.54, 0.03);
  g.add(hair);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), hairM);
  bun.position.set(0, 0.68, 0.08);
  g.add(bun);
  const legs = [];
  for (const s of [-1, 1]) {
    const legGeo = new THREE.CylinderGeometry(0.035, 0.03, 0.42, 6);
    legGeo.translate(0, -0.21, 0);
    const leg = new THREE.Mesh(legGeo, skin);
    leg.position.set(s * 0.08, -0.2, 0);
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), dressM);
    shoe.scale.set(1, 0.7, 1.6);
    shoe.position.set(0, -0.43, -0.04);
    leg.add(shoe);
    g.add(leg);
    legs.push(leg);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.36, 6), skin);
    arm.position.set(s * 0.2, 0.18, 0);
    arm.rotation.z = s * 0.5;
    g.add(arm);
  }
  const wingMat = new THREE.MeshBasicMaterial({
    color: 0xdff6ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const shape = new THREE.Shape();
  shape.absellipse(0.32, 0.12, 0.34, 0.16, 0, Math.PI * 2, false, 0.35);
  const small = new THREE.Shape();
  small.absellipse(0.24, -0.12, 0.24, 0.11, 0, Math.PI * 2, false, -0.4);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.25, 0.12);
    pivot.scale.x = s;
    pivot.add(new THREE.Mesh(new THREE.ShapeGeometry(shape), wingMat));
    pivot.add(new THREE.Mesh(new THREE.ShapeGeometry(small), wingMat));
    g.add(pivot);
    wings.push({ pivot, s });
  }
  const glow = glowSprite(0xfff1b0, 1.6, 0.5);
  glow.position.y = 0.2;
  g.add(glow);
  g.scale.setScalar(2.4);
  setLayer(g, 1);
  scene.add(g);

  // 지나간 자리의 요정 가루
  const dust = [];
  for (let i = 0; i < 40; i++) {
    const s = glowSprite(0xfff3c0, 0.6, 0);
    s.layers.set(1);
    scene.add(s);
    dust.push({ s, life: 0 });
  }
  return { g, wings, legs, dust, dustTimer: 0, dustIndex: 0 };
})();

// ===================================================================
// 1인칭 몸 — 팔, 다리, 날개, 병 (레이어 2, 카메라에 붙음)
// ===================================================================
const rig = new THREE.Group();
camera.add(rig);
const skinR = new THREE.MeshLambertMaterial({ color: 0xffdcc4, emissive: 0xc9907a });
const shoeMat = new THREE.MeshLambertMaterial({ color: 0x6fd47f, emissive: 0x2f8a40 });

function makeHand(side) {
  const arm = new THREE.Group();
  const foreGeo = new THREE.CylinderGeometry(0.032, 0.045, 0.45, 10);
  foreGeo.rotateX(Math.PI / 2);
  foreGeo.translate(0, -0.01, 0.25);
  arm.add(new THREE.Mesh(foreGeo, skinR));
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skinR);
  palm.scale.set(0.055, 0.024, 0.066);
  arm.add(palm);
  for (let i = 0; i < 4; i++) {
    const fg = new THREE.CylinderGeometry(0.0105, 0.012, 0.07, 6);
    fg.rotateX(Math.PI / 2);
    fg.translate(0, 0, -0.035);
    const f = new THREE.Mesh(fg, skinR);
    f.position.set((i - 1.5) * 0.022, 0, -0.055);
    f.rotation.set(-0.2, (i - 1.5) * 0.08, 0);
    arm.add(f);
  }
  const tg = new THREE.CylinderGeometry(0.011, 0.013, 0.055, 6);
  tg.rotateX(Math.PI / 2);
  tg.translate(0, 0, -0.028);
  const thumb = new THREE.Mesh(tg, skinR);
  thumb.position.set(-side * 0.048, -0.004, -0.015);
  thumb.rotation.y = side * 0.7;
  arm.add(thumb);
  const seat = new THREE.Object3D(); // 손등 — 반딧불이가 앉는 자리
  seat.position.set(0, 0.04, -0.005);
  arm.add(seat);
  arm.scale.setScalar(0.72);
  rig.add(arm);
  return { arm, seat, side };
}
const hands = { left: makeHand(-1), right: makeHand(1) };

function makeLeg(side) {
  const leg = new THREE.Group();
  const shinGeo = new THREE.CylinderGeometry(0.036, 0.03, 0.36, 8);
  shinGeo.translate(0, -0.18, 0);
  leg.add(new THREE.Mesh(shinGeo, skinR));
  const shoeGeo = new THREE.ConeGeometry(0.045, 0.17, 10);
  shoeGeo.rotateX(-Math.PI / 2);
  const shoe = new THREE.Mesh(shoeGeo, shoeMat);
  shoe.position.set(0, -0.37, -0.05);
  shoe.rotation.x = 0.35;
  leg.add(shoe);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff4e0 }));
  pom.position.set(0, -0.34, -0.14);
  leg.add(pom);
  leg.userData.side = side;
  leg.scale.setScalar(0.5);
  rig.add(leg);
  return leg;
}
const legs = [makeLeg(-1), makeLeg(1)];

// 앉아서 다듬는 내 날개
const myWing = (() => {
  const shape = new THREE.Shape();
  shape.absellipse(0.16, 0.06, 0.17, 0.08, 0, Math.PI * 2, false, 0.35);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({
    color: 0xeaf8ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  m.position.set(0.36, -0.06, -0.5);
  m.scale.setScalar(0.55);
  m.rotation.set(0.2, -1.0, 0.35);
  rig.add(m);
  return m;
})();

// 투명한 병
const jar = (() => {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.07, 0.17, 20, 1, true),
    new THREE.MeshLambertMaterial({ color: 0xe4f2ff, emissive: 0x6d8aa8, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false })
  );
  g.add(glass);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), glass.material);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = -0.085;
  g.add(bottom);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.074, 0.007, 6, 20), new THREE.MeshBasicMaterial({ color: 0xeaf4ff }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.085;
  g.add(rim);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.066, 0.03, 14), std(0xb98a5a, { emissive: 0x2a1a0a }));
  g.add(lid);
  const inside = [];
  for (let i = 0; i < GOAL; i++) {
    const s = glowSprite(0xe9ff8a, 0.05, 0);
    s.position.set(rr(-0.035, 0.035), rr(-0.05, 0.04), rr(-0.035, 0.035));
    g.add(s);
    inside.push(s);
  }
  const shine = glowSprite(0xe9ff8a, 0.22, 0);
  g.add(shine);
  rig.add(g);
  return { g, lid, inside, shine };
})();
const JAR_HIDDEN = new THREE.Vector3(0, -0.72, -0.62);
const JAR_SHOWN = new THREE.Vector3(0, -0.27, -0.6);
const LID_OPEN = new THREE.Vector3(0.13, 0.05, 0);
const LID_CLOSED = new THREE.Vector3(0, 0.1, 0);
jar.g.position.copy(JAR_HIDDEN);
jar.lid.position.copy(LID_CLOSED);

setLayer(rig, 2);

// 손 자세: [위치], [회전]
const POSES = {
  idle: s => [[s * 0.33, -0.47, -0.6], [0.45, 0, s * 0.35]],
  raised: s => [[s * 0.22, -0.19, -0.6], [-0.05, 0, s * 0.12]],
  cup: s => [[s * 0.065, -0.17, -0.52], [0.25, 0, -s * 1.25]],
  overJar: s => [[s * 0.085, -0.12, -0.58], [0.55, 0, -s * 0.9]],
  groom: () => [[0.3, -0.1, -0.44], [0.3, 0.5, -0.8]],
};
function poseHand(h, name, k) {
  const [p, r] = POSES[name](h.side);
  h.arm.position.x = lerp(h.arm.position.x, p[0], k);
  h.arm.position.y = lerp(h.arm.position.y, p[1], k);
  h.arm.position.z = lerp(h.arm.position.z, p[2], k);
  h.arm.rotation.x = lerp(h.arm.rotation.x, r[0], k);
  h.arm.rotation.y = lerp(h.arm.rotation.y, r[1], k);
  h.arm.rotation.z = lerp(h.arm.rotation.z, r[2], k);
}
for (const h of Object.values(hands)) poseHand(h, 'idle', 1);

// ===================================================================
// 반딧불이
// ===================================================================
const fireflies = [];
const clusterCenters = [];
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2 + rr(0.2, 1.2), d = rr(16, 62);
  clusterCenters.push(new THREE.Vector3(Math.cos(a) * d, rr(3, 8), Math.sin(a) * d));
}

function randomAir() {
  const a = rand() * Math.PI * 2, d = rr(8, 66);
  return new THREE.Vector3(Math.cos(a) * d, rr(2.5, 10), Math.sin(a) * d);
}

function makeFirefly(kind, extra) {
  const glow = glowSprite(0xd6ff6a, 1.1, 1);
  const core = glowSprite(0xffffd0, 0.25, 1);
  scene.add(glow, core);
  const f = Object.assign({
    kind, glow, core, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    state: 'free', timer: 0, calm: 0,
    p1: rand() * 6, p2: rand() * 6, p3: rand() * 6, blink: rr(1.4, 2.6),
    wob: rr(1.2, 2.6), offset: new THREE.Vector3(),
  }, extra);
  fireflies.push(f);
  return f;
}

for (let i = 0; i < 12; i++) {
  const a = rand() * Math.PI * 2;
  makeFirefly('dragon', { offset: new THREE.Vector3(Math.cos(a) * rr(3, 7), rr(0.5, 5), Math.sin(a) * rr(3, 7)) });
}
clusterCenters.forEach(c => {
  for (let i = 0; i < 5; i++) {
    makeFirefly('cluster', { center: c, offset: new THREE.Vector3(rr(-2.5, 2.5), rr(-1.2, 1.2), rr(-2.5, 2.5)) });
  }
});
for (let i = 0; i < 8; i++) makeFirefly('solo', { home: randomAir(), goal: randomAir() });

function fireflyHome(f, t, out) {
  if (f.kind === 'dragon') {
    const ang = t * 0.3 + f.p1;
    const ox = f.offset.x * Math.cos(ang) - f.offset.z * Math.sin(ang);
    const oz = f.offset.x * Math.sin(ang) + f.offset.z * Math.cos(ang);
    out.set(dragon.headPos.x + ox, dragon.headPos.y + f.offset.y, dragon.headPos.z + oz);
  } else if (f.kind === 'cluster') {
    out.copy(f.center).add(f.offset);
  } else {
    out.copy(f.home);
  }
  out.x += Math.sin(t * 0.7 * f.wob + f.p1) * 1.2;
  out.y += Math.sin(t * 0.9 * f.wob + f.p2) * 0.5;
  out.z += Math.cos(t * 0.6 * f.wob + f.p3) * 1.2;
  out.y = Math.max(out.y, 1.2);
  return out;
}

function resetFireflies() {
  const tmp = new THREE.Vector3();
  for (const f of fireflies) {
    f.state = 'free';
    f.timer = 0;
    f.calm = 0;
    if (f.kind === 'solo') { f.home = randomAir(); f.goal = randomAir(); }
    f.pos.copy(fireflyHome(f, 0, tmp));
    f.glow.visible = f.core.visible = true;
    f.glow.layers.set(0);
    f.core.layers.set(0);
  }
}

// ===================================================================
// 게임 상태
// ===================================================================
let state = 'start';            // start | play | pause | success
let pauseReason = 'user';
const player = {
  pos: START.clone(), yaw: 0, pitch: 0, roll: 0,
  step: 0, speed: 0, knock: new THREE.Vector3(),
  stun: 0, bonkCool: 0, sitting: null, groomT: 0, sitCool: 0,
};
let caught = 0, timeLeft = TIME_LIMIT, playTime = 0;
let activeHand = null;          // 'left' | 'right' | null — 먼저 올린 손만 인정
let handFly = null;             // 다가오거나 손등에 앉은 반딧불이
let capture = null;             // 병에 담는 동작
let scatterMsgCool = 0;
let nearbyFree = false;     // 손을 내밀면 다가올 반딧불이가 근처에 있는지 (안내 문구용)
let t = 0, last = performance.now();

const down = new Set();
const GAME_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'BracketLeft', 'BracketRight', 'Backslash']);
const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ArrowUp']);

// ===================================================================
// 화면 요소
// ===================================================================
const $ = id => document.getElementById(id);
const ui = {
  hud: $('hud'), time: $('time'), jarDots: [...$('jarDots').children], jarCount: $('jarCount'),
  speed: $('speed'), steps: [...document.querySelectorAll('#speed .steps i')],
  mini: $('miniFrame'), message: $('message'), bonk: $('bonk'), keys: $('keys'),
  start: $('startScreen'), pause: $('pauseScreen'), pauseTitle: $('pauseTitle'), pauseText: $('pauseText'),
  success: $('successScreen'), result: $('resultText'), sound: $('sound'),
};

let msgText = '', msgTimer = 0, msgWarm = false;
function say(text, seconds, warm) {
  msgText = text; msgTimer = seconds || 2.5; msgWarm = !!warm;
}
let shownMsg = null;
function updateMessage(dt) {
  msgTimer -= dt;
  let text = '', warm = false;
  if (msgTimer > 0) { text = msgText; warm = msgWarm; }
  else if (handFly && handFly.state === 'hand' && !capture) { text = '\\ 키로 살포시 담아요 ✨'; warm = true; }
  else if (handFly && handFly.state === 'approach') { text = '반딧불이가 천천히 다가와요…'; warm = true; }
  else if (nearbyFree && !activeHand && !capture) {
    text = player.speed > FAST ? '천천히… 빠르면 반딧불이가 놀라요' : '손을 올려보세요  [ 왼손 / ] 오른손 ✋';
    warm = player.speed <= FAST;
  }
  else if (player.sitting) { text = '나뭇가지에서 쉬는 중 🌿'; }
  if (state !== 'play') text = '';
  const key = text + warm;
  if (key === shownMsg) return;
  shownMsg = key;
  if (text) ui.message.textContent = text;
  ui.message.classList.toggle('show', !!text);
  ui.message.classList.toggle('warm', warm);
}

function showBonk() {
  let html = '<span class="word">따콩!</span>';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    html += `<span class="star" style="--dx:${Math.cos(a) * 140}px;--dy:${Math.sin(a) * 100}px">⭐</span>`;
  }
  ui.bonk.innerHTML = html;
  clearTimeout(showBonk.timer);
  showBonk.timer = setTimeout(() => { ui.bonk.innerHTML = ''; }, 1000);
}

let shownSecond = -1;
function updateHud() {
  const sec = Math.max(0, Math.ceil(timeLeft));
  if (sec !== shownSecond) {
    shownSecond = sec;
    ui.time.textContent = `⏱ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    ui.time.classList.toggle('low', sec <= 20);
  }
  ui.jarDots.forEach((d, i) => d.classList.toggle('on', i < caught));
  ui.jarCount.textContent = `${caught} / ${GOAL}`;
  const s = player.step;
  if (ui.speed.dataset.step !== String(s)) {
    ui.speed.dataset.step = String(s);
    ui.speed.className = `pill speed s${s}`;
    ui.speed.firstChild.textContent = `${SPEED_NAMES[s]} `;
    ui.steps.forEach((el, i) => el.classList.toggle('on', i < s));
  }
}

// ===================================================================
// 소리 (파일 없이 브라우저에서 만든 소리)
// ===================================================================
let audio = null, muted = false;
function ensureAudio() {
  if (!audio) {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
  }
  if (audio && audio.state === 'suspended') audio.resume();
}
function tone(freq, start, dur, type, vol, slideTo) {
  if (!audio || muted) return;
  const t0 = audio.currentTime + start;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(audio.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}
const sfx = {
  bonk() { tone(988, 0, 0.07, 'square', 0.12, 740); tone(523, 0.09, 0.22, 'triangle', 0.22, 330); },
  ding() { tone(1568, 0, 0.7, 'sine', 0.18); tone(2349, 0.04, 0.5, 'sine', 0.06); },
  success() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.13, 0.6, 'triangle', 0.14)); },
};

// ===================================================================
// 입력
// ===================================================================
const keyButtons = {};
document.querySelectorAll('#keys .key').forEach(b => { keyButtons[b.dataset.code] = b; });
const KEY_LIGHT = { ArrowLeft: 'KeyA', ArrowRight: 'KeyD' };
function light(code, on) {
  const b = keyButtons[code] || keyButtons[KEY_LIGHT[code]];
  if (b) b.classList.toggle('on', on);
}

function press(code) {
  if (down.has(code)) return;
  down.add(code);
  light(code, true);
  if (state !== 'play') return;

  if (player.sitting && MOVE_CODES.has(code)) {
    player.sitting = null;
    player.sitCool = 1;
    say('다시 날아올라요!', 1.5);
  }
  if (capture) return;

  if (code === 'BracketLeft' && !activeHand) activeHand = 'left';
  if (code === 'BracketRight' && !activeHand) activeHand = 'right';
  if (code === 'Backslash') {
    if (handFly && handFly.state === 'hand') startCapture();
    else if (!activeHand) say('손을 먼저 내밀어요 ( [ 또는 ] )', 2);
    else say('반딧불이가 손등에 앉을 때까지 기다려요', 2);
  }
}

function release(code) {
  if (!down.has(code)) return;
  down.delete(code);
  light(code, false);
  if ((code === 'BracketLeft' && activeHand === 'left') || (code === 'BracketRight' && activeHand === 'right')) {
    activeHand = null;
    if (handFly && !capture) letGo(handFly, 2);
  }
}

function releaseAll() { [...down].forEach(release); }

addEventListener('keydown', e => {
  if (state === 'play' && (e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
    e.preventDefault();
    openPause('user');
    return;
  }
  if (e.code === 'Escape' && state === 'play') { openPause('user'); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (GAME_CODES.has(e.code)) {
    e.preventDefault();
    if (!e.repeat) press(e.code);
  } else if ((e.code === 'Enter' || e.code === 'Space') && state === 'start') {
    e.preventDefault();
    startGame();
  }
});
addEventListener('keyup', e => release(e.code));
addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') openPause('user'); });

// 휴대폰: 화면의 키 버튼을 손가락으로
for (const [code, b] of Object.entries(keyButtons)) {
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); ensureAudio(); press(code); });
  const up = () => release(code);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
}

// ===================================================================
// 반딧불이: 흩어짐, 다가옴, 손등, 병
// ===================================================================
function letGo(f, push) {
  f.state = 'scatter';
  f.timer = 1.2;
  f.vel.set(rr(-1, 1), rr(0.3, 1), rr(-1, 1)).normalize().multiplyScalar(push || 3);
  f.glow.layers.set(0);
  f.core.layers.set(0);
  if (handFly === f) handFly = null;
}

function scatter(f) {
  f.state = 'scatter';
  f.glow.layers.set(0);
  f.core.layers.set(0);
  f.timer = rr(1.8, 2.6);
  f.vel.copy(f.pos).sub(player.pos).setY(rr(0, 2)).normalize().multiplyScalar(rr(5, 8));
}

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const seatWorld = new THREE.Vector3();

function updateFireflies(dt) {
  const playing = state === 'play';
  const fast = playing && player.speed > FAST;
  const handObj = activeHand ? hands[activeHand] : null;
  if (handObj) handObj.seat.getWorldPosition(seatWorld);

  // 손을 올리고 천천히 있으면 가까운 반딧불이가 다가와요
  if (playing && handObj && !handFly && !capture && player.speed <= FAST) {
    let best = null, bestScore = Infinity;
    const inv = camera.matrixWorldInverse;
    for (const f of fireflies) {
      if (f.state !== 'free') continue;
      const d = f.pos.distanceTo(player.pos);
      if (d > CALL_RANGE) continue;
      const lx = tmpV.copy(f.pos).applyMatrix4(inv).x;
      const sideBonus = (activeHand === 'left' ? lx > 0.5 : lx < -0.5) ? 4 : 0; // 그 손 쪽 반딧불이 먼저
      if (d + sideBonus < bestScore) { bestScore = d + sideBonus; best = f; }
    }
    if (best) { best.state = 'approach'; handFly = best; }
  }

  nearbyFree = false;
  for (const f of fireflies) {
    if (f.state === 'jar') continue;
    if (f.state === 'free') {
      fireflyHome(f, t, tmpV);
      f.pos.lerp(tmpV, damp(f.calm > 0 ? 0.35 : 0.9, dt));
      f.calm = Math.max(0, f.calm - dt);
      if (playing && f.pos.distanceTo(player.pos) < CALL_RANGE) nearbyFree = true;
      if (f.kind === 'solo' && f.home.distanceTo(f.goal) < 1) f.goal = randomAir();
      if (f.kind === 'solo') f.home.lerp(f.goal, damp(0.06, dt));
      if (fast && f.pos.distanceTo(player.pos) < 7) {
        scatter(f);
        if (scatterMsgCool <= 0) { say('앗, 너무 빨랐어요. 천천히 다가가요', 2.5); scatterMsgCool = 3; }
      }
    } else if (f.state === 'scatter') {
      f.pos.addScaledVector(f.vel, dt);
      f.vel.multiplyScalar(Math.exp(-dt * 0.9));
      f.timer -= dt;
      if (f.pos.y < 1) f.pos.y = 1;
      if (f.timer <= 0) { f.state = 'free'; f.calm = 4; }
    } else if (f.state === 'approach') {
      if (!handObj || fast) { fast ? scatter(f) : letGo(f, 1); if (handFly === f) handFly = null; continue; }
      const d = f.pos.distanceTo(seatWorld);
      if (d > 12) { letGo(f, 1); continue; }
      const sp = Math.min(d, (0.6 + Math.min(d, 3) * 0.5) * dt);
      f.pos.add(tmpV.copy(seatWorld).sub(f.pos).normalize().multiplyScalar(sp));
      f.pos.y += Math.sin(t * 5 + f.p1) * 0.004;
      if (d < 1.4) { f.glow.layers.set(2); f.core.layers.set(2); }
      if (d < 0.03) f.state = 'hand';
    } else if (f.state === 'hand') {
      if (!handObj) { letGo(f, 1); continue; }
      f.pos.copy(seatWorld);
      f.pos.y += 0.008 + Math.sin(t * 3) * 0.004;
    }
    // capture 상태의 위치는 updateCapture가 정함
  }

  // 반짝임과 크기
  for (const f of fireflies) {
    if (f.state === 'jar') continue;
    const on = Math.pow(Math.max(0, Math.sin(t * f.blink + f.p1)), 2);
    const k = 0.35 + 0.65 * on;
    // 다가오거나 손에 있는 반딧불이는 더 크고 밝게
    const near = f.state === 'approach' || f.state === 'hand' || f.state === 'capture';
    const d = f.pos.distanceTo(camera.position);
    const sc = near ? clamp(d * 0.32, 0.17, 0.75) : clamp(d * 0.11, 0.05, 1);
    f.glow.position.copy(f.pos);
    f.core.position.copy(f.pos);
    f.glow.scale.setScalar((near ? 1.6 : 1.1) * sc * (0.8 + 0.4 * k));
    f.core.scale.setScalar((near ? 0.42 : 0.28) * sc);
    f.glow.material.opacity = near ? 0.75 + 0.25 * k : 0.45 + 0.55 * k;
  }
}

function startCapture() {
  capture = { t: 0, f: handFly, from: new THREE.Vector3(), filled: false };
  handFly.state = 'capture';
  capture.from.copy(handFly.pos);
  camera.worldToLocal(capture.from);
  player.speed = 0;
  player.sitting = null;
}

const CUP_CENTER = new THREE.Vector3(0, -0.15, -0.5);
const JAR_INSIDE = new THREE.Vector3(0, -0.27, -0.6);
function updateCapture(dt) {
  const c = capture;
  c.t += dt;
  const T = c.t;
  const local = tmpV2;
  if (T < 0.6) local.copy(c.from).lerp(CUP_CENTER, T / 0.6);
  else if (T < 1.35) local.copy(CUP_CENTER);
  else if (T < 1.7) local.copy(CUP_CENTER).lerp(JAR_INSIDE, (T - 1.35) / 0.35);
  else local.copy(JAR_INSIDE);
  c.f.pos.copy(local).applyMatrix4(camera.matrixWorld);

  if (T >= 1.7 && !c.filled) {
    c.filled = true;
    c.f.state = 'jar';
    c.f.glow.visible = c.f.core.visible = false;
    if (handFly === c.f) handFly = null;
    caught++;
    sfx.ding();
    say(`병에 쏙! ${caught} / ${GOAL}`, 2, true);
  }
  if (T >= 2.4) {
    capture = null;
    activeHand = null;
    releaseHands();
    if (caught >= GOAL) win();
  }
}
// 담고 나면 손을 내려요 (다시 누르면 다시 올라감)
function releaseHands() {
  for (const code of ['BracketLeft', 'BracketRight']) {
    if (down.has(code)) { down.delete(code); light(code, false); }
  }
}

// ===================================================================
// 비행, 부딪힘, 앉기
// ===================================================================
const forward = new THREE.Vector3();
function updatePlayer(dt) {
  const p = player;
  const busy = !!capture;
  const stunned = p.stun > 0;
  const turn = busy || stunned ? 0 : ((down.has('KeyA') || down.has('ArrowLeft')) ? 1 : 0) - ((down.has('KeyD') || down.has('ArrowRight')) ? 1 : 0);
  const lift = busy || stunned || p.sitting ? 0 : (down.has('KeyW') ? 1 : 0) - (down.has('KeyS') ? 1 : 0);

  p.yaw += turn * 1.5 * dt;
  forward.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  // ↑ 누르는 동안 빨라지고, ↓ 누르는 동안 느려지고, 손을 떼면 점점 느려져요
  const up = down.has('ArrowUp'), slow = down.has('ArrowDown');
  if (p.sitting || busy || slow) p.speed = Math.max(0, p.speed - BRAKE * dt);
  else if (up && !stunned) p.speed = Math.min(MAX_SPEED, p.speed + ACCEL * dt);
  else p.speed = Math.max(0, p.speed - COAST * dt);
  p.step = speedStep(p.speed);

  if (!p.sitting) {
    p.pos.addScaledVector(forward, p.speed * dt);
    p.pos.y += lift * 4 * dt;
    p.pos.addScaledVector(p.knock, dt);
  }
  p.knock.multiplyScalar(Math.exp(-dt * 4));
  p.stun = Math.max(0, p.stun - dt);
  p.bonkCool = Math.max(0, p.bonkCool - dt);

  // 높이와 맵 가장자리
  p.pos.y = clamp(p.pos.y, MIN_Y, MAX_Y);
  const r = Math.hypot(p.pos.x, p.pos.z);
  if (r > WORLD_R) {
    p.pos.x *= WORLD_R / r;
    p.pos.z *= WORLD_R / r;
    p.yaw = angleLerp(p.yaw, Math.atan2(p.pos.x, p.pos.z), damp(1.5, dt));
  }

  if (!p.sitting) collide();
  p.sitCool = Math.max(0, p.sitCool - dt);
  if (!p.sitting && p.speed < 0.3 && !busy && p.sitCool <= 0) trySit();

  // 1인칭 카메라: 숨 쉬듯 둥둥, 비틀거림, 기울임
  const breathe = Math.sin(t * Math.PI * 2 / 4);
  // 멈춰 있을수록 더 크게 둥둥
  const still = p.sitting ? 0 : clamp(1 - p.speed / 3, 0, 1);
  p.hover = lerp(p.hover || 0, still, damp(2, dt));
  const hover = p.sitting ? 0 : Math.sin(t * 1.6) * (0.06 + 0.32 * p.hover);
  const sway = p.sitting ? 0 : Math.sin(t * 1.1) * 0.035 * p.hover;
  const dip = busy ? -0.12 : 0;
  camera.position.set(p.pos.x, p.pos.y + hover + breathe * 0.05 + dip, p.pos.z);
  const pitchTarget = busy ? -0.3 : p.sitting ? -0.32 : lift * 0.08 + Math.cos(t * 1.6) * 0.02 * p.hover;
  p.pitch = lerp(p.pitch, pitchTarget, damp(4, dt));
  p.roll = lerp(p.roll, -turn * 0.05, damp(3, dt));
  camera.rotation.set(p.pitch + breathe * 0.006, p.yaw, p.roll + sway + Math.sin(t * 18) * 0.14 * (p.stun / 1));
  camera.updateMatrixWorld();
}

function bonk(normal) {
  const p = player;
  p.pos.addScaledVector(normal, 0.05);
  if (p.bonkCool > 0) return;
  p.bonkCool = 1.2;
  p.stun = 1;
  p.knock.copy(normal).multiplyScalar(5);
  p.speed = Math.min(p.speed, 2);
  sfx.bonk();
  showBonk();
  // 손등에 있던 반딧불이만 놀라 날아가요 (병 속 친구들은 그대로)
  if (handFly) letGo(handFly, 4);
}

const n = new THREE.Vector3();
function collide() {
  const p = player.pos, R = 0.5;
  for (const tr of trees) {
    const dx = p.x - tr.x, dz = p.z - tr.z;
    if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
    const d = Math.hypot(dx, dz);
    if (p.y < tr.trunkH) {
      const tr_r = lerp(tr.trunkR, tr.trunkTop, p.y / tr.trunkH) + R;
      if (d < tr_r) {
        n.set(dx / (d || 1), 0, dz / (d || 1));
        p.x = tr.x + n.x * tr_r;
        p.z = tr.z + n.z * tr_r;
        bonk(n);
      }
    }
    for (const c of tr.canopy) {
      const ex = p.x - c.c.x, ey = (p.y - c.c.y) / c.sy, ez = p.z - c.c.z;
      const e = Math.hypot(ex, ey, ez);
      const lim = c.r + R * 0.6;
      if (e < lim) {
        n.set(ex, ey / c.sy, ez).normalize();
        const k = lim / (e || 1);
        p.x = c.c.x + ex * k;
        p.y = c.c.y + ey * c.sy * k;
        p.z = c.c.z + ez * k;
        bonk(n);
      }
    }
  }
  // 용과 부딪히면 벌칙 없이 부드럽게 밀려나요
  const parts = [{ pos: dragon.headPos, r: 1.2 }].concat(dragon.segs.map(s => ({ pos: s.m.position, r: s.r })));
  for (const part of parts) {
    const d = p.distanceTo(part.pos);
    const lim = part.r + 0.7;
    if (d < lim) {
      n.copy(p).sub(part.pos).normalize();
      p.addScaledVector(n, (lim - d) * 0.5);
      player.knock.addScaledVector(n, 0.5);
    }
  }
}

function trySit() {
  const p = player.pos;
  for (const b of branches) {
    const vx = b.bx - b.ax, vz = b.bz - b.az;
    const len2 = vx * vx + vz * vz;
    const k = clamp(((p.x - b.ax) * vx + (p.z - b.az) * vz) / len2, 0, 1);
    const cx = b.ax + vx * k, cz = b.az + vz * k;
    const h = p.y - b.top;
    if (Math.hypot(p.x - cx, p.z - cz) < 0.9 && h > -0.2 && h < 1.5) {
      player.sitting = b;
      p.set(cx, b.top + 0.7, cz);
      player.groomT = 1.5;
      say('나뭇가지에 살포시 앉았어요 🌿', 2);
      return;
    }
  }
}

// ===================================================================
// 1인칭 몸 움직임
// ===================================================================
function updateRig(dt) {
  const k = damp(9, dt);
  const p = player;
  const sitting = !!p.sitting;
  p.groomT -= dt;
  const grooming = sitting && (p.groomT % 6 + 6) % 6 < 2.2; // 6초마다 2초쯤 날개를 다듬어요

  if (capture) {
    const T = capture.t;
    const pose = T < 1.35 ? 'cup' : T < 1.85 ? 'overJar' : 'idle';
    poseHand(hands.left, pose, k);
    poseHand(hands.right, pose, k);
  } else {
    poseHand(hands.left, activeHand === 'left' ? 'raised' : 'idle', k);
    poseHand(hands.right, activeHand === 'right' ? 'raised' : grooming ? 'groom' : 'idle', k);
    if (grooming && activeHand !== 'right') {
      hands.right.arm.position.y += Math.sin(t * 6) * 0.025;
      hands.right.arm.position.x += Math.sin(t * 3) * 0.02;
    }
  }

  // 병
  const T = capture ? capture.t : -1;
  const jarTarget = capture && T > 0.45 && T < 2.0 ? JAR_SHOWN : JAR_HIDDEN;
  jar.g.position.lerp(jarTarget, damp(7, dt));
  jar.lid.position.lerp(capture && T > 0.45 && T < 1.75 ? LID_OPEN : LID_CLOSED, damp(10, dt));
  jar.inside.forEach((s, i) => {
    s.material.opacity = i < caught ? 0.5 + 0.5 * Math.max(0, Math.sin(t * 2.2 + i * 1.7)) : 0;
  });
  jar.shine.material.opacity = caught / GOAL * 0.6;

  // 다리: 날 때는 발끝이 살짝, 앉으면 가지 위에 걸친 두 다리
  legs.forEach((leg, i) => {
    const s = leg.userData.side;
    const swing = Math.sin(t * 1.6 + i * 1.3);
    if (sitting) {
      leg.position.set(s * 0.075, lerp(leg.position.y, -0.2, k), -0.55);
      leg.rotation.x = lerp(leg.rotation.x, 0.75 + swing * 0.2, k);
    } else {
      leg.position.set(s * 0.08, lerp(leg.position.y, -0.36, k), -0.6);
      leg.rotation.x = lerp(leg.rotation.x, 1.0 + swing * 0.06 + p.speed * 0.012, k);
    }
  });
  myWing.visible = sitting;
  if (sitting) myWing.rotation.z = 0.35 + Math.sin(t * 2) * 0.05 + (grooming ? Math.sin(t * 6) * 0.08 : 0);
}

// ===================================================================
// 작은 창의 요정과 3인칭 카메라
// ===================================================================
const miniRect = { x: 0, y: 0, w: 0, h: 0 };
function updateFairy(dt) {
  const p = player;
  const g = fairy.g;
  g.visible = state !== 'start';
  g.position.set(p.pos.x, p.pos.y + (p.sitting ? -0.2 : -0.4 + Math.sin(t * 1.6) * (0.08 + 0.3 * (p.hover || 0))), p.pos.z);
  g.rotation.set(0, p.yaw, p.roll * 2);
  const flap = p.sitting ? 0.25 + Math.sin(t * 2) * 0.1 : 0.55 + Math.sin(t * (p.speed > 0.3 ? 26 : 16)) * 0.45;
  for (const { pivot, s } of fairy.wings) pivot.rotation.y = s * flap;
  for (const leg of fairy.legs) leg.rotation.x = p.sitting ? -1.3 : 0.25 + Math.sin(t * 2) * 0.1;

  fairy.dustTimer -= dt;
  if (state === 'play' && p.speed > 0.5 && fairy.dustTimer <= 0) {
    fairy.dustTimer = 0.06;
    const d = fairy.dust[fairy.dustIndex++ % fairy.dust.length];
    d.life = 1;
    d.s.position.copy(g.position).addScaledVector(forward, -1.2).add(tmpV.set(rr(-0.4, 0.4), rr(-0.2, 0.8), rr(-0.4, 0.4)));
  }
  for (const d of fairy.dust) {
    d.life = Math.max(0, d.life - dt * 0.9);
    d.s.material.opacity = d.life * 0.8;
    d.s.position.y -= dt * 0.3;
  }

  // 요정의 왼쪽 뒤 위에서 비스듬히 내려다봐요 (요정이 창의 약 1/5)
  const leftX = -Math.cos(p.yaw), leftZ = Math.sin(p.yaw);
  const camPos = tmpV.copy(p.pos).addScaledVector(forward, -7);
  camPos.x += leftX * 9;
  camPos.z += leftZ * 9;
  camPos.y = p.pos.y + 8;
  miniCam.position.lerp(camPos, damp(4, dt));
  miniCam.lookAt(tmpV2.copy(p.pos).addScaledVector(forward, 2).setY(p.pos.y - 0.6));
}

// ===================================================================
// 진행: 시작, 멈춤, 계속, 성공
// ===================================================================
function setPlaying(on) {
  ui.hud.classList.toggle('hidden', !on);
  ui.keys.classList.toggle('hidden', !on);
  ui.mini.classList.toggle('hidden', !on);
  rig.visible = on;
}

function startGame() {
  ensureAudio();
  Object.assign(player, { yaw: 0, pitch: 0, roll: 0, step: 0, speed: 0, stun: 0, bonkCool: 0, sitting: null, groomT: 0, sitCool: 0, hover: 0 });
  player.pos.copy(START);
  player.knock.set(0, 0, 0);
  caught = 0; timeLeft = TIME_LIMIT; playTime = 0;
  activeHand = null; handFly = null; capture = null; msgTimer = 0;
  releaseAll();
  resetFireflies();
  for (const h of Object.values(hands)) poseHand(h, 'idle', 1);
  jar.g.position.copy(JAR_HIDDEN);
  forward.set(0, 0, -1);
  miniCam.position.set(START.x - 9, START.y + 8, START.z + 7);
  shownSecond = -1;
  state = 'play';
  ui.start.classList.add('hidden');
  ui.pause.classList.add('hidden');
  ui.success.classList.add('hidden');
  setPlaying(true);
  updateHud();
  say('천천히 날아서 반딧불이를 찾아봐요 ✨', 3, true);
}

function openPause(reason) {
  if (state !== 'play') return;
  pauseReason = reason;
  state = 'pause';
  releaseAll();
  activeHand = null;
  if (handFly && !capture) letGo(handFly, 1);
  if (reason === 'time') {
    ui.pauseTitle.textContent = '3분이 지났어요';
    ui.pauseText.textContent = `계속하면 시간을 3분 더 드려요. 병 속 반딧불이 ${caught}마리는 그대로예요.`;
  } else {
    ui.pauseTitle.textContent = '잠깐 쉬어 갈까요?';
    ui.pauseText.textContent = `병 속 반딧불이 ${caught}마리는 그대로 있어요.`;
  }
  ui.pause.classList.remove('hidden');
  $('continueBtn').focus();
}

function continueGame() {
  if (state !== 'pause') return;
  if (pauseReason === 'time') timeLeft += TIME_LIMIT;
  state = 'play';
  ui.pause.classList.add('hidden');
  last = performance.now();
}

function quitGame() {
  state = 'start';
  ui.pause.classList.add('hidden');
  ui.success.classList.add('hidden');
  ui.start.classList.remove('hidden');
  setPlaying(false);
  releaseAll();
  updateMessage(0);
}

function win() {
  state = 'success';
  sfx.success();
  const s = Math.round(playTime);
  ui.result.textContent = `걸린 시간 ${Math.floor(s / 60)}분 ${s % 60}초`;
  ui.success.classList.remove('hidden');
  setPlaying(false);
}

$('startBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
$('continueBtn').addEventListener('click', continueGame);
$('quitBtn').addEventListener('click', quitGame);
$('stop').addEventListener('click', () => openPause('user'));
ui.sound.addEventListener('click', () => {
  muted = !muted;
  ui.sound.textContent = muted ? '🔈' : '🔊';
  ui.sound.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
  ensureAudio();
});

// ===================================================================
// 화면 크기와 그리기
// ===================================================================
let W = 1, H = 1;
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  const small = W < 640;
  miniRect.w = Math.round(small ? W * 0.44 : clamp(W * 0.27, 180, 360));
  miniRect.h = Math.round(miniRect.w * 0.66);
  miniRect.x = W - miniRect.w - (small ? 8 : 12);
  miniRect.y = small ? 52 : 58;
  miniCam.aspect = miniRect.w / miniRect.h;
  miniCam.updateProjectionMatrix();
  Object.assign(ui.mini.style, {
    left: miniRect.x + 'px', top: miniRect.y + 'px', width: miniRect.w + 'px', height: miniRect.h + 'px',
  });
}
addEventListener('resize', resize);

function render() {
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
  camera.layers.set(0);
  renderer.render(scene, camera);
  if (rig.visible) {
    // 내 팔·다리·병은 나무에 묻히지 않게 따로 그려요
    renderer.autoClear = false;
    renderer.clearDepth();
    const bg = scene.background;
    scene.background = null; // 배경색으로 덮어쓰지 않게
    camera.layers.set(2);
    renderer.render(scene, camera);
    scene.background = bg;
    renderer.autoClear = true;
    camera.layers.set(0);
  }
  if (state === 'play' || state === 'pause') {
    const yb = H - miniRect.y - miniRect.h;
    renderer.setScissorTest(true);
    renderer.setScissor(miniRect.x, yb, miniRect.w, miniRect.h);
    renderer.setViewport(miniRect.x, yb, miniRect.w, miniRect.h);
    renderer.render(scene, miniCam);
    renderer.setScissorTest(false);
  }
}

function attractCamera() {
  // 시작 화면: 호수 둘레를 천천히 도는 카메라
  const a = t * 0.05;
  camera.position.set(Math.sin(a) * 72, 16, Math.cos(a) * 72);
  camera.rotation.set(-0.12, a, 0);
  camera.updateMatrixWorld();
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  t += dt;

  if (window.moonPath) window.moonPath.userData.tex.offset.y -= dt * 0.03;
  updateDragon(dt, t);
  updateAnimals(dt, t);

  if (state === 'play') {
    playTime += dt;
    if (!capture) {
      timeLeft -= dt;
      if (timeLeft <= 0) { timeLeft = 0; openPause('time'); }
    }
    scatterMsgCool -= dt;
    updatePlayer(dt);
    if (capture) updateCapture(dt);
    updateRig(dt);
    updateFairy(dt);
    updateHud();
  } else if (state === 'start') {
    attractCamera();
    fairy.g.visible = false;
  }
  updateFireflies(state === 'play' ? dt : state === 'start' ? dt : 0);
  updateMessage(dt);
  render();
  requestAnimationFrame(frame);
}

resize();
resetFireflies();
setPlaying(false);
requestAnimationFrame(frame);
