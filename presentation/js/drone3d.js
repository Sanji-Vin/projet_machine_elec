/* Moteur 3D : taxi-drone VX-8 + ville de nuit (Three.js r149, sans module). */
const V3D = (() => {
  const P = window.SIM.params;
  const R_ARM = P.R_BRAS, NR = P.N_ROT, RPM_H = window.SIM.cles.rpm_stat;
  const ALT_SCALE = 0.5, X_SCALE = 50;          // échelles visuelles de la mission (m réels -> m affichés)
  let renderer, scene, camera, drone, clock, host = null, mode = 'hero';
  const rotors = [], discs = [], glows = [], labels = [];
  const state = { rpm: new Array(NR).fill(RPM_H), load: new Array(NR).fill(0.45), failed: -1, flight: null };
  const orbit = { az: 0.7, el: 0.35, r: 15, drag: false, px: 0, py: 0 };
  const camPos = new THREE.Vector3(30, 40, 30);
  let landingZ = -1000, snap = true;

  // ---------- textures procédurales ----------
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  }
  const skyTex = () => canvasTex(16, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#02050f'); gr.addColorStop(.45, '#0b1640'); gr.addColorStop(.72, '#3b2366');
    gr.addColorStop(.86, '#a0466a'); gr.addColorStop(1, '#ff8a4d');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const windowTex = () => canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#05070d'; g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 8) for (let x = 4; x < w; x += 8) {
      if (Math.random() < .42) { const c = ['#ffd58a', '#9fd8ff', '#ffe9c4', '#7fb6ff'][Math.random() * 4 | 0]; g.fillStyle = c; g.globalAlpha = .5 + Math.random() * .5; g.fillRect(x, y, 4, 5); }
    }
  });
  const padTex = () => canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#10182b'; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill();
    g.strokeStyle = '#3ad6ff'; g.lineWidth = 8; g.beginPath(); g.arc(128, 128, 110, 0, 7); g.stroke();
    g.fillStyle = '#ffd166'; g.font = 'bold 130px Segoe UI'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 128, 136);
  });
  const labelTex = (txt, col) => canvasTex(128, 128, (g) => {
    g.fillStyle = col; g.beginPath(); g.arc(64, 64, 54, 0, 7); g.fill();
    g.fillStyle = '#001018'; g.font = 'bold 72px Segoe UI'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 64, 68);
  });

  // ---------- drone ----------
  function buildDrone() {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f5fa, metalness: .35, roughness: .3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b2333, metalness: .7, roughness: .35 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0b1a2e, metalness: .9, roughness: .08, transparent: true, opacity: .9 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x3ad6ff, emissive: 0x3ad6ff, emissiveIntensity: 1.6 });

    const fus = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), white); fus.scale.set(1.25, 1.05, 1.9); g.add(fus);
    const can = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), glass); can.scale.set(1.12, .82, 1.35); can.position.set(0, .28, -.62); g.add(can);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(1, .035, 8, 80), accent); stripe.rotation.x = Math.PI / 2; stripe.scale.set(1.27, 1.92, 1); stripe.position.y = -.15; g.add(stripe);
    const pyl = new THREE.Mesh(new THREE.CylinderGeometry(.16, .3, 1.0, 16), white); pyl.position.y = 1.35; g.add(pyl);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .2, 24), dark); hub.position.y = 1.85; g.add(hub);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R_ARM, .075, 12, 120), white); ring.rotation.x = Math.PI / 2; ring.position.y = 1.85; g.add(ring);

    for (let i = 0; i < NR; i++) {
      const a = (i * 45 + 22.5) * Math.PI / 180;
      const x = R_ARM * Math.cos(a), z = -R_ARM * Math.sin(a);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(R_ARM, .07, .13), white);
      arm.position.set(x / 2, 1.85, z / 2); arm.rotation.y = a; g.add(arm);
      const mot = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .34, 24), dark); mot.position.set(x, 1.95, z); g.add(mot);
      const gm = new THREE.MeshStandardMaterial({ color: 0x3ad6ff, emissive: 0x3ad6ff, emissiveIntensity: 1.5 });
      const glow = new THREE.Mesh(new THREE.TorusGeometry(.27, .04, 8, 32), gm); glow.rotation.x = Math.PI / 2; glow.position.set(x, 2.0, z); g.add(glow); glows.push(glow);
      const rot = new THREE.Group(); rot.position.set(x, 2.18, z);
      const bm = new THREE.MeshStandardMaterial({ color: 0x2b3448, metalness: .4, roughness: .5 });
      for (const s of [-1, 1]) {                       // rotor bipale : 2 pales vrillées
        const bl = new THREE.Mesh(new THREE.BoxGeometry(.97, .025, .16), bm);
        bl.position.x = s * .5; bl.rotation.x = s * .14; rot.add(bl);
      }
      g.add(rot); rotors.push(rot);
      const dm = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), dm); disc.rotation.x = -Math.PI / 2; disc.position.set(x, 2.19, z); g.add(disc); discs.push(disc);
      const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(String(i + 1), '#ffd166'), depthTest: false }));
      lab.position.set(x * 1.45, 2.4, z * 1.45); lab.scale.set(.9, .9, .9); lab.visible = false; g.add(lab); labels.push(lab);
    }
    // patins
    for (const sx of [-.95, .95]) {
      const sk = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 3.6, 10), dark); sk.rotation.x = Math.PI / 2; sk.position.set(sx, -1.45, 0); g.add(sk);
      for (const sz of [-.9, .9]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .7, 8), dark); st.position.set(sx * .85, -1.1, sz); st.rotation.z = sx * .25; g.add(st); }
    }
    // feux de navigation
    const nav = (c, x, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(.09, 12, 8), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, 1.85, z); g.add(m); return m; };
    nav(0xff3355, -R_ARM - .1, 0); nav(0x33ff88, R_ARM + .1, 0);
    g.userData.strobe = nav(0xffffff, 0, R_ARM + .1);
    const spot = new THREE.PointLight(0x9fdcff, 1.2, 40); spot.position.y = -2; g.add(spot);
    return g;
  }

  // ---------- ville ----------
  function buildCity() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshBasicMaterial({ color: 0x060a14 }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const grid = new THREE.GridHelper(3000, 150, 0x1d3a6a, 0x0f1f3d); grid.position.y = .05; grid.material.transparent = true; grid.material.opacity = .5; scene.add(grid);
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, .5, 0);
    const wt = windowTex(); wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a2238, map: wt, emissive: 0xffffff, emissiveMap: wt, emissiveIntensity: .85, roughness: .8 });
    const list = [];
    for (let x = -420; x <= 420; x += 30) for (let z = 260; z >= -1300; z -= 30) {
      if (Math.abs(x) % 120 < 5 || Math.abs(z) % 150 < 5) continue;            // avenues
      if (Math.hypot(x, z) < 45 || Math.hypot(x, z - landingZ) < 45) continue;   // vertiports
      if (Math.random() < .15) continue;
      const center = Math.exp(-Math.pow((z - landingZ) / 260, 2));               // centre-ville = tours
      const h = 8 + Math.random() * 30 + center * Math.random() * 140;
      list.push([x + (Math.random() - .5) * 6, z + (Math.random() - .5) * 6, 12 + Math.random() * 12, h, 12 + Math.random() * 12]);
    }
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    list.forEach((b, i) => {
      m.compose(new THREE.Vector3(b[0], 0, b[1]), new THREE.Quaternion(), new THREE.Vector3(b[2], b[3], b[4]));
      mesh.setMatrixAt(i, m); col.setHSL(.6 + Math.random() * .08, .25, .35 + Math.random() * .25); mesh.setColorAt(i, col);
    });
    scene.add(mesh);
    // vertiports
    const pt = padTex();
    for (const z of [0, landingZ]) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(14, 15, 2, 48), new THREE.MeshStandardMaterial({ color: 0x1a2238 })); base.position.set(0, 1, z); scene.add(base);
      const pad = new THREE.Mesh(new THREE.CircleGeometry(13, 48), new THREE.MeshBasicMaterial({ map: pt })); pad.rotation.x = -Math.PI / 2; pad.position.set(0, 2.02, z); scene.add(pad);
      const lamp = new THREE.PointLight(0x3ad6ff, .8, 30); lamp.position.set(0, 6, z); scene.add(lamp);
    }
  }

  // ---------- initialisation ----------
  function init() {
    const mis = window.SIM.mission;
    landingZ = -mis.x[mis.x.length - 1] * 1000 / X_SCALE;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    scene = new THREE.Scene();
    scene.background = skyTex();
    scene.fog = new THREE.FogExp2(0x0d1433, .0019);
    camera = new THREE.PerspectiveCamera(45, 1, .3, 5000);
    scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x0b0f1c, .75));
    const sun = new THREE.DirectionalLight(0xffb27a, 1.3); sun.position.set(-200, 120, -400); scene.add(sun);
    const fill = new THREE.DirectionalLight(0x6fa8ff, .5); fill.position.set(100, 200, 200); scene.add(fill);
    buildCity();
    drone = buildDrone(); scene.add(drone);
    clock = new THREE.Clock();
    const el = renderer.domElement;
    el.addEventListener('pointerdown', e => { orbit.drag = true; orbit.px = e.clientX; orbit.py = e.clientY; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => { if (!orbit.drag || mode !== 'inspect') return; orbit.az -= (e.clientX - orbit.px) * .008; orbit.el = Math.min(1.4, Math.max(-.3, orbit.el + (e.clientY - orbit.py) * .006)); orbit.px = e.clientX; orbit.py = e.clientY; });
    el.addEventListener('pointerup', () => orbit.drag = false);
    el.addEventListener('wheel', e => { if (mode !== 'inspect') return; e.preventDefault(); orbit.r = Math.min(40, Math.max(7, orbit.r * (1 + e.deltaY * .001))); }, { passive: false });
    addEventListener('resize', resize);
    renderer.setAnimationLoop(frame);
  }

  function attach(el, m) {
    host = el; mode = m;
    el.prepend(renderer.domElement);
    labels.forEach(l => l.visible = (m === 'top'));
    if (m !== 'mission') state.flight = null;
    if (m !== 'top') { state.failed = -1; state.rpm.fill(RPM_H); state.load.fill(.45); }
    if (m === 'inspect') { orbit.az = .7; orbit.el = .3; orbit.r = 15; }
    resize();
  }
  function resize() {
    if (!host) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  const cCy = new THREE.Color(0x3ad6ff), cOr = new THREE.Color(0xff8a3d), cRd = new THREE.Color(0xff3355), tmp = new THREE.Color();
  function frame() {
    if (!host || !host.closest('.slide.active')) { clock.getDelta(); return; }
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    // rotors
    for (let i = 0; i < NR; i++) {
      const r = state.rpm[i] / RPM_H;
      rotors[i].rotation.y += (i % 2 ? -1 : 1) * r * 2 * Math.PI * 2.3 * dt;
      discs[i].material.opacity = .03 + .13 * Math.min(r, 1.4);
      const L = state.load[i];
      if (i === state.failed) { tmp.copy(cRd); glows[i].material.emissiveIntensity = 1 + Math.sin(t * 14) ; }
      else { tmp.copy(cCy).lerp(cOr, Math.min(Math.max(L, 0), 1)); glows[i].material.emissiveIntensity = 1.6; }
      glows[i].material.color.copy(tmp); glows[i].material.emissive.copy(tmp);
    }
    drone.userData.strobe.visible = (t % 1.2) < .08;

    if (mode === 'hero') {
      drone.position.set(0, 90 + Math.sin(t * .8) * .4, 0); drone.rotation.set(Math.sin(t * .6) * .02, t * .05, Math.sin(t * .7) * .02);
      const a = t * .1;
      camera.position.set(Math.cos(a) * 20 - 4, 87, Math.sin(a) * 20 + 4);
      camera.lookAt(-4, 89, 0);
    } else if (mode === 'inspect') {
      drone.position.set(0, 90, 0); drone.rotation.set(0, 0, 0);
      if (!orbit.drag) orbit.az += dt * .12;
      camera.position.set(Math.cos(orbit.az) * Math.cos(orbit.el) * orbit.r, 90.5 + Math.sin(orbit.el) * orbit.r, Math.sin(orbit.az) * Math.cos(orbit.el) * orbit.r);
      camera.lookAt(0, 90.5, 0);
    } else if (mode === 'mission') {
      const f = state.flight || { x: 0, h: 0, pitch: 0 };
      drone.position.set(0, 2 + 1.5 + f.h * ALT_SCALE, -f.x * 1000 / X_SCALE);
      drone.rotation.set(-f.pitch, 0, 0);
      const target = new THREE.Vector3(16, 7 + Math.min(f.h * ALT_SCALE * .2, 16), 28).add(drone.position);
      if (snap) { camPos.copy(target); snap = false; } else camPos.lerp(target, 1 - Math.exp(-dt * 3));
      camera.position.copy(camPos); camera.lookAt(drone.position.x, drone.position.y, drone.position.z - 4);
    } else if (mode === 'top') {
      drone.position.set(0, 90, 0); drone.rotation.set(0, 0, 0);
      camera.position.set(0, 106, 7); camera.up.set(0, 1, 0); camera.lookAt(0, 90, 0);
    }
    renderer.render(scene, camera);
  }

  return {
    init, attach, state, resize,
    setFlight(x, h, pitch) { state.flight = { x, h, pitch }; },
    resetChase() { snap = true; },
  };
})();
