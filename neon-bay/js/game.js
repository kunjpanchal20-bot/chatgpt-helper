'use strict';
/* ============================================================
   Neon Bay — game.js
   Global state, input, the main loop and save handling.
   ============================================================ */

const G = {
  world: null,
  player: null,
  vehicles: [],
  peds: [],
  bullets: [],
  particles: [],
  pickups: [],
  markers: [],
  decals: [],
  shockwaves: [],

  cam: { x: 0, y: 0, zoom: 1 },
  camZoomTarget: 1,

  time: 0,
  clock: 8.5,            // in-game hours
  dayLength: 420,        // real seconds per in-game day
  nightAmount: 0,

  shake: 0,
  flash: 0,
  quality: 1,

  money: 500,
  state: 'menu',         // menu | play | paused | wasted | busted
  wanted: null,          // set to the Wanted module below
  jobPrompt: null,
  nearVehicle: null,
  godMode: false,

  stats: { kills: 0, deaths: 0, missions: 0, carsStolen: 0, earned: 0, shots: 0, maxWanted: 0, distance: 0 },

  input: null,
  fps: 60,

  // Reusable scratch arrays so the hot loops never allocate.
  _scratchA: [], _scratchB: [], _scratchC: [],
  _circA: [], _circB: [],
};

G.wanted = Wanted;

/* ================================================================== */
/*  Input                                                              */
/* ================================================================== */

const Input = {
  keys: {},
  mouseX: 0, mouseY: 0,
  mouseDown: false,
  aim: 0,
  firePressed: false,
  fireHeld: false,
  enterPressed: false,
  jobPressed: false,
  handbrake: false,
  sprint: false,
  up: false, down: false, left: false, right: false,
  moveX: undefined, moveY: undefined,
  driveX: undefined, driveY: undefined,
  touchActive: false,
  cheatBuffer: '',

  init(canvas) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { return; }
      this.keys[e.code] = true;
      this.handleKey(e);
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouseDown = true; this.firePressed = true; }
      Audio_.resume();
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      G.player.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    this.initTouch(canvas);
  },

  handleKey(e) {
    const code = e.code;
    if (G.state === 'menu') return;      // the menu owns the keyboard
    if (code === 'KeyF') this.enterPressed = true;
    if (code === 'KeyH') this.jobPressed = true;
    if (code === 'KeyQ') G.player.cycleWeapon(-1);
    if (code === 'KeyE') G.player.cycleWeapon(1);
    if (code === 'KeyR') Notify.show(Audio_.nextStation(), '#22d3ee');
    if (code === 'KeyM' && G.state !== 'menu') {
      HUD.showFullMap = !HUD.showFullMap;
      e.preventDefault();
    }
    if (code === 'Escape' || code === 'KeyP') togglePause();
    if (code === 'Digit1') G.player.selectWeapon('fist');
    if (code === 'Digit2') G.player.selectWeapon('pistol');
    if (code === 'Digit3') G.player.selectWeapon('smg');
    if (code === 'Digit4') G.player.selectWeapon('shotgun');
    if (code === 'Digit5') G.player.selectWeapon('rifle');
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(code) >= 0) e.preventDefault();

    // Cheat codes, typed anywhere.
    if (e.key && e.key.length === 1 && /[a-z]/i.test(e.key)) {
      this.cheatBuffer = (this.cheatBuffer + e.key.toLowerCase()).slice(-12);
      checkCheats(this.cheatBuffer);
    }
  },

  initTouch(canvas) {
    const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.stick = stick;

    const onStart = (e) => {
      this.touchActive = true;
      Audio_.resume();
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.45 && stick.id === null) {
          stick.id = t.identifier;
          stick.ox = t.clientX; stick.oy = t.clientY;
          stick.x = 0; stick.y = 0;
        } else {
          this.firePressed = true;
          this.fireHeld = true;
        }
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stick.id) {
          stick.x = clamp((t.clientX - stick.ox) / 60, -1, 1);
          stick.y = clamp((t.clientY - stick.oy) / 60, -1, 1);
        }
      }
      e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stick.id) { stick.id = null; stick.x = 0; stick.y = 0; }
        else this.fireHeld = false;
      }
      e.preventDefault();
    };

    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd, { passive: false });
    canvas.addEventListener('touchcancel', onEnd, { passive: false });
  },

  /** Collapse raw input into the flags the player reads each frame. */
  poll(canvas, W, H) {
    const k = this.keys;
    this.up = !!(k.KeyW || k.ArrowUp);
    this.down = !!(k.KeyS || k.ArrowDown);
    this.left = !!(k.KeyA || k.ArrowLeft);
    this.right = !!(k.KeyD || k.ArrowRight);
    this.sprint = !!(k.ShiftLeft || k.ShiftRight);
    this.handbrake = !!k.Space;
    this.fireHeld = this.mouseDown || !!k.ControlLeft || this.fireHeld;
    if (k.ControlLeft) this.firePressed = true;

    if (this.touchActive && this.stick.id !== null) {
      const p = G.player;
      if (p.vehicle) {
        this.driveX = this.stick.x;
        this.driveY = this.stick.y;
        this.moveX = undefined; this.moveY = undefined;
      } else {
        this.moveX = this.stick.x;
        this.moveY = this.stick.y;
        this.driveX = undefined; this.driveY = undefined;
      }
    } else {
      this.moveX = this.moveY = this.driveX = this.driveY = undefined;
    }

    // Screen-space aim -> world angle.
    const p = G.player;
    const wx = G.cam.x + (this.mouseX - W / 2) / G.cam.zoom;
    const wy = G.cam.y + (this.mouseY - H / 2) / G.cam.zoom;
    const ox = p.vehicle ? p.vehicle.x : p.x;
    const oy = p.vehicle ? p.vehicle.y : p.y;
    if (this.touchActive) {
      this.aim = p.vehicle ? p.vehicle.angle : (this.stick.x || this.stick.y
        ? Math.atan2(this.stick.y, this.stick.x) : p.aim);
    } else {
      this.aim = Math.atan2(wy - oy, wx - ox);
    }
    void canvas;
  },

  endFrame() {
    this.firePressed = false;
    this.enterPressed = false;
    this.jobPressed = false;
    if (!this.mouseDown && !this.keys.ControlLeft && !this.touchActive) this.fireHeld = false;
  },
};

