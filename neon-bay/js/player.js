'use strict';
/* ============================================================
   Neon Bay — player.js
   Weapons, the player character and the on-foot / driving split.
   ============================================================ */

const WEAPONS = {
  fist: {
    name: 'Fists', melee: true, damage: 11, rate: 0.34, range: 26,
    auto: false, ammoPerShot: 0, icon: '✊',
  },
  pistol: {
    name: 'Pistol', damage: 20, rate: 0.26, spread: 0.028, speed: 1700,
    auto: false, pellets: 1, pickupAmmo: 34, sound: 'pistol', icon: '🔫', maxAmmo: 200,
  },
  smg: {
    name: 'Micro SMG', damage: 13, rate: 0.075, spread: 0.085, speed: 1600,
    auto: true, pellets: 1, pickupAmmo: 120, sound: 'smg', icon: '🔫', maxAmmo: 600,
  },
  shotgun: {
    name: 'Shotgun', damage: 12, rate: 0.82, spread: 0.19, speed: 1350,
    auto: false, pellets: 8, pickupAmmo: 24, sound: 'shotgun', icon: '🔫', maxAmmo: 120,
    knockback: 180,
  },
  rifle: {
    name: 'Assault Rifle', damage: 27, rate: 0.13, spread: 0.045, speed: 1900,
    auto: true, pellets: 1, pickupAmmo: 90, sound: 'rifle', icon: '🔫', maxAmmo: 400,
  },
};

const WEAPON_ORDER = ['fist', 'pistol', 'smg', 'shotgun', 'rifle'];

class Player {
  constructor(x, y) {
    this.kind = 'player';
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.angle = -Math.PI / 2;
    this.aim = -Math.PI / 2;
    this.r = 8;
    this.hp = 100; this.maxHp = 100;
    this.armor = 0; this.maxArmor = 100;
    this.alive = true;
    this.vehicle = null;
    this.bob = 0;
    this.speed = 0;
    this.sprinting = false;
    this.walkSpeed = 118;
    this.sprintSpeed = 205;
    this.shirt = '#e8e8ee';
    this.pants = '#2f3542';
    this.skin = '#f2c9a0';
    this.weapon = 'fist';
    this.ammo = { fist: Infinity, pistol: 0, smg: 0, shotgun: 0, rifle: 0 };
    this.owned = { fist: true, pistol: false, smg: false, shotgun: false, rifle: false };
    this.cooldown = 0;
    this.muzzle = 0;
    this.recoil = 0;
    this.enterCooldown = 0;
    this.respawnTimer = 0;
    this.bustTimer = 0;
    this.invuln = 0;
    this.hitFlash = 0;
  }

  giveWeapon(id, ammo) {
    if (!WEAPONS[id]) return;
    this.owned[id] = true;
    const max = WEAPONS[id].maxAmmo || 999;
    this.ammo[id] = Math.min(max, (this.ammo[id] || 0) + ammo);
    this.weapon = id;
  }

  cycleWeapon(dir) {
    const avail = WEAPON_ORDER.filter((w) => this.owned[w] && (w === 'fist' || this.ammo[w] > 0));
    if (avail.length <= 1) return;
    let i = avail.indexOf(this.weapon);
    if (i === -1) i = 0;
    i = (i + dir + avail.length) % avail.length;
    this.weapon = avail[i];
    Audio_.blip();
  }

  selectWeapon(id) {
    if (this.owned[id] && (id === 'fist' || this.ammo[id] > 0)) {
      this.weapon = id;
      Audio_.blip();
    }
  }

  update(dt, input) {
    this.cooldown -= dt;
    this.muzzle = Math.max(0, this.muzzle - dt * 6);
    this.recoil = Math.max(0, this.recoil - dt * 8);
    this.enterCooldown -= dt;
    this.invuln -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);

