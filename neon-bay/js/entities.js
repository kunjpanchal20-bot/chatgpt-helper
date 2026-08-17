'use strict';
/* ============================================================
   Neon Bay — entities.js
   Vehicles, pedestrians, bullets, particles and pickups.
   ============================================================ */

const VEHICLE_TYPES = {
  compact: { len: 52, wid: 26, accel: 260, top: 210, brake: 420, turn: 3.0, grip: 7.0, mass: 1.0, hp: 100, seats: 2 },
  sedan: { len: 62, wid: 28, accel: 250, top: 235, brake: 400, turn: 2.7, grip: 6.6, mass: 1.2, hp: 120, seats: 4 },
  taxi: { len: 62, wid: 28, accel: 250, top: 230, brake: 400, turn: 2.7, grip: 6.6, mass: 1.2, hp: 120, seats: 4 },
  sports: { len: 60, wid: 28, accel: 400, top: 355, brake: 520, turn: 3.1, grip: 6.2, mass: 1.0, hp: 90, seats: 2 },
  muscle: { len: 68, wid: 31, accel: 350, top: 320, brake: 440, turn: 2.5, grip: 5.2, mass: 1.4, hp: 130, seats: 2 },
  van: { len: 78, wid: 34, accel: 200, top: 190, brake: 360, turn: 2.1, grip: 6.0, mass: 1.9, hp: 170, seats: 4 },
  truck: { len: 104, wid: 40, accel: 165, top: 165, brake: 300, turn: 1.6, grip: 5.6, mass: 3.2, hp: 260, seats: 2 },
  police: { len: 64, wid: 29, accel: 340, top: 305, brake: 480, turn: 2.9, grip: 6.8, mass: 1.3, hp: 150, seats: 4, police: true },
  bike: { len: 40, wid: 16, accel: 430, top: 340, brake: 400, turn: 3.6, grip: 7.4, mass: 0.6, hp: 55, seats: 1, bike: true },
};

const CIVILIAN_TYPES = ['compact', 'sedan', 'sedan', 'taxi', 'sports', 'muscle', 'van', 'truck', 'bike', 'compact'];

const CAR_COLORS = [
  '#c0392b', '#2980b9', '#f1c40f', '#ecf0f1', '#1a1a1e', '#16a085',
  '#8e44ad', '#e67e22', '#7f8c8d', '#27ae60', '#d35400', '#34495e',
];

let ENTITY_ID = 1;

/* ================================================================== */
/*  Vehicle                                                            */
/* ================================================================== */

class Vehicle {
  constructor(type, x, y, angle, color) {
    this.id = ENTITY_ID++;
    this.kind = 'vehicle';
    this.type = type;
    this.def = VEHICLE_TYPES[type];
    this.x = x; this.y = y;
    this.angle = angle || 0;
    this.vx = 0; this.vy = 0;
    this.speed = 0;             // signed speed along the heading
    this.steer = 0;
    this.color = color || choice(CAR_COLORS);
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.radius = this.def.len * 0.42;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.driver = null;         // player or ped
    this.ai = null;             // traffic / police / flee behaviour
    this.burning = 0;
    this.dead = false;
    this.removed = false;
    this.sirenOn = false;
    this.sirenPhase = Math.random() * TAU;
    this.lastHitBy = null;
    this.wheelSpin = 0;
    this.skidTimer = 0;
    this.stuck = 0;
    this.locked = false;
    this.persistent = false;    // mission cars are never culled
  }

  get isPolice() { return !!this.def.police; }

  /** Front / rear collision circles. */
  circles(out) {
    out = out || [];
    const off = this.def.len * 0.25;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    out[0] = { x: this.x + c * off, y: this.y + s * off, r: this.def.wid * 0.58 };
    out[1] = { x: this.x - c * off, y: this.y - s * off, r: this.def.wid * 0.58 };
    return out;
  }