G.input = Input;

/** Used while the menu is up so the city keeps running behind it, untouched. */
const NeutralInput = {
  up: false, down: false, left: false, right: false,
  sprint: false, handbrake: false,
  firePressed: false, fireHeld: false, enterPressed: false, jobPressed: false,
  aim: 0,
};

/* ================================================================== */
/*  Cheats                                                             */
/* ================================================================== */

const CHEATS = {
  guns() {
    const p = G.player;
    p.giveWeapon('pistol', 200);
    p.giveWeapon('smg', 400);
    p.giveWeapon('shotgun', 100);
    p.giveWeapon('rifle', 300);
    Notify.show('CHEAT: full arsenal', '#ffd166');
  },
  heal() {
    G.player.hp = G.player.maxHp;
    G.player.armor = G.player.maxArmor;
    Notify.show('CHEAT: patched up', '#2ecc71');
  },
  cash() {
    G.money += 10000;
    Notify.show('CHEAT: +$10,000', '#f1c40f');
  },
  heat() {
    Wanted.addCrime('cheat', 120);
    Notify.show('CHEAT: heat raised', '#ff4d6d');
  },
  clean() {
    Wanted.reset();
    Notify.show('CHEAT: wanted level cleared', '#7bed9f');
  },
  boom() {
    for (let i = 0; i < 5; i++) {
      const a = rand(0, TAU);
      createExplosion(G.player.x + Math.cos(a) * 140, G.player.y + Math.sin(a) * 140, 90, G.player);
    }
    Notify.show('CHEAT: fireworks', '#ff9f43');
  },
  tank() {
    const p = G.player;
    const v = spawnVehicle('truck', p.x + 70, p.y, p.angle, '#3d4a34');
    v.hp = v.maxHp = 900;
    v.ai = { mode: 'parked' };
    Notify.show('CHEAT: heavy vehicle delivered', '#ffd166');
  },
  ghost() {
    G.godMode = !G.godMode;
    Notify.show('CHEAT: invincibility ' + (G.godMode ? 'ON' : 'OFF'), '#22d3ee');
  },
};

