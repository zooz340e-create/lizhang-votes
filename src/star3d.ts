// 繁星計畫 landing page — 3D 新政治販賣機（漸進增強層）
//
// 設計原則：
//  - 3D 只是視覺升級：HTML 的投幣按鍵照常運作，WebGL 開不了就自動缺席，版面不變
//  - 首屏不揹三體積：本模組由 star.html 在 idle 時動態載入
//  - 手機效能：無陰影、低面數、pixelRatio 上限 2、分頁不可見時暫停渲染
import * as THREE from 'three';

const INK = 0x1c2437;
const CAMPAIGN = 0xc0392b;
const CAMPAIGN_DARK = 0x9c2b20;
const GOLD = 0xb8912f;
const PAPER = 0xf6f2e9;
const WHITE = 0xfffdf8;

interface Item {
  mesh: THREE.Object3D;
  home: THREE.Vector3;
}

export function initVending3D(container: HTMLElement): { press: (key: string) => void } | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null; // 無 WebGL：安靜退場，2D 版本仍在
  }

  const W = () => container.clientWidth;
  const H = () => container.clientHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W(), H());
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, W() / H(), 0.1, 50);
  camera.position.set(0, 1.1, 7.2);
  camera.lookAt(0, 0.1, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xfff4dd, 1.6);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdde4ff, 0.5);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  const mat = (color: number, opt: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08, ...opt });

  // ── 機台群組 ──
  const machine = new THREE.Group();
  scene.add(machine);

  // 主體（競選紅）＋墨藍外框感
  machine.add(new THREE.Mesh(new THREE.BoxGeometry(3.1, 4.3, 1.6), mat(CAMPAIGN)));
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.28, 4.48, 1.5), mat(INK));
  frame.position.z = -0.06;
  machine.add(frame);

  // 頂部金色招牌條
  const sign = new THREE.Mesh(new THREE.BoxGeometry(3.28, 0.42, 1.52), mat(GOLD, { roughness: 0.35, metalness: 0.35 }));
  sign.position.set(0, 2.05, -0.02);
  machine.add(sign);

  // 展示窗（左側 2/3）：米白底板 + 微透玻璃
  const windowBack = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.5, 0.1), mat(PAPER));
  windowBack.position.set(-0.42, 0.55, 0.78);
  machine.add(windowBack);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 2.5, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xcfe0e8, transparent: true, opacity: 0.22, roughness: 0.1 }),
  );
  glass.position.set(-0.42, 0.55, 0.95);
  machine.add(glass);

  // 層架 × 2
  for (const y of [0.28, -0.38]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.5), mat(INK));
    shelf.position.set(-0.42, y, 0.78);
    machine.add(shelf);
  }

  // ── 展示品（五種金額 → 五個物件，低面數示意）──
  const items = new Map<string, Item>();
  const addItem = (key: string, mesh: THREE.Object3D, x: number, y: number) => {
    mesh.position.set(x, y, 0.82);
    machine.add(mesh);
    items.set(key, { mesh, home: mesh.position.clone() });
  };
  // 100 街區踏查指南（小書：墨藍封面）
  const book = new THREE.Group();
  book.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.09), mat(INK)));
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.06), mat(WHITE));
  pages.position.z = 0.02;
  book.add(pages);
  addItem('100', book, -0.95, 0.55);
  // 300 客廳會茶水（茶杯：米白圓柱）
  const cup = new THREE.Group();
  cup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.3, 20), mat(WHITE)));
  const tea = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 20), mat(0x7a9e5f));
  tea.position.y = 0.15;
  cup.add(tea);
  addItem('300', cup, -0.42, 0.5);
  // 500 問卷（紙疊 + 紅勾示意）
  const sheet = new THREE.Group();
  sheet.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.05), mat(WHITE)));
  for (const y of [0.12, 0, -0.12]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.035, 0.06), mat(CAMPAIGN_DARK));
    line.position.set(0, y, 0.01);
    sheet.add(line);
  }
  addItem('500', sheet, 0.1, 0.55);
  // 1000 攝影機（機身 + 鏡頭）
  const cam = new THREE.Group();
  cam.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.24), mat(INK)));
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 20), mat(GOLD, { metalness: 0.4 }));
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0.08, 0, 0.18);
  cam.add(lens);
  addItem('1000', cam, -0.75, -0.12);
  // 5000 練習生之星（金色八面體）
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), mat(GOLD, { roughness: 0.25, metalness: 0.5 }));
  addItem('5000', star, 0.02, -0.08);

  // ── 右側面板：投幣口 + 按鍵 + 取物口 ──
  const slotPanel = new THREE.Mesh(new THREE.BoxGeometry(0.72, 2.5, 0.08), mat(CAMPAIGN_DARK));
  slotPanel.position.set(1.05, 0.55, 0.81);
  machine.add(slotPanel);
  const coinSlot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.1), mat(INK));
  coinSlot.position.set(1.05, 1.45, 0.84);
  machine.add(coinSlot);
  const keyMeshes = new Map<string, THREE.Mesh>();
  ['100', '300', '500', '1000', '5000'].forEach((k, i) => {
    const key = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.08), mat(PAPER, { roughness: 0.4 }));
    key.position.set(1.05, 0.85 - i * 0.34, 0.84);
    machine.add(key);
    keyMeshes.set(k, key);
  });
  const tray = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.12), mat(INK));
  tray.position.set(-0.42, -1.45, 0.8);
  machine.add(tray);

  // 地台（紙色圓盤）
  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.6, 0.14, 48),
    mat(0xe9e2d2, { roughness: 0.9 }),
  );
  ground.position.y = -2.32;
  machine.add(ground);

  // 硬幣（動畫用，平時隱藏）
  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 0.04, 24),
    mat(GOLD, { roughness: 0.2, metalness: 0.6 }),
  );
  coin.rotation.z = Math.PI / 2;
  coin.visible = false;
  machine.add(coin);

  // ── 互動：拖曳旋轉（限制範圍）＋ 自動微轉 ──
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let targetRotY = -0.32;
  let dragging = false;
  let lastX = 0;
  const onDown = (x: number) => { dragging = true; lastX = x; };
  const onMove = (x: number) => {
    if (!dragging) return;
    targetRotY += (x - lastX) * 0.006;
    targetRotY = Math.max(-0.9, Math.min(0.9, targetRotY));
    lastX = x;
  };
  const el = renderer.domElement;
  el.style.touchAction = 'pan-y';
  el.addEventListener('pointerdown', (e) => onDown(e.clientX));
  window.addEventListener('pointermove', (e) => onMove(e.clientX));
  window.addEventListener('pointerup', () => { dragging = false; });

  // ── 投幣動畫狀態 ──
  let anim: { t: number; item: Item; key: THREE.Mesh } | null = null;
  function press(key: string) {
    const item = items.get(key);
    const keyMesh = keyMeshes.get(key);
    if (!item || !keyMesh) return;
    if (anim) { // 前一個動畫直接歸位
      anim.item.mesh.position.copy(anim.item.home);
      anim.item.mesh.rotation.set(0, 0, 0);
      anim.key.position.z = 0.84;
    }
    anim = { t: 0, item, key: keyMesh };
    coin.visible = true;
  }

  // ── 渲染迴圈 ──
  const clock = new THREE.Clock();
  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
  io.observe(container);
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

  renderer.setAnimationLoop(() => {
    if (!visible) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    if (!reduceMotion && !dragging) targetRotY += Math.sin(t * 0.4) * 0.0004;
    machine.rotation.y += (targetRotY - machine.rotation.y) * 0.08;
    if (!reduceMotion) machine.position.y = Math.sin(t * 1.1) * 0.03;

    if (anim) {
      anim.t += dt;
      const { t: at, item, key } = anim;
      key.position.z = at < 0.25 ? 0.8 : 0.84; // 按鍵按下
      if (at < 0.6) { // 硬幣落入投幣口
        const p = at / 0.6;
        coin.position.set(1.05, 2.1 - p * 0.65, 0.9);
        coin.rotation.x = p * 4;
      } else {
        coin.visible = false;
      }
      if (at >= 0.5 && at < 1.3) { // 商品掉落到取物口
        const p = (at - 0.5) / 0.8;
        const e = 1 - Math.pow(1 - p, 3); // easeOut
        item.mesh.position.y = item.home.y + (-1.32 - item.home.y) * e;
        item.mesh.rotation.z = p * 0.5;
      }
      if (at >= 2.2) { // 歸位
        item.mesh.position.copy(item.home);
        item.mesh.rotation.set(0, 0, 0);
        anim = null;
      }
    }
    renderer.render(scene, camera);
  });

  new ResizeObserver(() => {
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
    renderer.setSize(W(), H());
  }).observe(container);

  return { press };
}