  update(dt) {
    const d = this.def;

    if (this.dead) {
      this.burning -= dt;
      if (this.burning <= 0) this.explode();
      if (Math.random() < dt * 22) {
        spawnParticle('smoke', this.x + rand(-10, 10), this.y + rand(-10, 10), rand(-8, 8), rand(-26, -6), rand(0.7, 1.5));
      }
      if (Math.random() < dt * 12) {
        spawnParticle('fire', this.x + rand(-8, 8), this.y + rand(-8, 8), rand(-6, 6), rand(-20, -4), rand(0.25, 0.5));
      }
    }

    const forwardX = Math.cos(this.angle), forwardY = Math.sin(this.angle);
    const rightX = -forwardY, rightY = forwardX;

    let vf = this.vx * forwardX + this.vy * forwardY;
    let vr = this.vx * rightX + this.vy * rightY;

    const engineOK = !this.dead;
    const throttle = engineOK ? this.throttle : 0;

    // Longitudinal forces.
    if (throttle > 0) {
      const topSpeed = d.top * (this.burning > 0 ? 0.7 : 1);
      const fade = 1 - clamp(Math.abs(vf) / topSpeed, 0, 1);
      vf += throttle * d.accel * (0.35 + fade * 0.65) * dt;
    } else if (throttle < 0) {
      if (vf > 6) vf -= d.brake * dt;                       // braking
      else vf += throttle * d.accel * 0.55 * dt;            // reverse
    }
    if (this.handbrake) vf = approach(vf, 0, d.brake * 1.1 * dt);

    // Drag + rolling resistance.
    vf -= vf * (0.55 + Math.abs(vf) * 0.0018) * dt;

    // Lateral grip. The handbrake (and a burning wreck) breaks traction.
    let grip = d.grip;
    if (this.handbrake) grip *= 0.16;
    if (Math.abs(vr) > 90) grip *= 0.75;
    vr -= vr * clamp(grip * dt, 0, 1);

    // Steering: rate scales with speed and reverses when going backwards.
    const speedFactor = clamp(Math.abs(vf) / 55, 0, 1) * (1 - clamp(Math.abs(vf) / (d.top * 2.4), 0, 0.45));
    const turnRate = d.turn * speedFactor * sign(vf || 1);
    this.angle = wrapAngle(this.angle + this.steer * turnRate * dt);

    this.speed = vf;
    this.vx = forwardX * vf + rightX * vr;
    this.vy = forwardY * vf + rightY * vr;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.wheelSpin += Math.abs(vf) * dt * 0.12;

    // Tyre smoke + skid marks while sliding.
    const slip = Math.abs(vr);
    if (slip > 55 && Math.abs(vf) > 40) {
      this.skidTimer -= dt;
      if (this.skidTimer <= 0) {
        this.skidTimer = 0.02;
        layTireMark(this);
        if (Math.random() < 0.35) {
          spawnParticle('smoke', this.x + rand(-14, 14), this.y + rand(-14, 14), rand(-10, 10), rand(-10, 10), rand(0.4, 0.9), 0.35);
        }
      }
    }

    this.collideWorld(dt);
    G.world.clampToWorld(this, 16);
  }