function checkCheats(buffer) {
  for (const name in CHEATS) {
    if (buffer.endsWith(name)) {
      CHEATS[name]();
      Audio_.missionDone();
      Input.cheatBuffer = '';
      return;
    }
  }
}

/* ================================================================== */
/*  Lifecycle                                                          */
/* ================================================================== */

function startGame(seed) {
  G.world = generateCity(seed || 20260817);
  G.vehicles.length = 0;
  G.peds.length = 0;
  G.bullets.length = 0;
  G.particles.length = 0;
  G.pickups.length = 0;
  G.markers.length = 0;
  G.decals.length = 0;
  G.shockwaves.length = 0;

  const home = G.world.landmarks.find((l) => l.type === 'safehouse');
  const sx = home ? home.x : G.world.size / 2;
  const sy = home ? home.y - 60 : G.world.size / 2;

  G.player = new Player(sx, sy);
  G.cam.x = sx; G.cam.y = sy; G.cam.zoom = 1;
  G.time = 0;
  G.clock = 8.5;
  G.state = 'play';

  Wanted.reset();
  Missions.index = 0;
  Missions.active = null;
  Missions.sideJob = null;

  loadGame();

  Population.seed();
  scatterPickups();
  HUD.buildMap(G.world);
  Missions.init();

  Notify.showBig('NEON BAY', 'Welcome home');
}

/** Health, armor and weapon pickups sprinkled around the city. */
function scatterPickups() {
  const w = G.world;
  const kinds = ['health', 'health', 'armor', 'pistol', 'pistol', 'smg', 'shotgun', 'rifle', 'health', 'armor'];
  for (let i = 0; i < 46; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = rand(60, w.size - 60), y = rand(60, w.size - 60);
      if (pointBlocked(x, y, 16)) continue;
      if (w.isOnRoad(x, y)) continue;
      spawnPickup(kinds[i % kinds.length], x, y, 0);
      break;
    }
  }
  // Guaranteed pistol + health right outside the safehouse.
  const home = w.landmarks.find((l) => l.type === 'safehouse');
  if (home) {
    spawnPickup('pistol', home.x + 60, home.y - 40, 0);
    spawnPickup('health', home.x - 60, home.y - 40, 0);
  }
}

function respawnPlayer() {
  const p = G.player;
  const home = G.world.landmarks.find((l) => l.type === 'safehouse');
  p.x = home ? home.x - 70 : G.world.size / 2;
  p.y = home ? home.y - 70 : G.world.size / 2;
  p.vx = p.vy = 0;
  p.hp = p.maxHp;
  p.armor = 0;
  p.alive = true;
  p.invuln = 2.5;
  p.bustTimer = 0;
  p.vehicle = null;
  const fee = Math.max(0, Math.min(G.money, Math.round(G.money * 0.1) + 100));
  G.money -= fee;
  // Hospital confiscates the hardware.
  for (const w of WEAPON_ORDER) {
    if (w === 'fist') continue;
    p.owned[w] = false;
    p.ammo[w] = 0;
  }
  p.weapon = 'fist';
  Wanted.reset();
  G.state = 'play';
  G.markers.length = 0;
  Missions.placeNextStartMarker();
  Notify.show('Medical fee: -$' + commas(fee), '#ff9f43');
  saveGame();
}