    if (!this.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) respawnPlayer();
      return;
    }

    this.aim = input.aim;

    if (this.vehicle) this.updateDriving(dt, input);
    else this.updateOnFoot(dt, input);

    if (input.firePressed || (input.fireHeld && WEAPONS[this.weapon].auto)) this.tryFire();
    if (input.enterPressed && this.enterCooldown <= 0) this.tryEnterExit();
  }

  // -------------------------------------------------------- on foot

  updateOnFoot(dt, input) {
    let mx = 0, my = 0;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    if (input.up) my -= 1;
    if (input.down) my += 1;
    if (input.moveX !== undefined) { mx += input.moveX; my += input.moveY; }

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }

    this.sprinting = input.sprint && len > 0.1;
    const target = this.sprinting ? this.sprintSpeed : this.walkSpeed;
    const accel = 1500;

    this.vx = approach(this.vx, mx * target, accel * dt);
    this.vy = approach(this.vy, my * target, accel * dt);
    if (len < 0.05) {
      this.vx = approach(this.vx, 0, accel * 1.4 * dt);
      this.vy = approach(this.vy, 0, accel * 1.4 * dt);
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.speed = Math.hypot(this.vx, this.vy);
    if (this.speed > 6) this.bob += dt * (5 + this.speed * 0.07);
    this.angle = this.aim;

    // Static geometry.
    const near = G.world.hash.queryCircle(this.x, this.y, this.r + 6, G._scratchB);
    for (let i = 0; i < near.length; i++) {
      const hit = circleRectHit(this.x, this.y, this.r, near[i]);
      if (hit) {
        this.x += hit.nx * hit.depth;
        this.y += hit.ny * hit.depth;
        const vn = this.vx * hit.nx + this.vy * hit.ny;
        if (vn < 0) { this.vx -= hit.nx * vn; this.vy -= hit.ny * vn; }
      }
    }

    // Getting run over.
    for (const v of G.vehicles) {
      if (v.removed) continue;
      const cs = v.circles(G._circA);
      for (let k = 0; k < 2; k++) {
        const c = cs[k];
        const d = dist(this.x, this.y, c.x, c.y);
        if (d < c.r + this.r) {
          const push = c.r + this.r - d;
          const a = Math.atan2(this.y - c.y, this.x - c.x);
          this.x += Math.cos(a) * push;
          this.y += Math.sin(a) * push;
          const impact = Math.abs(v.speed);
          if (impact > 90 && this.invuln <= 0) {
            this.damage(impact * 0.16, 'vehicle');
            this.vx += Math.cos(a) * impact * 1.4;
            this.vy += Math.sin(a) * impact * 1.4;
            this.invuln = 0.35;
          }
        }
      }
    }

    // Busted: stand next to a cop while wanted and you go down.
    if (G.wanted.level > 0) {
      let copClose = false;
      for (const p of G.peds) {
        if (p.cop && !p.dead && dist2(p.x, p.y, this.x, this.y) < 34 * 34) { copClose = true; break; }
      }
      if (copClose && this.speed < 90) {
        this.bustTimer += dt;
        if (this.bustTimer > 1.4) bustPlayer();
      } else {
        this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
      }
    } else this.bustTimer = 0;

    G.world.clampToWorld(this, 10);
  }

  // -------------------------------------------------------- driving

  updateDriving(dt, input) {
    const v = this.vehicle;
    let throttle = 0, steer = 0;
    if (input.up) throttle += 1;
    if (input.down) throttle -= 1;
    if (input.left) steer -= 1;
    if (input.right) steer += 1;
    if (input.driveX !== undefined) { steer += input.driveX; throttle -= input.driveY; }

    v.throttle = clamp(throttle, -1, 1);
    v.steer = clamp(steer, -1, 1);
    v.handbrake = !!input.handbrake;

    this.x = v.x; this.y = v.y;
    this.angle = v.angle;
    this.speed = Math.abs(v.speed);

    if (v.dead && v.burning < 1.2 && chance(dt * 2)) {
      Notify.show('GET OUT!', '#ff5252');
    }
  }

  // -------------------------------------------------------- combat

  tryFire() {
    if (!this.alive || this.cooldown > 0) return;
    const w = WEAPONS[this.weapon];

    if (this.vehicle && this.weapon === 'fist') return;
    if (this.vehicle && Math.abs(this.vehicle.speed) > 320) return;

    if (w.melee) {
      this.cooldown = w.rate;
      this.recoil = 1;
      const tx = this.x + Math.cos(this.aim) * w.range * 0.7;
      const ty = this.y + Math.sin(this.aim) * w.range * 0.7;
      let hitSomething = false;
      for (const p of G.peds) {
        if (p.dead || p.vehicle || p.removed) continue;
        if (dist2(p.x, p.y, tx, ty) < (w.range * 0.75) * (w.range * 0.75)) {
          p.damage(w.damage, 'melee', this);
          p.vx += Math.cos(this.aim) * 220;
          p.vy += Math.sin(this.aim) * 220;
          hitSomething = true;
          Wanted.addCrime('assault', 6);
        }
      }
      for (const v of G.vehicles) {
        if (v.removed) continue;
        if (dist2(v.x, v.y, tx, ty) < (v.radius + 12) * (v.radius + 12)) {
          v.damage(3, 'melee', this);
          hitSomething = true;
        }
      }
      if (hitSomething) Audio_.impact(); else Audio_.burst(0.06, 'highpass', 900, 600, 0.06, 1);
      return;
    }

    if ((this.ammo[this.weapon] || 0) <= 0) {
      Audio_.denied();
      this.cooldown = 0.3;
      this.weapon = 'fist';
      Notify.show('Out of ammo', '#ff9f43');
      return;
    }

    this.cooldown = w.rate;
    this.ammo[this.weapon]--;
    this.muzzle = 1;
    this.recoil = 1;
    G.shake = Math.max(G.shake, this.weapon === 'shotgun' ? 6 : 2.5);
    Audio_.gunshot(w.sound);
    G.stats.shots++;

    const originDist = this.vehicle ? this.vehicle.def.wid * 0.6 : 14;
    const ox = this.x + Math.cos(this.aim) * originDist;
    const oy = this.y + Math.sin(this.aim) * originDist;

    for (let i = 0; i < (w.pellets || 1); i++) {
      const a = this.aim + rand(-w.spread, w.spread);
      G.bullets.push(new Bullet(ox, oy, a, {
        speed: w.speed, damage: w.damage, owner: this, fromPlayer: true,
      }));
    }
    for (let i = 0; i < 3; i++) {
      spawnParticle('spark', ox, oy, Math.cos(this.aim) * rand(40, 160), Math.sin(this.aim) * rand(40, 160), rand(0.05, 0.12));
    }
    spawnParticle('smoke', ox, oy, Math.cos(this.aim) * 30, Math.sin(this.aim) * 30, 0.4, 0.4);

    Wanted.witnessGunfire(this.x, this.y);
  }

  // -------------------------------------------------------- vehicles

  tryEnterExit() {
    this.enterCooldown = 0.35;
    if (this.vehicle) {
      const v = this.vehicle;
      if (Math.abs(v.speed) > 130) {
        Notify.show('Too fast to jump out!', '#ff9f43');
        return;
      }
      const door = v.doorPoint();
      this.vehicle = null;
      v.driver = null;
      v.throttle = 0; v.steer = 0; v.handbrake = true;
      this.x = door.x; this.y = door.y;
      this.vx = v.vx * 0.3; this.vy = v.vy * 0.3;
      Audio_.blip();
      G.camZoomTarget = 1;
      return;
    }

    // Nearest vehicle within reach.
    let best = null, bestD = 46 * 46;
    for (const v of G.vehicles) {
      if (v.removed || v.dead) continue;
      const door = v.doorPoint();
      const d = Math.min(dist2(this.x, this.y, door.x, door.y), dist2(this.x, this.y, v.x, v.y) * 0.8);
      if (d < bestD) { bestD = d; best = v; }
    }
    if (!best) return;

    if (best.driver && best.driver !== this) {
      const victim = ejectDriver(best, true);
      if (victim) {
        Notify.show('Carjacked!', '#ff9f43');
        Wanted.addCrime('carjack', best.isPolice ? 26 : 14);
        alertNearbyPeds(this.x, this.y, 200);
        if (victim.cop) victim.state = 'chase';
      }
    } else if (best.isPolice) {
      Wanted.addCrime('stealcop', 12);
    } else {
      Wanted.addCrime('steal', 4);
    }

    best.ai = null;
    best.driver = this;
    best.handbrake = false;
    this.vehicle = best;
    this.x = best.x; this.y = best.y;
    this.vx = 0; this.vy = 0;
    G.stats.carsStolen++;
    Audio_.blip();
    Audio_.resume();
  }

  damage(n, cause) {
    if (!this.alive || this.invuln > 0.2 || G.godMode) return;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, n * 0.75);
      this.armor -= absorbed;
      n -= absorbed;
    }
    this.hp -= n;
    this.hitFlash = 1;
    G.shake = Math.max(G.shake, Math.min(8, n * 0.4));
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(cause);
    }
  }

  die(cause) {
    if (!this.alive) return;
    this.alive = false;
    this.respawnTimer = 3.2;
    G.state = 'wasted';
    G.stats.deaths++;
    Audio_.missionFail();
    if (this.vehicle) {
      this.vehicle.driver = null;
      this.vehicle = null;
    }
    for (let i = 0; i < 14; i++) {
      spawnParticle('blood', this.x, this.y, rand(-100, 100), rand(-100, 100), rand(0.3, 0.8));
    }
    spawnDecal('bloodpool', this.x, this.y, 22);
    Missions.onPlayerDeath();
    void cause;
  }
}