  collideWorld(dt) {
    const cs = this.circles();
    const near = G.world.hash.queryCircle(this.x, this.y, this.def.len * 0.7, G._scratchA);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      for (let k = 0; k < near.length; k++) {
        const rect = near[k];
        const hit = circleRectHit(c.x, c.y, c.r, rect);
        if (!hit) continue;

        this.x += hit.nx * hit.depth;
        this.y += hit.ny * hit.depth;
        c.x += hit.nx * hit.depth;
        c.y += hit.ny * hit.depth;

        const vn = this.vx * hit.nx + this.vy * hit.ny;
        if (vn < 0) {
          const impact = -vn;
          this.vx -= hit.nx * vn * 1.35;
          this.vy -= hit.ny * vn * 1.35;
          // Glancing blows scrub speed, head-on hits hurt.
          this.vx *= 0.86; this.vy *= 0.86;
          if (impact > 70) {
            this.damage((impact - 60) * 0.11, 'crash');
            if (impact > 120) {
              Audio_.crash(clamp(impact / 260, 0.2, 1));
              for (let p = 0; p < 4; p++) {
                spawnParticle('spark', c.x, c.y, rand(-60, 60), rand(-60, 60), rand(0.2, 0.4));
              }
              if (this.driver === G.player) G.shake = Math.max(G.shake, clamp(impact / 26, 2, 14));
            } else if (impact > 80) {
              Audio_.crash(0.3);
            }
          }
        }
      }
    }
  }

  /** Separate two vehicles and trade some momentum. */
  static resolvePair(a, b) {
    const ca = a.circles(G._circA), cb = b.circles(G._circB);
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const p = ca[i], q = cb[j];
        const dx = q.x - p.x, dy = q.y - p.y;
        const rr = p.r + q.r;
        const d2v = dx * dx + dy * dy;
        if (d2v >= rr * rr || d2v < 1e-6) continue;
        const dd = Math.sqrt(d2v);
        const nx = dx / dd, ny = dy / dd;
        const overlap = rr - dd;

        const ma = a.def.mass, mb = b.def.mass;
        const total = ma + mb;
        a.x -= nx * overlap * (mb / total);
        a.y -= ny * overlap * (mb / total);
        b.x += nx * overlap * (ma / total);
        b.y += ny * overlap * (ma / total);

        const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn > 0) continue;
        const imp = -(1.25) * vn / total;
        a.vx -= nx * imp * mb; a.vy -= ny * imp * mb;
        b.vx += nx * imp * ma; b.vy += ny * imp * ma;

        const force = -vn;
        if (force > 60) {
          const dmg = (force - 50) * 0.07;
          a.damage(dmg * (mb / total) * 2, 'crash', b.driver === G.player ? G.player : null);
          b.damage(dmg * (ma / total) * 2, 'crash', a.driver === G.player ? G.player : null);
          Audio_.crash(clamp(force / 240, 0.2, 1));
          for (let k = 0; k < 5; k++) {
            spawnParticle('spark', (p.x + q.x) / 2, (p.y + q.y) / 2, rand(-80, 80), rand(-80, 80), rand(0.2, 0.45));
          }
          if (a.driver === G.player || b.driver === G.player) {
            G.shake = Math.max(G.shake, clamp(force / 22, 2, 16));
            const occupant = a.driver === G.player ? a : b;
            if (force > 150) G.player.damage((force - 140) * 0.05, 'crash');
            void occupant;
          }
        }
      }
    }
  }

  damage(n, cause, attacker) {
    if (this.dead || n <= 0) return;
    this.hp -= n;
    if (attacker) this.lastHitBy = attacker;
    if (this.hp < this.maxHp * 0.35 && !this.burning) this.burning = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.burning = rand(2.2, 3.6);
      if (this.driver && this.driver !== G.player) {
        // Occupants bail out of a wreck.
        ejectDriver(this, true);
      }
      if (this.driver === G.player) {
        Notify.show('Your ride is on fire! Get out!', '#ff5252');
      }
      if (this.isPolice && (attacker === G.player || this.lastHitBy === G.player)) {
        Wanted.addCrime('copcar', 18);
      }
    }
    void cause;
  }

  explode() {
    if (this.removed) return;
    this.removed = true;
    createExplosion(this.x, this.y, 96, this.driver === G.player ? null : this.lastHitBy);
    if (this.driver === G.player) {
      G.player.damage(200, 'explosion');
    }
  }

  /** World position of the driver's door, used for entering / exiting. */
  doorPoint() {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const ox = -this.def.len * 0.05, oy = -this.def.wid * 0.78;
    return { x: this.x + c * ox - s * oy, y: this.y + s * ox + c * oy };
  }
}