function bustPlayer() {
  const p = G.player;
  if (!p.alive || G.state !== 'play') return;
  G.state = 'busted';
  p.alive = false;
  p.respawnTimer = 3.0;
  Audio_.missionFail();
  Missions.onBusted();
  const fine = Math.max(0, Math.min(G.money, Math.round(G.money * 0.15) + 150));
  G.money -= fine;
  Notify.show('Fine: -$' + commas(fine), '#ff9f43');
}

function togglePause() {
  if (G.state === 'menu') return;
  if (G.state === 'paused') {
    G.state = 'play';
    document.getElementById('pause').classList.add('hidden');
  } else if (G.state === 'play') {
    G.state = 'paused';
    document.getElementById('pause').classList.remove('hidden');
    refreshPauseStats();
  }
}

/* ================================================================== */
/*  Save / load                                                        */
/* ================================================================== */

const SAVE_KEY = 'neonbay.save.v1';

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: G.money,
      mission: Missions.index,
      stats: G.stats,
      clock: G.clock,
    }));
  } catch (err) { void err; }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (typeof d.money === 'number') G.money = d.money;
    if (typeof d.mission === 'number') Missions.index = clamp(d.mission, 0, STORY.length);
    if (typeof d.clock === 'number') G.clock = d.clock;
    if (d.stats) Object.assign(G.stats, d.stats);
    if (Missions.index > 0) Notify.show('Progress loaded — job ' + (Missions.index + 1), '#22d3ee');
  } catch (err) { void err; }
}

function wipeSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (err) { void err; }
}

/* ================================================================== */
/*  Simulation                                                         */
/* ================================================================== */

function update(dt) {
  G.time += dt;

  // Clock + day/night.
  G.clock = (G.clock + (24 / G.dayLength) * dt) % 24;
  const h = G.clock;
  let night;
  if (h < 5) night = 1;
  else if (h < 7) night = 1 - (h - 5) / 2;
  else if (h < 18) night = 0;
  else if (h < 20.5) night = (h - 18) / 2.5;
  else night = 1;
  G.nightAmount = lerp(G.nightAmount, night, clamp(dt * 0.6, 0, 1));

  G.shake = Math.max(0, G.shake - dt * 26);
  G.flash = Math.max(0, G.flash - dt * 2.4);

  const p = G.player;
  const input = G.state === 'menu' ? NeutralInput : Input;

  p.update(dt, input);

  // Vehicle AI + physics.
  for (const v of G.vehicles) {
    if (v.removed) continue;
    if (v.driver !== p) VehicleAI.update(v, dt);
    v.update(dt);
  }

  // Vehicle-vehicle collisions (broad-phase by distance first).
  for (let i = 0; i < G.vehicles.length; i++) {
    const a = G.vehicles[i];
    if (a.removed) continue;
    for (let j = i + 1; j < G.vehicles.length; j++) {
      const b = G.vehicles[j];
      if (b.removed) continue;
      const rr = a.def.len * 0.55 + b.def.len * 0.55;
      if (dist2(a.x, a.y, b.x, b.y) > rr * rr) continue;
      Vehicle.resolvePair(a, b);
    }
  }

  // Peds: run them over, or let them walk.
  for (const ped of G.peds) {
    if (ped.removed) continue;
    ped.update(dt);
    if (!ped.dead && !ped.vehicle) checkPedVsVehicles(ped, dt);
  }

  for (const b of G.bullets) b.update(dt);
  for (const part of G.particles) part.update(dt);
  for (const pk of G.pickups) pk.update(dt);

  for (let i = G.shockwaves.length - 1; i >= 0; i--) {
    const s = G.shockwaves[i];
    s.life -= dt;
    s.r += (s.max - s.r) * clamp(dt * 6, 0, 1);
    if (s.life <= 0) G.shockwaves.splice(i, 1);
  }
  for (let i = G.decals.length - 1; i >= 0; i--) {
    G.decals[i].life -= dt;
    if (G.decals[i].life <= 0) G.decals.splice(i, 1);
  }

  Wanted.update(dt);
  Population.update(dt);
  Missions.update(dt);
  Notify.update(dt);

  compact();
  updateCamera(dt);
  updateAudio(dt);

  if (p.vehicle) G.stats.distance += Math.abs(p.vehicle.speed) * dt;
}

