import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

// Original, deliberately compact factory geometry. Each visible shoe represents
// one batch from the simulation; no production state is invented in this view.
const COLORS = {
  floor: 0xe9eef0, dark: 0x28313b, black: 0x17212b, steel: 0x9cabb3,
  white: 0xfafcfc, yellow: 0xf5c441, teal: 0x26a991, coral: 0xeb694b,
  blue: 0x397dcd, muted: 0x71838e, kraft: 0xc39966,
};
const STATES = { running: COLORS.teal, starved: 0x9aa9b3, blocked: COLORS.yellow, stopped: COLORS.coral };
const CELLS = [
  { x: -8.2, z: -3.5, label: '자재 공급', code: '01 / MATERIAL' },
  { x: 0, z: -3.5, label: '갑피 준비', code: '02 / UPPER' },
  { x: 8.2, z: -3.5, label: '성형', code: '03 / LASTING' },
  { x: 8.2, z: 3.5, label: '접착', code: '04 / BONDING' },
  { x: 0, z: 3.5, label: '압착', code: '05 / PRESS' },
  { x: -8.2, z: 3.5, label: '검사 · 포장', code: '06 / PACKING' },
];

export class FactoryScene {
  constructor(container, { onSelect = () => {}, onError = () => {} } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.onError = onError;
    this.materials = new Map();
    this.geometries = new Set();
    this.textures = new Set();
    this.cells = [];
    this.pickMeshes = [];
    this.tokens = [];
    this.frame = null;
    this.disposed = false;
    this.view = 'iso';
    this.snapshot = null;
    this.selectedIndex = 0;
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.floorBounds = new THREE.Box3(new THREE.Vector3(-13.4, 0, -7.9), new THREE.Vector3(13.4, 3.6, 7.9));

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
      this.renderer.setClearColor(COLORS.floor);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.12;
      this.renderer.domElement.setAttribute('aria-label', '신발 제조 공정 3D 모형. 드래그로 회전하고 휠로 확대할 수 있습니다.');
      this.renderer.domElement.style.touchAction = 'none';
      container.appendChild(this.renderer.domElement);
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(COLORS.floor);
      this.scene.fog = new THREE.Fog(COLORS.floor, 62, 110);
      this.camera = new THREE.OrthographicCamera(-20, 20, 10, -10, 0.1, 160);
      this.camera.position.set(14, 23, 35);
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.set(0, 0.8, 0);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.12;
      this.controls.enablePan = true;
      this.controls.screenSpacePanning = true;
      this.controls.minZoom = 0.75;
      this.controls.maxZoom = 3;
      this.controls.minPolarAngle = 0.08;
      this.controls.maxPolarAngle = Math.PI * 0.44;
      this.controls.addEventListener('change', () => this._invalidate());
      this._createGeometry();
      this._lighting();
      this._factory();
      this._bindPicking();
      this._lostContext = (event) => {
        event.preventDefault();
        this._fail('3D 화면 연결이 중단되었습니다. 페이지를 새로고침해 다시 열어 주세요.');
      };
      this.renderer.domElement.addEventListener('webglcontextlost', this._lostContext);
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
      this.resetCamera();
      this.resize();
    } catch (error) {
      this._fail('이 환경에서 3D 화면을 열 수 없습니다. WebGL을 지원하는 브라우저에서 다시 열어 주세요.');
    }
  }

  _fail(message) {
    this.failed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.renderer) this.renderer.domElement.style.display = 'none';
    if (!this.fallback) {
      this.fallback = document.createElement('div');
      this.fallback.className = 'factory-webgl-fallback';
      this.fallback.setAttribute('role', 'status');
      this.fallback.style.cssText = 'position:absolute;inset:0;display:grid;place-content:center;padding:36px;text-align:center;color:#344654;background:#e9eef0;font:500 15px/1.8 system-ui,sans-serif;';
      this.container.appendChild(this.fallback);
    }
    this.fallback.textContent = message;
    this.onError(message);
  }

  _geometry(geometry) { this.geometries.add(geometry); return geometry; }

  _createGeometry() {
    this.geo = {
      box: this._geometry(new THREE.BoxGeometry(1, 1, 1)),
      cylinder: this._geometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 14)),
      sphere: this._geometry(new THREE.SphereGeometry(1, 16, 10)),
      ring: this._geometry(new THREE.TorusGeometry(0.5, 0.07, 6, 20)),
      plane: this._geometry(new THREE.PlaneGeometry(1, 1)),
    };
    const sole = new THREE.Shape();
    sole.moveTo(-0.36, -0.13);
    sole.quadraticCurveTo(-0.49, -0.10, -0.47, 0.03);
    sole.quadraticCurveTo(-0.45, 0.16, -0.27, 0.17);
    sole.lineTo(0.26, 0.18);
    sole.quadraticCurveTo(0.48, 0.15, 0.49, 0.0);
    sole.quadraticCurveTo(0.48, -0.16, 0.26, -0.16);
    sole.closePath();
    this.geo.sole = this._geometry(new THREE.ExtrudeGeometry(sole, { depth: 0.065, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.012, bevelThickness: 0.009, curveSegments: 8 }));
    this.geo.sole.rotateX(-Math.PI / 2);
  }

  _mat(color, options = {}) {
    const key = `${color}:${JSON.stringify(options)}`;
    if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.12, ...options }));
    return this.materials.get(key);
  }

  _mesh(parent, geometry, material, position, scale, cast = true) {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    mesh.castShadow = cast && !material.transparent;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  _box(parent, color, position, scale, options) { return this._mesh(parent, this.geo.box, this._mat(color, options), position, scale); }
  _cyl(parent, color, position, scale, options) { return this._mesh(parent, this.geo.cylinder, this._mat(color, options), position, scale); }
  _sphere(parent, color, position, scale, options) { return this._mesh(parent, this.geo.sphere, this._mat(color, options), position, scale); }

  _lighting() {
    this.scene.add(new THREE.HemisphereLight(0xfafcff, 0xbac6cd, 2.35));
    const sun = new THREE.DirectionalLight(0xfffbef, 3.2);
    sun.position.set(-12, 28, 13);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 23;
    sun.shadow.camera.bottom = -23;
    sun.shadow.normalBias = 0.045;
    sun.shadow.bias = -0.0003;
    sun.shadow.radius = 3;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xd4e7f4, 1.3);
    fill.position.set(16, 12, -16);
    this.scene.add(fill);
  }

  _factory() {
    const factory = this.factory = new THREE.Group();
    this.scene.add(factory);
    const ground = this._box(factory, COLORS.floor, [0, -0.18, 0], [29.2, 0.32, 17.7]);
    ground.castShadow = false;
    // Fine floor seams are modeled as sparse geometry, not a busy neon grid.
    const seamMat = new THREE.LineBasicMaterial({ color: 0xd3dce0, transparent: true, opacity: 0.72 });
    this.materials.set('floor-seams', seamMat);
    const vertices = [];
    for (let x = -14; x <= 14; x += 1) vertices.push(x, 0.004, -8.5, x, 0.004, 8.5);
    for (let z = -8; z <= 8; z += 1) vertices.push(-14.5, 0.004, z, 14.5, 0.004, z);
    const seams = this._geometry(new THREE.BufferGeometry());
    seams.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    factory.add(new THREE.LineSegments(seams, seamMat));
    this._box(factory, 0xd1dce0, [0, -0.015, -8.6], [29, 0.1, 0.12]);
    this._box(factory, 0xd1dce0, [-14.4, -0.015, 0], [0.12, 0.1, 17.2]);
    this._walkway(factory);

    CELLS.forEach((def, index) => this._cell(def, index));
    this._conveyor(factory, [-12.1, 0.77, -3.18], [12.1, 0.77, -3.18]);
    this._conveyor(factory, [12.1, 0.77, -3.18], [12.1, 0.77, 3.82]);
    this._conveyor(factory, [12.1, 0.77, 3.82], [-12.1, 0.77, 3.82]);
    this._conveyor(factory, [-12.1, 0.77, 3.82], [-12.1, 0.77, 5.5]);
    this._periphery(factory);
    for (let i = 0; i < 60; i++) {
      const group = this._shoe(factory);
      group.visible = false;
      this.tokens.push(group);
    }
  }

  _walkway(parent) {
    // A single central personnel aisle leaves the two production rows readable.
    this._box(parent, 0xdce5e7, [0, 0.013, 0], [25.6, 0.025, 1.55]);
    [-0.77, 0.77].forEach(z => {
      this._box(parent, COLORS.yellow, [0, 0.035, z], [25.6, 0.016, 0.045]);
      for (let x = -12; x <= 12; x += 1.4) this._box(parent, 0xfdfefe, [x, 0.04, z * 0.64], [0.43, 0.014, 0.035]);
    });
    for (let i = 0; i < 4; i++) this._box(parent, COLORS.white, [-13.2, 0.04, -0.63 + i * 0.42], [1.3, 0.016, 0.18]);
    this._arrow(parent, -11.2, 0, 1);
    this._arrow(parent, 10.7, 0, -1);
  }

  _arrow(parent, x, z, direction) {
    const arrow = new THREE.Group();
    arrow.position.set(x, 0.045, z);
    arrow.rotation.y = direction < 0 ? Math.PI : 0;
    this._box(arrow, 0x9daeb5, [-0.1, 0, 0], [0.8, 0.015, 0.12]);
    for (const sign of [-1, 1]) {
      const arm = this._box(arrow, 0x9daeb5, [0.36, 0, sign * 0.16], [0.46, 0.015, 0.1]);
      arm.rotation.y = sign * Math.PI / 4;
    }
    parent.add(arrow);
  }

  _cell(def, index) {
    const group = new THREE.Group();
    group.position.set(def.x, 0, def.z);
    this.factory.add(group);
    const pick = this._box(group, 0xe3e9eb, [0, 0.018, 0], [6.6, 0.04, 4.9]);
    pick.userData.stationIndex = index;
    this.pickMeshes.push(pick);
    const heatMat = new THREE.MeshBasicMaterial({ color: COLORS.teal, transparent: true, opacity: 0, depthWrite: false });
    this.materials.set(`heat-${index}`, heatMat);
    const heat = this._mesh(group, this.geo.plane, heatMat, [0, 0.045, 0], [6.55, 4.85, 1], false);
    heat.rotation.x = -Math.PI / 2;
    // Small perimeter corners are more precise than a luminous selection halo.
    const selection = new THREE.Group();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this._box(selection, COLORS.blue, [sx * 3.25, 0.066, sz * 2.39], [0.13, 0.055, 0.58]);
      this._box(selection, COLORS.blue, [sx * 3.02, 0.066, sz * 2.61 - sz * 0.22], [0.58, 0.055, 0.13]);
    }
    group.add(selection);
    const lamp = this._statusLight(group, -2.88, -1.68);
    const cell = { group, heat, selection, lamp, robots: [], index };
    this.cells.push(cell);
    this._label(group, def, index);
    // Equipment is kept behind each belt, exposing active batches from above.
    if (index === 0) this._supply(group, cell);
    if (index === 1) this._upper(group, cell);
    if (index === 2) this._lasting(group, cell);
    if (index === 3) this._bonding(group, cell);
    if (index === 4) this._press(group, cell);
    if (index === 5) this._packing(group, cell);
    // All equipment descendants participate in picking, including robot arms.
    group.traverse(object => {
      if (object.isMesh && object !== heat && object !== pick && !selection.children.includes(object)) {
        object.userData.stationIndex = index;
        this.pickMeshes.push(object);
      }
    });
  }

  _label(parent, def, index) {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 168;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 768, 168);
    ctx.fillStyle = '#526675';
    ctx.font = '600 25px system-ui, "Malgun Gothic", sans-serif';
    ctx.fillText(def.code, 12, 40);
    ctx.fillStyle = '#243847';
    ctx.font = '700 55px system-ui, "Malgun Gothic", sans-serif';
    ctx.fillText(def.label, 10, 112);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.textures.add(texture);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.materials.set(`label-${index}`, material);
    const label = this._mesh(parent, this.geo.plane, material, [-0.25, 0.079, 2.03], [5.6, 1.225, 1], false);
    label.rotation.x = -Math.PI / 2;
  }

  _statusLight(parent, x, z) {
    this._cyl(parent, COLORS.dark, [x, 1.15, z], [0.055, 2.2, 0.055]);
    this._cyl(parent, COLORS.dark, [x, 0.08, z], [0.34, 0.12, 0.34]);
    const lamp = this._cyl(parent, COLORS.teal, [x, 2.35, z], [0.22, 0.3, 0.22], { emissive: COLORS.teal, emissiveIntensity: 0.3 });
    // A unique lamp material can be recolored without changing other stations.
    lamp.material = lamp.material.clone();
    this.materials.set(`lamp-${this.cells.length}`, lamp.material);
    this._cyl(parent, COLORS.dark, [x, 2.54, z], [0.26, 0.08, 0.26]);
    return lamp;
  }

  _conveyor(parent, start, end) {
    const dx = end[0] - start[0], dz = end[2] - start[2];
    const length = Math.hypot(dx, dz);
    const group = new THREE.Group();
    group.position.set((start[0] + end[0]) / 2, start[1], (start[2] + end[2]) / 2);
    group.rotation.y = -Math.atan2(dz, dx);
    parent.add(group);
    this._box(group, COLORS.dark, [0, -0.12, 0], [length + 0.08, 0.22, 0.96]);
    for (let x = -length / 2 + 0.13; x < length / 2; x += 0.32) {
      const roller = this._cyl(group, COLORS.steel, [x, 0.07, 0], [0.13, 0.87, 0.13], { metalness: 0.55, roughness: 0.42 });
      roller.rotation.x = Math.PI / 2;
    }
    [-0.5, 0.5].forEach(z => this._box(group, COLORS.dark, [0, 0.17, z], [length, 0.1, 0.055]));
    for (let x = -length / 2 + 0.55; x < length / 2; x += 2.5) {
      for (const z of [-0.36, 0.36]) {
        this._box(group, COLORS.dark, [x, -0.4, z], [0.095, 0.74, 0.095]);
        this._box(group, COLORS.steel, [x, -0.735, z], [0.25, 0.04, 0.25]);
      }
    }
    const motor = this._cyl(group, COLORS.blue, [length / 2 - 0.45, -0.19, 0.64], [0.3, 0.4, 0.3]);
    motor.rotation.z = Math.PI / 2;
  }

  _frame(parent, x, z, width, height, depth = 1.5) {
    const frame = new THREE.Group();
    frame.position.set(x, 0, z);
    parent.add(frame);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this._box(frame, COLORS.dark, [sx * width / 2, height / 2, sz * depth / 2], [0.13, height, 0.13]);
      this._box(frame, COLORS.steel, [sx * width / 2, 0.05, sz * depth / 2], [0.32, 0.07, 0.32]);
    }
    for (const sz of [-1, 1]) this._box(frame, COLORS.dark, [0, height, sz * depth / 2], [width + 0.13, 0.13, 0.13]);
    for (const sx of [-1, 1]) this._box(frame, COLORS.dark, [sx * width / 2, height, 0], [0.13, 0.13, depth]);
    return frame;
  }

  _table(parent, x, z, width = 2.4, depth = 1.1) {
    this._box(parent, COLORS.steel, [x, 0.83, z], [width, 0.12, depth], { metalness: 0.35 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this._box(parent, COLORS.dark, [x + sx * (width / 2 - 0.12), 0.43, z + sz * (depth / 2 - 0.12)], [0.09, 0.8, 0.09]);
  }

  _robot(parent, x, z, rotation = 0) {
    const robot = new THREE.Group();
    robot.position.set(x, 0, z);
    robot.rotation.y = rotation;
    parent.add(robot);
    this._box(robot, COLORS.dark, [0, 0.1, 0], [0.92, 0.17, 0.92]);
    this._cyl(robot, COLORS.yellow, [0, 0.38, 0], [0.62, 0.48, 0.62]);
    this._cyl(robot, COLORS.dark, [0, 0.65, 0], [0.45, 0.12, 0.45]);
    const swivel = new THREE.Group();
    swivel.position.y = 0.65;
    robot.add(swivel);
    const shoulder = new THREE.Group();
    shoulder.position.y = 0.13;
    swivel.add(shoulder);
    const jointA = this._cyl(shoulder, COLORS.dark, [0, 0, 0], [0.48, 0.54, 0.48]);
    jointA.rotation.x = Math.PI / 2;
    this._box(shoulder, COLORS.yellow, [0, 0.66, 0], [0.3, 1.32, 0.36]);
    this._box(shoulder, 0xffda6a, [0.165, 0.66, 0], [0.045, 1.03, 0.25]);
    const elbow = new THREE.Group();
    elbow.position.y = 1.32;
    shoulder.add(elbow);
    const jointB = this._cyl(elbow, COLORS.dark, [0, 0, 0], [0.39, 0.45, 0.39]);
    jointB.rotation.x = Math.PI / 2;
    this._box(elbow, COLORS.yellow, [0, 0.54, 0], [0.24, 1.08, 0.28]);
    this._box(elbow, COLORS.black, [-0.135, 0.54, 0], [0.055, 0.75, 0.2]);
    const wrist = new THREE.Group();
    wrist.position.y = 1.12;
    elbow.add(wrist);
    this._cyl(wrist, COLORS.dark, [0, 0.04, 0], [0.3, 0.25, 0.3]);
    this._box(wrist, COLORS.steel, [0, 0.23, 0], [0.24, 0.18, 0.22]);
    for (const sign of [-1, 1]) this._box(wrist, COLORS.dark, [sign * 0.14, 0.41, 0], [0.07, 0.25, 0.17]);
    shoulder.rotation.z = -0.42;
    elbow.rotation.z = -1.55;
    wrist.rotation.z = -0.55;
    return { swivel, shoulder, elbow, wrist, rotation };
  }

  _caution(parent, x, z, width = 2.8, depth = 1.1) {
    this._box(parent, COLORS.yellow, [x, 0.04, z], [width, 0.02, depth]);
    const stripes = Math.ceil(width / 0.38);
    for (let i = 0; i < stripes; i++) {
      const stripe = this._box(parent, COLORS.dark, [x - width / 2 + 0.15 + i * 0.38, 0.056, z], [0.13, 0.014, depth * 0.84]);
      stripe.rotation.y = -0.32;
    }
  }

  _supply(parent, cell) {
    this._rack(parent, -1.35, -1.08, 2.5, 2.5, 1);
    for (let level = 0; level < 2; level++) for (let x = 0; x < 3; x++) this._carton(parent, -2.15 + x * 0.78, 0.5 + level * 0.94, -1.12, 0.62, 0.58, 0.68);
    this._pallet(parent, 1.65, -1.15);
    this._carton(parent, 1.65, 0.58, -1.15, 1.35, 0.64, 1.05);
    this._carton(parent, 1.58, 1.14, -1.15, 1.1, 0.44, 0.87);
    cell.robots.push(this._robot(parent, 2.5, -0.4, -0.4));
    this._caution(parent, 2.4, -0.4, 1.3, 1.3);
  }

  _upper(parent, cell) {
    const frame = this._frame(parent, -0.95, -1.05, 2.9, 2.5, 1.2);
    this._table(frame, 0, 0, 2.8, 1.1);
    this._box(frame, COLORS.white, [0, 2.2, 0], [2.3, 0.27, 0.83]);
    this._box(frame, COLORS.dark, [0.82, 1.63, 0], [0.35, 0.87, 0.37]);
    this._cyl(frame, COLORS.yellow, [0.82, 1.14, 0], [0.21, 0.3, 0.21]);
    this._box(frame, COLORS.teal, [-0.45, 0.92, 0], [1.06, 0.05, 0.62]);
    for (let i = 0; i < 3; i++) {
      const roll = this._cyl(parent, [0xc4d0d7, 0x6e8492, 0xd5ab7e][i], [1.85, 0.84 + i * 0.31, -1.35], [0.34, 1.2, 0.34]);
      roll.rotation.x = Math.PI / 2;
    }
    this._box(parent, COLORS.dark, [1.85, 0.4, -1.38], [1.05, 0.68, 1.4]);
    cell.robots.push(this._robot(parent, 2.15, -0.12, -0.7));
  }

  _lasting(parent, cell) {
    const frame = this._frame(parent, 0.3, -0.85, 4.15, 3.05, 1.9);
    this._box(frame, COLORS.dark, [0, 2.89, 0], [3.85, 0.27, 0.54]);
    this._box(frame, COLORS.yellow, [0.7, 2.64, 0], [0.73, 0.36, 0.85]);
    this._cyl(frame, COLORS.steel, [0.7, 2.05, 0], [0.15, 1, 0.15]);
    this._box(frame, COLORS.yellow, [0.7, 1.52, 0], [0.85, 0.18, 0.8]);
    this._box(frame, COLORS.dark, [0.7, 0.69, 0], [1.3, 1.15, 1.2]);
    this._box(frame, COLORS.steel, [0.7, 1.28, 0], [1.46, 0.13, 1.3]);
    this._sphere(frame, 0xe6c99b, [0.7, 1.43, 0], [0.45, 0.15, 0.18]);
    cell.robots.push(this._robot(parent, -1.95, -1.1, 0.1));
    this._caution(parent, 0.6, -0.84, 2.25, 1.6);
    this._controlPanel(parent, 2.25, -0.4);
  }

  _bonding(parent, cell) {
    const frame = this._frame(parent, 0.6, -0.78, 3.7, 2.75, 1.75);
    this._box(frame, COLORS.white, [0, 0.53, 0], [3.4, 1, 1.45]);
    this._box(frame, COLORS.dark, [0, 1.28, 0.5], [3.4, 0.47, 0.18]);
    this._box(frame, COLORS.yellow, [0, 2.55, 0], [3.25, 0.28, 1.3]);
    this._box(frame, 0x98c8d1, [0, 1.98, -0.78], [3.25, 1.04, 0.035], { transparent: true, opacity: 0.34, metalness: 0 });
    for (let i = 0; i < 3; i++) this._cyl(frame, COLORS.steel, [-1 + i, 1.79, 0], [0.07, 0.92, 0.07]);
    this._box(frame, COLORS.teal, [0, 1.25, 0], [2.96, 0.08, 1]);
    const exhaust = this._cyl(parent, COLORS.steel, [1.1, 3.08, -1.2], [0.45, 0.54, 0.45]);
    this._box(parent, COLORS.steel, [1.1, 3.4, -1.2], [0.8, 0.17, 0.66]);
    cell.robots.push(this._robot(parent, -2.35, -0.94, 0.45));
    this._controlPanel(parent, 2.25, 0.33);
  }

  _press(parent, cell) {
    for (const x of [-1.5, 0.65]) {
      const frame = this._frame(parent, x, -0.9, 1.65, 2.75, 1.6);
      this._box(frame, COLORS.dark, [0, 0.59, 0], [1.37, 1.05, 1.3]);
      this._box(frame, COLORS.steel, [0, 1.18, 0], [1.5, 0.13, 1.42]);
      this._box(frame, COLORS.yellow, [0, 2.59, 0], [1.47, 0.3, 1.32]);
      this._cyl(frame, COLORS.steel, [0, 2, 0], [0.22, 0.95, 0.22]);
      const platen = this._box(frame, COLORS.yellow, [0, 1.56, 0], [1.25, 0.18, 1.12]);
      cell.platens = cell.platens || [];
      cell.platens.push(platen);
      this._box(frame, 0xb9d2dc, [0, 1.75, 0.79], [1.45, 1.3, 0.03], { transparent: true, opacity: 0.22, metalness: 0 });
      this._caution(parent, x, -0.9, 1.9, 1.85);
    }
    this._controlPanel(parent, 2.3, -0.95);
    this._cyl(parent, COLORS.blue, [2.38, 0.55, 0.22], [0.57, 1.02, 0.57]);
    this._cyl(parent, COLORS.dark, [2.38, 1.14, 0.22], [0.2, 0.13, 0.2]);
  }

  _packing(parent, cell) {
    const frame = this._frame(parent, 1.1, -0.53, 1.85, 2.72, 1.55);
    this._box(frame, COLORS.white, [0, 2.53, 0], [1.6, 0.32, 1.2]);
    this._box(frame, COLORS.dark, [0, 2.27, 0], [0.45, 0.24, 0.4]);
    const lens = this._cyl(frame, COLORS.teal, [0, 2.09, 0], [0.23, 0.16, 0.23], { emissive: COLORS.teal, emissiveIntensity: 0.3 });
    this._table(parent, -1.35, -0.98, 2.6, 1.45);
    this._carton(parent, -1.95, 1.03, -0.91, 0.91, 0.29, 0.56);
    this._carton(parent, -0.77, 1.07, -1.04, 0.95, 0.4, 0.58);
    this._box(parent, COLORS.blue, [-1.9, 1.28, -1.63], [0.85, 0.65, 0.08]);
    this._box(parent, COLORS.dark, [-1.9, 0.99, -1.63], [0.11, 0.35, 0.13]);
    this._box(parent, 0xb5e5da, [-1.9, 1.28, -1.578], [0.72, 0.5, 0.02]);
    this._worker(parent, -2.15, 0.04, -1.5);
    this._controlPanel(parent, 2.52, -0.75);
  }

  _controlPanel(parent, x, z) {
    const cabinet = this._box(parent, COLORS.white, [x, 0.68, z], [0.65, 1.28, 0.55]);
    this._box(parent, COLORS.dark, [x, 1.07, z + 0.286], [0.47, 0.26, 0.025]);
    this._box(parent, 0x8cbdc7, [x, 1.07, z + 0.307], [0.36, 0.18, 0.018]);
    this._sphere(parent, COLORS.coral, [x + 0.16, 0.73, z + 0.3], [0.065, 0.065, 0.025]);
    this._sphere(parent, COLORS.teal, [x - 0.15, 0.73, z + 0.3], [0.052, 0.052, 0.025]);
    return cabinet;
  }

  _rack(parent, x, z, width, height, depth) {
    const rack = this._frame(parent, x, z, width, height, depth);
    for (const y of [0.25, 1.2, 2.18]) this._box(rack, COLORS.steel, [0, y, 0], [width, 0.085, depth]);
    this._box(rack, COLORS.yellow, [0, height + 0.04, -depth / 2], [width, 0.15, 0.07]);
  }

  _pallet(parent, x, z) {
    for (let i = 0; i < 5; i++) this._box(parent, COLORS.kraft, [x - 0.7 + i * 0.35, 0.16, z], [0.28, 0.13, 1.25]);
    for (const sx of [-1, 0, 1]) this._box(parent, 0xb38757, [x + sx * 0.53, 0.065, z], [0.22, 0.13, 1.21]);
  }

  _carton(parent, x, y, z, width = 0.8, height = 0.55, depth = 0.6) {
    this._box(parent, COLORS.kraft, [x, y, z], [width, height, depth]);
    this._box(parent, 0xe2c79e, [x, y + height / 2 + 0.005, z], [width * 0.12, 0.013, depth]);
    this._box(parent, COLORS.white, [x - width * 0.16, y, z + depth / 2 + 0.006], [width * 0.3, height * 0.32, 0.012]);
    for (let i = 0; i < 4; i++) this._box(parent, COLORS.dark, [x - width * 0.25 + i * width * 0.055, y, z + depth / 2 + 0.014], [width * 0.015, height * 0.19, 0.006]);
  }

  _worker(parent, x, z, rotation = 0) {
    const worker = new THREE.Group();
    worker.position.set(x, 0, z);
    worker.rotation.y = rotation;
    parent.add(worker);
    for (const sign of [-1, 1]) {
      this._cyl(worker, COLORS.dark, [sign * 0.12, 0.4, 0], [0.15, 0.68, 0.15]);
      this._box(worker, COLORS.black, [sign * 0.12, 0.08, 0.055], [0.18, 0.13, 0.3]);
      const arm = this._cyl(worker, COLORS.blue, [sign * 0.27, 1.0, 0.04], [0.14, 0.61, 0.14]);
      arm.rotation.z = sign * 0.16;
    }
    this._box(worker, COLORS.blue, [0, 1.02, 0], [0.43, 0.65, 0.27]);
    this._box(worker, COLORS.yellow, [0, 1.03, 0.146], [0.34, 0.51, 0.025]);
    this._sphere(worker, 0xe4b899, [0, 1.52, 0], [0.2, 0.23, 0.19]);
    this._sphere(worker, COLORS.white, [0, 1.69, 0], [0.23, 0.14, 0.22]);
    this._cyl(worker, COLORS.white, [0, 1.67, 0], [0.52, 0.035, 0.48]);
  }

  _periphery(parent) {
    // Open architectural edges provide scale without concealing the production.
    this._box(parent, 0xdbe4e7, [0, 0.43, -8.1], [28, 0.85, 0.18]);
    for (const x of [-13.5, -6.7, 0, 6.7, 13.5]) {
      this._box(parent, 0xbdcbd1, [x, 1.95, -8.1], [0.22, 3.9, 0.22]);
      this._box(parent, COLORS.dark, [x, 0.34, -8.1], [0.26, 0.66, 0.26]);
    }
    this._box(parent, 0xbccbd2, [0, 3.9, -8.1], [27.2, 0.17, 0.2]);
    this._rack(parent, -11.2, -6.85, 3.6, 2.4, 0.78);
    for (let i = 0; i < 4; i++) this._carton(parent, -12.5 + i * 0.83, 0.65, -6.85, 0.72, 0.6, 0.64);
    for (let i = 0; i < 3; i++) this._carton(parent, -12.16 + i * 0.94, 1.57, -6.85, 0.79, 0.56, 0.66);
    this._box(parent, COLORS.white, [-5.8, 0.71, -6.8], [1.8, 1.4, 0.6]);
    this._box(parent, COLORS.teal, [-5.8, 1.04, -6.485], [1.5, 0.45, 0.026]);
    this._box(parent, COLORS.white, [1, 0.81, -6.82], [3, 0.12, 0.95]);
    for (const x of [-0.3, 2.3]) this._box(parent, COLORS.dark, [x, 0.41, -6.82], [0.08, 0.8, 0.75]);
    this._worker(parent, 0.65, -5.95, Math.PI);
    this._worker(parent, -4.9, 0.1, -Math.PI / 2);
    this._pallet(parent, -12.2, 6.75);
    for (let level = 0; level < 2; level++) for (let i = 0; i < 2; i++) this._carton(parent, -12.65 + i * 0.88, 0.49 + level * 0.55, 6.75, 0.8, 0.52, 0.94);
    this._box(parent, COLORS.yellow, [13.45, 0.31, -0.05], [0.06, 0.59, 5.8]);
    for (const z of [-2.65, 0, 2.65]) this._box(parent, COLORS.yellow, [13.45, 0.64, z], [0.07, 1.23, 0.07]);
    this._box(parent, COLORS.yellow, [13.45, 1.13, 0], [0.07, 0.065, 5.4]);
    // Compressor and utility cabinet behind the process line.
    this._box(parent, COLORS.dark, [9.25, 0.57, -6.75], [2.05, 1.03, 0.88]);
    for (let i = 0; i < 8; i++) this._box(parent, COLORS.muted, [8.55 + i * 0.19, 0.6, -6.3], [0.06, 0.66, 0.03]);
    this._cyl(parent, COLORS.steel, [11.55, 0.72, -6.75], [0.83, 1.35, 0.83]);
    this._cyl(parent, COLORS.dark, [11.55, 1.43, -6.75], [0.36, 0.13, 0.36]);
  }

  _shoe(parent) {
    const shoe = new THREE.Group();
    parent.add(shoe);
    this._mesh(shoe, this.geo.sole, this._mat(COLORS.white), [0, 0, 0]);
    this._sphere(shoe, 0x546b7c, [0.0, 0.15, 0], [0.42, 0.17, 0.145]);
    this._sphere(shoe, 0x788e9b, [0.28, 0.105, 0], [0.205, 0.105, 0.155]);
    this._sphere(shoe, COLORS.dark, [-0.27, 0.235, 0], [0.11, 0.063, 0.105]);
    this._box(shoe, COLORS.teal, [-0.33, 0.175, 0.148], [0.1, 0.13, 0.015]);
    for (let i = 0; i < 3; i++) this._box(shoe, COLORS.white, [-0.08 + i * 0.08, 0.289 - i * 0.018, 0], [0.025, 0.014, 0.21]);
    // A shadow-friendly batch carrier differentiates simulated items from fixtures.
    this._box(shoe, 0x587786, [0, -0.04, 0], [1.13, 0.07, 0.63]);
    return shoe;
  }

  render(snapshot, { selectedIndex = 0, heatmap = false, animate = true } = {}) {
    if (this.disposed || this.failed || !this.scene) return;
    this.snapshot = snapshot;
    this.selectedIndex = Math.max(0, Math.min(5, selectedIndex));
    const stations = snapshot?.stations || [];
    this.cells.forEach((cell, index) => {
      const station = stations[index];
      const status = station?.status || 'starved';
      const color = STATES[status] || COLORS.muted;
      cell.selection.visible = index === this.selectedIndex;
      cell.heat.material.color.setHex(color);
      cell.heat.material.opacity = heatmap ? 0.16 : 0;
      cell.lamp.material.color.setHex(color);
      cell.lamp.material.emissive.setHex(color);
      cell.lamp.material.emissiveIntensity = status === 'running' ? 0.4 : 0.12;
      const active = Boolean(station?.activeBatchId);
      const p = Math.max(0, Math.min(1, Number(station?.progress) || 0));
      const phase = active ? Math.sin(p * Math.PI * 2) : 0;
      cell.robots.forEach((robot, robotIndex) => {
        robot.swivel.rotation.y = -0.2 + phase * 0.28 + robotIndex * 0.18;
        robot.shoulder.rotation.z = -0.44 + phase * 0.16;
        robot.elbow.rotation.z = -1.54 - phase * 0.28;
        robot.wrist.rotation.z = -0.56 + phase * 0.18;
      });
      if (cell.platens) cell.platens.forEach((platen, pressIndex) => {
        platen.position.y = active ? 1.61 - Math.pow(Math.sin((p * Math.PI + pressIndex * 0.22)), 2) * 0.28 : 1.56;
      });
    });
    const tokens = Array.isArray(snapshot?.tokens) ? snapshot.tokens : [];
    this.tokens.forEach((mesh, i) => {
      const token = tokens[i];
      const stationIndex = Math.max(0, Math.min(5, token?.stationIndex ?? 0));
      const cell = CELLS[stationIndex];
      mesh.visible = Boolean(token);
      if (!token) return;
      const forward = stationIndex < 3 ? 1 : -1;
      if (token.kind === 'active') {
        const p = Math.max(0, Math.min(1, Number(token.progress ?? stations[stationIndex]?.progress) || 0));
        mesh.position.set(cell.x + forward * (0.12 + p * 2.1), 0.91, cell.z + 0.32);
      } else {
        const q = Math.max(0, token.queueIndex || 0);
        mesh.position.set(cell.x + forward * (-3.0 + (q % 3) * 0.95), 0.91 + Math.floor(q / 3) * 0.3, cell.z + 0.32);
      }
      mesh.rotation.y = forward > 0 ? 0 : Math.PI;
      mesh.userData.stationIndex = stationIndex;
      mesh.userData.batchId = token.id;
    });
    this._invalidate();
  }

  _bindPicking() {
    const canvas = this.renderer.domElement;
    this._pointerDown = (event) => { this.pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }; };
    this._pointerUp = (event) => {
      if (!this.pointerStart || this.pointerStart.id !== event.pointerId || Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 5) return;
      const rect = canvas.getBoundingClientRect();
      this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects([...this.pickMeshes, ...this.tokens.filter(token => token.visible)], true);
      for (const hit of hits) {
        let item = hit.object;
        while (item && item.userData.stationIndex === undefined) item = item.parent;
        if (item?.userData.stationIndex !== undefined) {
          this.onSelect(item.userData.stationIndex);
          break;
        }
      }
      this.pointerStart = null;
    };
    canvas.addEventListener('pointerdown', this._pointerDown);
    canvas.addEventListener('pointerup', this._pointerUp);
  }

  _invalidate() {
    if (this.disposed || this.failed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.disposed || this.failed) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  _fit() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld();
    const min = this.floorBounds.min, max = this.floorBounds.max;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const point = new THREE.Vector3();
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      point.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
    const halfHeight = Math.max((maxY - minY) / 2, (maxX - minX) / (2 * aspect)) * 1.035;
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  focus(index) {
    if (this.failed || this.disposed) return;
    const def = CELLS[index];
    if (!def) return;
    this.selectedIndex = index;
    this.cells.forEach((cell, cellIndex) => { cell.selection.visible = cellIndex === index; });
    const delta = new THREE.Vector3(def.x, 0.85, def.z).sub(this.controls.target);
    this.camera.position.add(delta);
    this.controls.target.add(delta);
    this.camera.zoom = 1.75;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this._invalidate();
  }

  resetCamera() {
    if (this.failed || this.disposed) return;
    this.view = 'iso';
    this.controls.target.set(0, 0.8, 0);
    this.camera.position.set(14, 23, 35);
    this.camera.zoom = 1;
    this.controls.enableRotate = true;
    this.controls.minPolarAngle = 0.08;
    this.controls.update();
    this._fit();
    this._invalidate();
  }

  setView(view) {
    if (this.failed || this.disposed) return;
    if (view !== 'top') { this.resetCamera(); return; }
    this.view = 'top';
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 45, 0.001);
    this.camera.zoom = 1;
    this.controls.enableRotate = false;
    this.controls.minPolarAngle = 0;
    this.controls.update();
    this._fit();
    this._invalidate();
  }

  resize() {
    if (this.failed || this.disposed || !this.renderer) return;
    this.renderer.setSize(Math.max(1, this.container.clientWidth), Math.max(1, this.container.clientHeight), false);
    this._fit();
    this._invalidate();
  }

  dispose() {
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    if (this.renderer) {
      const canvas = this.renderer.domElement;
      canvas.removeEventListener('pointerdown', this._pointerDown);
      canvas.removeEventListener('pointerup', this._pointerUp);
      canvas.removeEventListener('webglcontextlost', this._lostContext);
      this.renderer.dispose();
      canvas.remove();
    }
    this.fallback?.remove();
    this.geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
    this.textures.forEach(texture => texture.dispose());
  }
}