/* ================================================================== */
/*  Pedestrian                                                         */
/* ================================================================== */

const SHIRT_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#ecf0f1', '#34495e', '#e91e63'];
const SKIN_COLORS = ['#f2c9a0', '#d9a066', '#a56b41', '#7a4a24', '#5a3418', '#ffd9b3'];
const PANTS_COLORS = ['#2c3e50', '#34495e', '#4a4a52', '#5d4037', '#1f2933'];

class Ped {
  constructor(x, y, opts) {
    opts = opts || {};
    this.id = ENTITY_ID++;
    this.kind = 'ped';
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.angle = rand(0, TAU);
    this.r = 7;
    this.hp = opts.hp || 34;
    this.maxHp = this.hp;
    this.speed = 0;
    this.walkSpeed = rand(38, 52);
    this.runSpeed = rand(96, 122);
    this.state = 'wander';
    this.stateTime = 0;
    this.target = null;
    this.shirt = opts.shirt || choice(SHIRT_COLORS);
    this.skin = choice(SKIN_COLORS);
    this.pants = opts.pants || choice(PANTS_COLORS);
    this.bob = Math.random() * TAU;
    this.cop = !!opts.cop;
    this.armed = opts.armed || (this.cop ? 'pistol' : null);
    this.fireCooldown = rand(0.3, 1.2);
    this.dead = false;
    this.removed = false;
    this.deadTimer = 0;
    this.panicTimer = 0;
    this.vehicle = null;
    this.persistent = !!opts.persistent;
    this.missionTarget = false;
    this.money = randInt(4, 60);
  }

  update(dt) {
    if (this.vehicle) return;    // driving is handled by the vehicle AI

    if (this.dead) {
      this.deadTimer += dt;
      this.vx *= 0.86; this.vy *= 0.86;
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (this.deadTimer > 22 && !this.persistent) this.removed = true;
      return;
    }

    PedAI.update(this, dt);

    // Movement + collision against the city.
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const near = G.world.hash.queryCircle(this.x, this.y, this.r + 4, G._scratchB);
    for (let i = 0; i < near.length; i++) {
      const hit = circleRectHit(this.x, this.y, this.r, near[i]);
      if (hit) {
        this.x += hit.nx * hit.depth;
        this.y += hit.ny * hit.depth;
        // Slide along the wall rather than sticking to it.
        const vn = this.vx * hit.nx + this.vy * hit.ny;
        if (vn < 0) { this.vx -= hit.nx * vn; this.vy -= hit.ny * vn; }
      }
    }

    if (this.vx || this.vy) {
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > 4) {
        this.angle = Math.atan2(this.vy, this.vx);
        this.bob += dt * (4 + sp * 0.09);
      }
      this.speed = sp;
    }

    G.world.clampToWorld(this, 8);
  }

  damage(n, cause, attacker) {
    if (this.dead) return;
    this.hp -= n;
    for (let i = 0; i < 4; i++) {
      spawnParticle('blood', this.x, this.y, rand(-50, 50), rand(-50, 50), rand(0.25, 0.5));
    }
    if (attacker === G.player && !this.cop) {
      this.state = 'flee';
      this.panicTimer = 12;
      alertNearbyPeds(this.x, this.y, 190);
    }
    if (this.hp <= 0) this.kill(cause, attacker);
    else Audio_.bodyHit();
  }

  kill(cause, attacker) {
    if (this.dead) return;
    this.dead = true;
    this.deadTimer = 0;
    this.vx *= 0.5; this.vy *= 0.5;
    Audio_.bodyHit();
    for (let i = 0; i < 10; i++) {
      spawnParticle('blood', this.x, this.y, rand(-90, 90), rand(-90, 90), rand(0.3, 0.8));
    }
    spawnDecal('bloodpool', this.x, this.y, rand(14, 22));
    if (attacker === G.player || cause === 'player') {
      Wanted.addCrime(this.cop ? 'killcop' : 'kill', this.cop ? 40 : 22);
      G.stats.kills++;
      if (this.money > 0) spawnPickup('cash', this.x + rand(-6, 6), this.y + rand(-6, 6), this.money);
    }
    alertNearbyPeds(this.x, this.y, 230);
    if (this.onDeath) this.onDeath(this);
  }
}