function checkPedVsVehicles(ped, dt) {
  for (const v of G.vehicles) {
    if (v.removed) continue;
    const speed = Math.abs(v.speed);
    const cs = v.circles(G._circA);
    for (let k = 0; k < 2; k++) {
      const c = cs[k];
      const d = dist(ped.x, ped.y, c.x, c.y);
      if (d > c.r + ped.r) continue;
      const a = Math.atan2(ped.y - c.y, ped.x - c.x);
      const push = c.r + ped.r - d;
      ped.x += Math.cos(a) * push;
      ped.y += Math.sin(a) * push;
      if (speed > 78) {
        const attacker = v.driver === G.player ? G.player : null;
        // NPC traffic clips people; it does not routinely kill them.
        ped.damage(speed * (attacker ? 0.42 : 0.16), 'vehicle', attacker);
        ped.vx += Math.cos(a) * speed * 1.7;
        ped.vy += Math.sin(a) * speed * 1.7;
        if (attacker) {
          G.shake = Math.max(G.shake, 4);
          Wanted.addCrime('roadkill', ped.dead ? 20 : 8);
        }
      } else if (speed > 12) {
        ped.state = 'flee';
        ped.panicTimer = Math.max(ped.panicTimer, 4);
      }
      break;
    }
  }
  void dt;
}

/** Drop removed entities without churning the arrays every frame. */
function compact() {
  let need = false;
  for (const v of G.vehicles) if (v.removed) { need = true; break; }
  if (need) G.vehicles = G.vehicles.filter((v) => !v.removed);

  need = false;
  for (const p of G.peds) if (p.removed) { need = true; break; }
  if (need) G.peds = G.peds.filter((p) => !p.removed);

  need = false;
  for (const b of G.bullets) if (b.removed) { need = true; break; }
  if (need) G.bullets = G.bullets.filter((b) => !b.removed);

  need = false;
  for (const p of G.particles) if (p.removed) { need = true; break; }
  if (need) G.particles = G.particles.filter((p) => !p.removed);

  need = false;
  for (const p of G.pickups) if (p.removed) { need = true; break; }
  if (need) G.pickups = G.pickups.filter((p) => !p.removed);
}

function updateCamera(dt) {
  const p = G.player;
  const v = p.vehicle;
  const tx = (v ? v.x : p.x) + (v ? v.vx * 0.28 : p.vx * 0.16);
  const ty = (v ? v.y : p.y) + (v ? v.vy * 0.28 : p.vy * 0.16);

  const follow = clamp(dt * (v ? 5.5 : 8), 0, 1);
  G.cam.x = lerp(G.cam.x, tx, follow);
  G.cam.y = lerp(G.cam.y, ty, follow);

  const speed = v ? Math.abs(v.speed) : 0;
  G.camZoomTarget = v ? clamp(1.0 - speed / 700, 0.62, 1.0) : 1.12;
  G.cam.zoom = lerp(G.cam.zoom, G.camZoomTarget * G.baseZoom, clamp(dt * 2.4, 0, 1));

  // Nearest enterable vehicle, for the on-screen prompt.
  if (!p.vehicle) {
    let best = null, bestD = 46 * 46;
    for (const veh of G.vehicles) {
      if (veh.removed || veh.dead) continue;
      const d = dist2(p.x, p.y, veh.x, veh.y);
      if (d < bestD) { bestD = d; best = veh; }
    }
    G.nearVehicle = best;
  } else G.nearVehicle = null;
}