/* ================================================================== */
/*  Bullets                                                            */
/* ================================================================== */

class Bullet {
  constructor(x, y, angle, opts) {
    this.x = x; this.y = y;
    this.px = x; this.py = y;
    this.angle = angle;
    this.speed = opts.speed || 1500;
    this.damage = opts.damage || 12;
    this.life = opts.life || 0.55;
    this.owner = opts.owner || null;
    this.fromPlayer = !!opts.fromPlayer;
    this.color = opts.color || '#ffe08a';
    this.removed = false;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.removed = true; return; }
    this.px = this.x; this.py = this.y;
    const step = this.speed * dt;
    this.x += Math.cos(this.angle) * step;
    this.y += Math.sin(this.angle) * step;

    // Buildings.
    const near = G.world.hash.queryRect(
      Math.min(this.px, this.x) - 2, Math.min(this.py, this.y) - 2,
      Math.abs(this.x - this.px) + 4, Math.abs(this.y - this.py) + 4, G._scratchC);
    let bestT = 1, hitRect = null;
    for (let i = 0; i < near.length; i++) {
      const t = segmentRectHit(this.px, this.py, this.x, this.y, near[i]);
      if (t !== null && t < bestT) { bestT = t; hitRect = near[i]; }
    }

    // Pedestrians.
    let bestPed = null, bestPedT = bestT;
    for (let i = 0; i < G.peds.length; i++) {
      const p = G.peds[i];
      if (p.dead || p.removed || p.vehicle) continue;
      if (p === this.owner) continue;
      const t = closestOnSegment(p.x, p.y, this.px, this.py, this.x, this.y);
      const cx = lerp(this.px, this.x, t), cy = lerp(this.py, this.y, t);
      if (dist2(cx, cy, p.x, p.y) < (p.r + 3) * (p.r + 3) && t < bestPedT) {
        bestPedT = t; bestPed = p;
      }
    }

    // Vehicles (and whoever is inside them).
    let bestCar = null, bestCarT = bestPedT;
    for (let i = 0; i < G.vehicles.length; i++) {
      const v = G.vehicles[i];
      if (v.removed) continue;
      if (this.owner && this.owner.vehicle === v) continue;
      const cs = v.circles(G._circA);
      for (let k = 0; k < 2; k++) {
        const c = cs[k];
        const t = closestOnSegment(c.x, c.y, this.px, this.py, this.x, this.y);
        const hx = lerp(this.px, this.x, t), hy = lerp(this.py, this.y, t);
        if (dist2(hx, hy, c.x, c.y) < c.r * c.r && t < bestCarT) {
          bestCarT = t; bestCar = v;
        }
      }
    }

    if (bestCar) {
      const hx = lerp(this.px, this.x, bestCarT), hy = lerp(this.py, this.y, bestCarT);
      bestCar.damage(this.damage * 0.8, 'bullet', this.owner);
      if (bestCar.driver && bestCar.driver !== this.owner && chance(0.3)) {
        bestCar.driver.damage(this.damage * 0.4, 'bullet', this.owner);
      }
      for (let i = 0; i < 3; i++) spawnParticle('spark', hx, hy, rand(-70, 70), rand(-70, 70), rand(0.12, 0.3));
      Audio_.impact();
      this.removed = true;
      return;
    }
    if (bestPed) {
      bestPed.damage(this.damage, 'bullet', this.owner);
      this.removed = true;
      return;
    }
    if (hitRect) {
      const hx = lerp(this.px, this.x, bestT), hy = lerp(this.py, this.y, bestT);
      for (let i = 0; i < 3; i++) {
        spawnParticle('spark', hx, hy, rand(-60, 60), rand(-60, 60), rand(0.1, 0.25));
      }
      spawnDecal('bullethole', hx, hy, 2.4);
      Audio_.impact();
      this.removed = true;
      return;
    }

    // Player takes hits from NPC fire.
    if (!this.fromPlayer && G.player.alive) {
      const p = G.player;
      const pr = p.vehicle ? 0 : p.r + 2;
      if (pr > 0) {
        const t = closestOnSegment(p.x, p.y, this.px, this.py, this.x, this.y);
        const cx = lerp(this.px, this.x, t), cy = lerp(this.py, this.y, t);
        if (dist2(cx, cy, p.x, p.y) < pr * pr) {
          p.damage(this.damage, 'bullet');
          this.removed = true;
        }
      }
    }
  }
}

/* ================================================================== */
/*  Particles, decals, pickups                                         */
/* ================================================================== */

class Particle {
  constructor(type, x, y, vx, vy, life, size) {
    this.type = type;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.size = size || 1;
    this.rot = rand(0, TAU);
    this.removed = false;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.removed = true; return; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const drag = this.type === 'smoke' ? 0.6 : this.type === 'fire' ? 1.2 : 2.4;
    this.vx -= this.vx * drag * dt;
    this.vy -= this.vy * drag * dt;
    if (this.type === 'smoke' || this.type === 'fire') this.vy -= 14 * dt;
  }
}

const PICKUP_DEFS = {
  health: { color: '#2ecc71', label: '+', respawn: 40 },
  armor: { color: '#3498db', label: '◆', respawn: 55 },
  cash: { color: '#f1c40f', label: '$', respawn: 0 },
  pistol: { color: '#bdc3c7', label: 'P', respawn: 35 },
  smg: { color: '#e67e22', label: 'S', respawn: 45 },
  shotgun: { color: '#e74c3c', label: 'G', respawn: 50 },
  rifle: { color: '#9b59b6', label: 'R', respawn: 60 },
};

class Pickup {
  constructor(type, x, y, value) {
    this.type = type;
    this.def = PICKUP_DEFS[type] || PICKUP_DEFS.cash;
    this.x = x; this.y = y;
    this.value = value || 0;
    this.bob = rand(0, TAU);
    this.active = true;
    this.timer = 0;
    this.removed = false;
    this.r = 14;
  }
  update(dt) {
    this.bob += dt * 3;
    if (!this.active) {
      this.timer -= dt;
      if (this.timer <= 0) this.active = true;
      return;
    }
    const p = G.player;
    if (!p.alive) return;
    if (dist2(p.x, p.y, this.x, this.y) < (this.r + 12) * (this.r + 12)) {
      if (this.collect()) {
        if (this.def.respawn > 0) { this.active = false; this.timer = this.def.respawn; }
        else this.removed = true;
      }
    }
  }
  collect() {
    const p = G.player;
    switch (this.type) {
      case 'health':
        if (p.hp >= p.maxHp) return false;
        p.hp = Math.min(p.maxHp, p.hp + 45);
        Notify.show('Health +45', '#2ecc71');
        break;
      case 'armor':
        if (p.armor >= p.maxArmor) return false;
        p.armor = p.maxArmor;
        Notify.show('Body armor', '#3498db');
        break;
      case 'cash':
        G.money += this.value;
        G.stats.earned += this.value;
        Notify.show('+$' + commas(this.value), '#f1c40f');
        Audio_.cash();
        return true;
      default: {
        const w = WEAPONS[this.type];
        if (!w) return false;
        p.giveWeapon(this.type, w.pickupAmmo);
        Notify.show(w.name + ' — ' + w.pickupAmmo + ' rounds', '#ffffff');
        break;
      }
    }
    Audio_.pickup();
    return true;
  }
}

/* ================================================================== */
/*  Spawning helpers                                                   */
/* ================================================================== */