function updateAudio(dt) {
  const p = G.player;
  if (p.vehicle) {
    const v = p.vehicle;
    const rpm = clamp(Math.abs(v.speed) / v.def.top, 0, 1);
    Audio_.updateEngine(rpm * 0.85 + Math.abs(v.throttle) * 0.15, Math.abs(v.throttle), !v.dead);
  } else {
    Audio_.updateEngine(0, 0, false);
  }

  let nearestSiren = Infinity;
  for (const v of G.vehicles) {
    if (!v.sirenOn || v.dead) continue;
    const d = dist(v.x, v.y, p.x, p.y);
    if (d < nearestSiren) nearestSiren = d;
  }
  Audio_.updateSiren(nearestSiren < 900 ? clamp(1 - nearestSiren / 900, 0, 1) : 0, dt);
  Audio_.updateRadio();
}

/* ================================================================== */
/*  Boot                                                               */
/* ================================================================== */

let canvas, ctx, lastTime = 0, fpsAccum = 0, fpsFrames = 0;
G.baseZoom = 1;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Show a consistent slice of the world regardless of screen size:
  // ~620 world units tall at zoom 1, scaled up for hi-dpi backing stores.
  G.baseZoom = clamp(canvas.height / 620, 0.6, 4);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!lastTime) lastTime = now;
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  dt = Math.min(dt, 0.05);

  fpsAccum += dt; fpsFrames++;
  if (fpsAccum > 0.5) {
    G.fps = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0; fpsFrames = 0;
    // Drop window detail on machines that cannot keep up, and take it back
    // once there is headroom again.
    if (G.fps < 34 && G.quality > 0) G.quality = 0;
    else if (G.fps > 52 && G.quality === 0) G.quality = 1;
  }

  const W = canvas.width, H = canvas.height;

  if (G.state === 'paused') {
    Notify.update(dt);
  } else {
    if (G.state !== 'menu') Input.poll(canvas, W, H);
    update(dt);
  }

  Render.draw(ctx, W, H);
  HUD.draw(ctx, W, H);
  Input.endFrame();
}

function boot() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d', { alpha: false });
  window.addEventListener('resize', resize);

  startGame();
  G.state = 'menu';        // world simulates behind the title screen
  resize();
  Input.init(canvas);

  document.getElementById('btn-play').addEventListener('click', () => {
    Audio_.init();
    Audio_.resume();
    document.getElementById('menu').classList.add('hidden');
    G.state = 'play';
    canvas.focus();
  });
  document.getElementById('btn-newgame').addEventListener('click', () => {
    wipeSave();
    Audio_.init();
    Audio_.resume();
    G.money = 500;
    G.stats = { kills: 0, deaths: 0, missions: 0, carsStolen: 0, earned: 0, shots: 0, maxWanted: 0, distance: 0 };
    startGame();
    document.getElementById('menu').classList.add('hidden');
    G.state = 'play';
  });
  document.getElementById('btn-resume').addEventListener('click', togglePause);
  document.getElementById('btn-mute').addEventListener('click', (e) => {
    Audio_.setMuted(!Audio_.muted);
    e.target.textContent = Audio_.muted ? 'Sound: off' : 'Sound: on';
  });
  document.getElementById('btn-quit').addEventListener('click', () => {
    saveGame();
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
    G.state = 'menu';
  });

  setInterval(() => { if (G.state === 'play') saveGame(); }, 20000);

  requestAnimationFrame(frame);
}

function refreshPauseStats() {
  const s = G.stats;
  const el = document.getElementById('pause-stats');
  if (!el) return;
  el.innerHTML = [
    ['Cash', '$' + commas(G.money)],
    ['Jobs completed', s.missions + ' / ' + STORY.length],
    ['Cars stolen', s.carsStolen],
    ['Shots fired', s.shots],
    ['Takedowns', s.kills],
    ['Times wasted', s.deaths],
    ['Highest wanted', '★'.repeat(s.maxWanted) || '—'],
    ['Distance driven', commas(s.distance / 40) + ' m'],
    ['Radio', Audio_.stationName()],
  ].map(([k, v]) => '<div class="row"><span>' + k + '</span><b>' + v + '</b></div>').join('');
}

window.addEventListener('DOMContentLoaded', boot);