function spawnParticle(type, x, y, vx, vy, life, size) {
  if (G.particles.length > 900) return;
  G.particles.push(new Particle(type, x, y, vx, vy, life, size));
}

function spawnDecal(type, x, y, size) {
  if (G.decals.length > 700) G.decals.shift();
  G.decals.push({ type, x, y, size, life: type === 'tire' ? 26 : 60, maxLife: type === 'tire' ? 26 : 60, rot: rand(0, TAU) });
}

function layTireMark(v) {
  const c = Math.cos(v.angle), s = Math.sin(v.angle);
  const off = v.def.len * 0.24, side = v.def.wid * 0.42;
  spawnDecal('tire', v.x - c * off - s * side, v.y - s * off + c * side, 3);
  spawnDecal('tire', v.x - c * off + s * side, v.y - s * off - c * side, 3);
}

function spawnPickup(type, x, y, value) {
  G.pickups.push(new Pickup(type, x, y, value));
}

function createExplosion(x, y, radius, attacker) {
  Audio_.explosion();
  G.shake = Math.max(G.shake, 22);
  G.flash = Math.max(G.flash, 0.5);
  spawnDecal('scorch', x, y, radius * 0.55);

  for (let i = 0; i < 26; i++) {
    const a = rand(0, TAU), sp = rand(60, 320);
    spawnParticle('fire', x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.75), rand(0.8, 2));
  }
  for (let i = 0; i < 18; i++) {
    const a = rand(0, TAU), sp = rand(30, 140);
    spawnParticle('smoke', x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(1.1, 2.4), rand(1.4, 3));
  }
  for (let i = 0; i < 14; i++) {
    const a = rand(0, TAU), sp = rand(120, 380);
    spawnParticle('debris', x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.5, 1.1));
  }
  G.shockwaves.push({ x, y, r: 6, max: radius * 1.3, life: 0.45, maxLife: 0.45 });

  // Damage falls off with distance.
  for (const v of G.vehicles) {
    const d = dist(x, y, v.x, v.y);
    if (d < radius * 1.4) {
      v.damage((1 - d / (radius * 1.4)) * 110, 'explosion', attacker);
      const a = Math.atan2(v.y - y, v.x - x);
      v.vx += Math.cos(a) * (1 - d / (radius * 1.4)) * 260;
      v.vy += Math.sin(a) * (1 - d / (radius * 1.4)) * 260;
    }
  }
  for (const p of G.peds) {
    if (p.dead || p.vehicle) continue;
    const d = dist(x, y, p.x, p.y);
    if (d < radius * 1.2) p.damage((1 - d / (radius * 1.2)) * 130, 'explosion', attacker);
  }
  const dp = dist(x, y, G.player.x, G.player.y);
  if (dp < radius * 1.2 && G.player.alive && !G.player.vehicle) {
    G.player.damage((1 - dp / (radius * 1.2)) * 90, 'explosion');
  }
  if (attacker === G.player) Wanted.addCrime('explosion', 30);
}

/** Pull an NPC driver out of a car and set them running. */
function ejectDriver(vehicle, panic) {
  const d = vehicle.driver;
  if (!d || d === G.player) return null;
  vehicle.driver = null;
  vehicle.ai = null;
  d.vehicle = null;
  const door = vehicle.doorPoint();
  d.x = door.x; d.y = door.y;
  d.vx = 0; d.vy = 0;
  if (panic) {
    d.state = 'flee';
    d.panicTimer = 14;
  }
  if (G.peds.indexOf(d) === -1) G.peds.push(d);
  return d;
}

function alertNearbyPeds(x, y, radius) {
  const r2 = radius * radius;
  for (const p of G.peds) {
    if (p.dead || p.vehicle) continue;
    if (dist2(p.x, p.y, x, y) < r2) {
      if (p.cop) { p.state = 'chase'; continue; }
      p.state = 'flee';
      p.panicTimer = Math.max(p.panicTimer, rand(5, 10));
      p.target = null;
    }
  }
}
