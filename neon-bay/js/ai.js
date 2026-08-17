'use strict';
/* ============================================================
   Neon Bay — ai.js
   Pedestrian brains, traffic + police driving, the wanted-level
   system and the population manager that keeps the city alive.
   ============================================================ */

function hasLineOfSight(x0, y0, x1, y1) {
  const minX = Math.min(x0, x1), minY = Math.min(y0, y1);
  const near = G.world.hash.queryRect(minX, minY, Math.abs(x1 - x0), Math.abs(y1 - y0), G._scratchC);
  for (let i = 0; i < near.length; i++) {
    if (segmentRectHit(x0, y0, x1, y1, near[i]) !== null) return false;
  }
  return true;
}

/**
 * True when a point is outside the camera's view, so we can spawn traffic and
 * pedestrians close to the player without anything visibly popping in.
 */
function offScreen(x, y, pad) {
  const v = Render.view;
  if (!v.w) return true;
  pad = pad === undefined ? 30 : pad;
  return x < v.x - pad || x > v.x + v.w + pad ||
         y < v.y - pad || y > v.y + v.h + pad;
}

function pointBlocked(x, y, pad) {
  const near = G.world.hash.queryCircle(x, y, pad || 10, G._scratchC);
  for (let i = 0; i < near.length; i++) {
    if (circleRectHit(x, y, pad || 10, near[i])) return true;
  }
  return false;
}

/* ================================================================== */
/*  Pedestrians                                                        */
/* ================================================================== */

const PedAI = {
  update(ped, dt) {
    ped.stateTime += dt;
    if (ped.panicTimer > 0) {
      ped.panicTimer -= dt;
      if (ped.panicTimer <= 0 && ped.state === 'flee') {
        ped.state = 'wander';
        ped.target = null;
      }
    }

    switch (ped.state) {
      case 'flee': this.flee(ped, dt); break;
      case 'chase': this.copChase(ped, dt); break;
      default: this.wander(ped, dt);
    }

    // Everybody scatters from moving traffic.
    if (!ped.cop) {
      for (const v of G.vehicles) {
        if (v.removed || Math.abs(v.speed) < 60) continue;
        const d2v = dist2(v.x, v.y, ped.x, ped.y);
        if (d2v < 120 * 120) {
          const a = Math.atan2(ped.y - v.y, ped.x - v.x);
          ped.vx += Math.cos(a) * 240 * dt;
          ped.vy += Math.sin(a) * 240 * dt;
          if (ped.state !== 'flee' && d2v < 80 * 80) {
            ped.state = 'flee';
            ped.panicTimer = Math.max(ped.panicTimer, 3);
          }
        }
      }
    }
  },

  pickWanderTarget(ped) {
    for (let i = 0; i < 10; i++) {
      const a = rand(0, TAU), d = rand(80, 260);
      const x = clamp(ped.x + Math.cos(a) * d, 20, G.world.size - 20);
      const y = clamp(ped.y + Math.sin(a) * d, 20, G.world.size - 20);
      if (pointBlocked(x, y, 12)) continue;
      // Prefer sidewalks over the middle of the road.
      if (G.world.isOnRoad(x, y) && i < 6) continue;
      ped.target = { x, y };
      return;
    }
    ped.target = { x: ped.x + rand(-60, 60), y: ped.y + rand(-60, 60) };
  },

  wander(ped, dt) {
    if (!ped.target || dist2(ped.x, ped.y, ped.target.x, ped.target.y) < 20 * 20 || ped.stateTime > 12) {
      this.pickWanderTarget(ped);
      ped.stateTime = 0;
    }
    this.steerTo(ped, ped.target.x, ped.target.y, ped.walkSpeed, dt);
  },

  flee(ped, dt) {
    const threat = G.player;
    const a = Math.atan2(ped.y - threat.y, ped.x - threat.x) + rand(-0.4, 0.4);
    const tx = ped.x + Math.cos(a) * 200;
    const ty = ped.y + Math.sin(a) * 200;
    this.steerTo(ped, tx, ty, ped.runSpeed, dt);
    if (chance(dt * 0.6)) ped.bob += 0.4;
  },

  copChase(ped, dt) {
    const p = G.player;
    const d = dist(ped.x, ped.y, p.x, p.y);

    if (d > 900) { ped.state = 'wander'; return; }

    const los = hasLineOfSight(ped.x, ped.y, p.x, p.y);
    ped.fireCooldown -= dt;

    if (d > 170 || !los) {
      this.steerTo(ped, p.x, p.y, ped.runSpeed, dt);
    } else {
      // Hold position and shoot.
      this.steerTo(ped, p.x, p.y, ped.walkSpeed * 0.4, dt);
      if (d < 90) {
        const a = Math.atan2(ped.y - p.y, ped.x - p.x);
        ped.vx += Math.cos(a) * 120 * dt;
        ped.vy += Math.sin(a) * 120 * dt;
      }
    }

    if (los && d < 340 && ped.fireCooldown <= 0 && G.wanted.level > 0) {
      ped.fireCooldown = rand(0.55, 1.25) / (1 + G.wanted.level * 0.12);
      ped.angle = Math.atan2(p.y - ped.y, p.x - ped.x);
      const spread = 0.12 - G.wanted.level * 0.012;
      const a = ped.angle + rand(-spread, spread);
      G.bullets.push(new Bullet(
        ped.x + Math.cos(a) * 12, ped.y + Math.sin(a) * 12, a,
        { speed: 1500, damage: 9 + G.wanted.level * 1.6, owner: ped, color: '#9ad0ff' }
      ));
      Audio_.gunshot('pistol');
      spawnParticle('spark', ped.x + Math.cos(a) * 14, ped.y + Math.sin(a) * 14, Math.cos(a) * 90, Math.sin(a) * 90, 0.08);
    }
  },

  steerTo(ped, tx, ty, speed, dt) {
    const a = Math.atan2(ty - ped.y, tx - ped.x);
    const desiredX = Math.cos(a) * speed;
    const desiredY = Math.sin(a) * speed;
    const accel = 900;
    ped.vx = approach(ped.vx, desiredX, accel * dt);
    ped.vy = approach(ped.vy, desiredY, accel * dt);
  },
};

/* ================================================================== */
/*  Vehicle AI                                                         */
/* ================================================================== */

const VehicleAI = {
  update(v, dt) {
    const ai = v.ai;
    if (!ai || v.dead) {
      if (v.dead) { v.throttle = 0; v.steer = 0; }
      return;
    }

    ai.timer = (ai.timer || 0) + dt;

    // Reverse out of whatever we are wedged against.
    if (ai.reversing > 0) {
      ai.reversing -= dt;
      v.throttle = -1;
      v.steer = ai.reverseSteer;
      return;
    }
    if (Math.abs(v.speed) < 14 && v.throttle > 0.2) {
      ai.stuckTime = (ai.stuckTime || 0) + dt;
      if (ai.stuckTime > 1.1) {
        ai.reversing = rand(0.5, 1.1);
        ai.reverseSteer = chance(0.5) ? -1 : 1;
        ai.stuckTime = 0;
      }
    } else ai.stuckTime = 0;

    switch (ai.mode) {
      case 'police': this.police(v, dt); break;
      case 'flee': this.flee(v, dt); break;
      case 'parked': v.throttle = 0; v.steer = 0; v.handbrake = true; break;
      case 'chase': this.chaseTarget(v, dt); break;
      default: this.traffic(v, dt);
    }
  },

  /** Steering + throttle toward a world point. Returns the angle error. */
  driveTo(v, tx, ty, targetSpeed, dt) {
    const desired = Math.atan2(ty - v.y, tx - v.x);
    const err = angleDelta(v.angle, desired);
    v.steer = clamp(err * 2.1, -1, 1);

    // Slow down for tight corners.
    const corner = 1 - clamp(Math.abs(err) / 1.5, 0, 0.72);
    const goal = targetSpeed * corner;

    if (v.speed < goal) v.throttle = 1;
    else if (v.speed > goal * 1.12) v.throttle = -0.55;
    else v.throttle = 0.15;

    // Sharp reverse-angle target: back up instead of grinding forward.
    if (Math.abs(err) > 2.4 && Math.abs(v.speed) < 40) {
      v.throttle = -0.8;
      v.steer = -v.steer;
    }
    void dt;
    return err;
  },

  /** Look for something directly in front of us. */
  pathBlocked(v, lookAhead) {
    const c = Math.cos(v.angle), s = Math.sin(v.angle);
    const fx = v.x + c * lookAhead, fy = v.y + s * lookAhead;
    for (const o of G.vehicles) {
      if (o === v || o.removed) continue;
      const d = dist2(o.x, o.y, fx, fy);
      if (d < (o.radius + v.def.wid * 0.6) * (o.radius + v.def.wid * 0.6)) return true;
    }
    if (!v.isPolice) {
      for (const p of G.peds) {
        if (p.dead || p.vehicle) continue;
        if (dist2(p.x, p.y, fx, fy) < 26 * 26) return true;
      }
      const pl = G.player;
      if (pl.alive && !pl.vehicle && dist2(pl.x, pl.y, fx, fy) < 26 * 26) return true;
    }
    return false;
  },

  traffic(v, dt) {
    const ai = v.ai;
    if (!ai.node) {
      ai.node = nearestLaneNode(G.world, v.x, v.y, v.angle) || choice(G.world.lanes.usable);
    }
    let node = ai.node;
    if (dist2(v.x, v.y, node.x, node.y) < 46 * 46) {
      const nexts = node.next;
      if (nexts && nexts.length) {
        node = G.world.lanes.nodes[choice(nexts)];
        ai.node = node;
      } else {
        ai.node = nearestLaneNode(G.world, v.x, v.y, v.angle);
        node = ai.node || node;
      }
    }

    const cruise = ai.cruise || (ai.cruise = rand(105, 155));
    this.driveTo(v, node.x, node.y, cruise, dt);

    const look = 34 + Math.abs(v.speed) * 0.42;
    if (this.pathBlocked(v, look)) {
      v.throttle = -1;
      v.handbrake = Math.abs(v.speed) > 60;
    } else {
      v.handbrake = false;
    }
  },

  flee(v, dt) {
    const ai = v.ai;
    const p = G.player;
    // Run along the lane graph, but always pick the branch heading away.
    if (!ai.node) ai.node = nearestLaneNode(G.world, v.x, v.y, v.angle);
    let node = ai.node;
    if (!node) { this.traffic(v, dt); return; }
    if (dist2(v.x, v.y, node.x, node.y) < 52 * 52) {
      let best = null, bestScore = -Infinity;
      for (const idx of node.next) {
        const n = G.world.lanes.nodes[idx];
        const score = dist2(n.x, n.y, p.x, p.y);
        if (score > bestScore) { bestScore = score; best = n; }
      }
      ai.node = best || node;
      node = ai.node;
    }
    this.driveTo(v, node.x, node.y, v.def.top * 0.75, dt);
    if (this.pathBlocked(v, 30 + Math.abs(v.speed) * 0.3)) v.throttle = -0.6;

    ai.fleeTime = (ai.fleeTime || 0) + dt;
    if (ai.fleeTime > 26 && dist2(v.x, v.y, p.x, p.y) > 900 * 900) {
      ai.mode = 'traffic';
      ai.fleeTime = 0;
    }
  },

  chaseTarget(v, dt) {
    const t = v.ai.target;
    if (!t || t.removed) { v.ai.mode = 'traffic'; return; }
    this.driveTo(v, t.x, t.y, v.def.top * 0.85, dt);
  },

  police(v, dt) {
    const p = G.player;
    const ai = v.ai;
    const targetX = p.x, targetY = p.y;
    const d = dist(v.x, v.y, targetX, targetY);

    v.sirenOn = G.wanted.level > 0;

    if (G.wanted.level === 0) {
      ai.mode = 'traffic';
      v.sirenOn = false;
      return;
    }

    // Far away: use the road network so they arrive like traffic would.
    if (d > 520) {
      if (!ai.node || dist2(v.x, v.y, ai.node.x, ai.node.y) < 60 * 60) {
        const cur = ai.node || nearestLaneNode(G.world, v.x, v.y, v.angle);
        if (cur && cur.next.length) {
          let best = null, bestScore = Infinity;
          for (const idx of cur.next) {
            const n = G.world.lanes.nodes[idx];
            const s = dist2(n.x, n.y, targetX, targetY);
            if (s < bestScore) { bestScore = s; best = n; }
          }
          ai.node = best;
        } else {
          ai.node = nearestLaneNode(G.world, v.x, v.y, v.angle);
        }
      }
      const n = ai.node;
      this.driveTo(v, n ? n.x : targetX, n ? n.y : targetY, v.def.top * 0.8, dt);
      if (this.pathBlocked(v, 40 + Math.abs(v.speed) * 0.35)) v.throttle = -0.5;
    } else {
      // Close: drive straight at the player and ram.
      ai.node = null;
      const lead = p.vehicle ? 0.35 : 0;
      const tx = targetX + (p.vehicle ? p.vehicle.vx * lead : 0);
      const ty = targetY + (p.vehicle ? p.vehicle.vy * lead : 0);
      this.driveTo(v, tx, ty, v.def.top * (G.wanted.level >= 3 ? 0.95 : 0.8), dt);
      if (d < 70 && !p.vehicle) {
        // Cops bail out to arrest a player on foot.
        ai.dismountTimer = (ai.dismountTimer || 0) + dt;
        v.throttle = -1;
        if (ai.dismountTimer > 0.8 && Math.abs(v.speed) < 40 && v.driver) {
          const cop = ejectDriver(v, false);
          if (cop) { cop.state = 'chase'; cop.cop = true; }
          v.ai.mode = 'parked';
        }
      } else {
        ai.dismountTimer = 0;
      }
    }

    // Drive-by fire from the passenger seat once things get serious.
    if (G.wanted.level >= 3 && d < 320 && v.driver) {
      ai.fire = (ai.fire || 0) - dt;
      if (ai.fire <= 0 && hasLineOfSight(v.x, v.y, p.x, p.y)) {
        ai.fire = rand(0.5, 1.1);
        const a = Math.atan2(p.y - v.y, p.x - v.x) + rand(-0.1, 0.1);
        G.bullets.push(new Bullet(v.x + Math.cos(a) * 26, v.y + Math.sin(a) * 26, a, {
          speed: 1550, damage: 10, owner: v.driver, color: '#9ad0ff',
        }));
        Audio_.gunshot('smg');
      }
    }
  },
};

/* ================================================================== */
/*  Wanted level                                                       */
/* ================================================================== */

const WANTED_THRESHOLDS = [0, 18, 55, 125, 225, 355];

const Wanted = {
  level: 0,
  heat: 0,
  cooldown: 0,
  copCarTimer: 0,
  copFootTimer: 0,

  reset() {
    this.level = 0;
    this.heat = 0;
    this.cooldown = 0;
    for (const v of G.vehicles) {
      if (v.isPolice && v.ai && v.ai.mode === 'police') { v.ai.mode = 'traffic'; v.sirenOn = false; }
    }
    for (const p of G.peds) if (p.cop && p.state === 'chase') p.state = 'wander';
  },

  addCrime(type, points) {
    if (G.state !== 'play') return;
    const before = this.level;
    this.heat += points;
    this.cooldown = 9 + this.level * 3;
    this.recompute();
    if (this.level > before) {
      Audio_.wantedUp();
      Notify.show('WANTED LEVEL ' + this.level, '#ff4d6d');
      G.stats.maxWanted = Math.max(G.stats.maxWanted, this.level);
    }
    void type;
  },

  recompute() {
    let lvl = 0;
    for (let i = 1; i < WANTED_THRESHOLDS.length; i++) {
      if (this.heat >= WANTED_THRESHOLDS[i]) lvl = i;
    }
    this.level = lvl;
  },

  witnessGunfire(x, y) {
    let witnesses = 0;
    for (const p of G.peds) {
      if (p.dead) continue;
      if (dist2(p.x, p.y, x, y) < 320 * 320) {
        witnesses += p.cop ? 3 : 1;
        if (p.cop) p.state = 'chase';
        else if (chance(0.7)) { p.state = 'flee'; p.panicTimer = Math.max(p.panicTimer, 6); }
      }
    }
    if (witnesses > 0) this.addCrime('gunfire', Math.min(10, 2 + witnesses));
  },

  update(dt) {
    if (this.level > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        // Losing them takes longer at higher stars.
        this.heat -= dt * (7 - this.level * 0.8);
        if (this.heat <= 0) {
          this.heat = 0;
          if (this.level > 0) Notify.show('You lost the cops', '#7bed9f');
          this.reset();
        } else {
          const before = this.level;
          this.recompute();
          if (this.level < before) Notify.show('WANTED LEVEL ' + this.level, '#ffa502');
        }
      }
      this.spawnPolice(dt);
    } else {
      this.heat = Math.max(0, this.heat - dt * 4);
    }
  },

  spawnPolice(dt) {
    const p = G.player;
    const wantCars = Math.min(9, this.level * 1.6);
    const wantFoot = this.level >= 2 ? Math.min(10, (this.level - 1) * 2.5) : 0;

    let cars = 0, foot = 0;
    for (const v of G.vehicles) if (v.isPolice && v.ai && v.ai.mode === 'police' && !v.dead) cars++;
    for (const pe of G.peds) if (pe.cop && !pe.dead && pe.state === 'chase') foot++;

    this.copCarTimer -= dt;
    if (cars < wantCars && this.copCarTimer <= 0) {
      this.copCarTimer = Math.max(0.7, 3.2 - this.level * 0.45);
      const spot = this.findSpawnLane(p, 620, 1150);
      if (spot) {
        const v = spawnVehicle('police', spot.x, spot.y, spot.angle, '#f4f6ff');
        v.ai = { mode: 'police', node: spot.node };
        v.sirenOn = true;
        const cop = new Ped(spot.x, spot.y, { cop: true, hp: 62, shirt: '#1f3a68', pants: '#22262e' });
        cop.vehicle = v;
        v.driver = cop;
        G.peds.push(cop);
      }
    }

    this.copFootTimer -= dt;
    if (foot < wantFoot && this.copFootTimer <= 0) {
      this.copFootTimer = Math.max(1.2, 4 - this.level * 0.5);
      for (let i = 0; i < 14; i++) {
        const a = rand(0, TAU), d = rand(430, 620);
        const x = clamp(p.x + Math.cos(a) * d, 30, G.world.size - 30);
        const y = clamp(p.y + Math.sin(a) * d, 30, G.world.size - 30);
        if (pointBlocked(x, y, 12)) continue;
        const cop = new Ped(x, y, { cop: true, hp: 58, shirt: '#1f3a68', pants: '#22262e' });
        cop.state = 'chase';
        G.peds.push(cop);
        break;
      }
    }
  },

  findSpawnLane(p, minD, maxD) {
    const nodes = G.world.lanes.usable;
    for (let i = 0; i < 60; i++) {
      const n = choice(nodes);
      const d = dist(n.x, n.y, p.x, p.y);
      if (d < minD || d > maxD) continue;
      let occupied = false;
      for (const v of G.vehicles) {
        if (dist2(v.x, v.y, n.x, n.y) < 70 * 70) { occupied = true; break; }
      }
      if (occupied) continue;
      const dir = DIRS[n.d];
      return { x: n.x, y: n.y, angle: Math.atan2(dir.dy, dir.dx), node: n };
    }
    return null;
  },
};

/* ================================================================== */
/*  Population                                                         */
/* ================================================================== */

function spawnVehicle(type, x, y, angle, color) {
  const v = new Vehicle(type, x, y, angle, color);
  G.vehicles.push(v);
  return v;
}

function spawnTrafficCar(x, y, angle, node) {
  const type = choice(CIVILIAN_TYPES);
  const v = spawnVehicle(type, x, y, angle);
  v.ai = { mode: 'traffic', node, cruise: rand(100, 160) };
  const driver = new Ped(x, y, {});
  driver.vehicle = v;
  v.driver = driver;
  G.peds.push(driver);
  return v;
}

const Population = {
  maxPeds: 74,
  maxCars: 34,
  timer: 0,

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.35;

    const p = G.player;
    const cullDist = 1750;

    // Cull anything that has drifted far away.
    for (const v of G.vehicles) {
      if (v.persistent || v.driver === G.player || v.removed) continue;
      if (dist2(v.x, v.y, p.x, p.y) > cullDist * cullDist) {
        if (v.driver) { v.driver.removed = true; v.driver = null; }
        v.removed = true;
      }
    }
    for (const pe of G.peds) {
      if (pe.persistent || pe.vehicle || pe.removed) continue;
      if (dist2(pe.x, pe.y, p.x, p.y) > cullDist * cullDist) pe.removed = true;
    }

    // Top up traffic. The bigger the shortfall the faster we refill, so the
    // streets recover quickly after a respawn or a long drive.
    let cars = 0;
    for (const v of G.vehicles) if (!v.removed && v.driver !== G.player) cars++;
    let carBudget = Math.min(4, Math.ceil((this.maxCars - cars) / 4));
    while (cars < this.maxCars && carBudget-- > 0) {
      const spot = this.findRoadSpawn(p, 380, 1350);
      if (!spot) break;
      spawnTrafficCar(spot.x, spot.y, spot.angle, spot.node);
      cars++;
    }

    // Top up pedestrians.
    let peds = 0;
    for (const pe of G.peds) if (!pe.removed && !pe.vehicle && !pe.dead) peds++;
    let pedBudget = Math.min(6, Math.ceil((this.maxPeds - peds) / 4));
    while (peds < this.maxPeds && pedBudget > 0) {
      const spot = this.findFootSpawn(p, 210, 900);
      if (!spot) break;
      G.peds.push(new Ped(spot.x, spot.y, {}));
      peds++;
      pedBudget--;
    }
  },

  findFootSpawn(p, minD, maxD, requireOffScreen) {
    for (let i = 0; i < 18; i++) {
      const a = rand(0, TAU), d = rand(minD, maxD);
      const x = clamp(p.x + Math.cos(a) * d, 20, G.world.size - 20);
      const y = clamp(p.y + Math.sin(a) * d, 20, G.world.size - 20);
      if (requireOffScreen !== false && !offScreen(x, y)) continue;
      if (pointBlocked(x, y, 12)) continue;
      if (G.world.isOnRoad(x, y) && chance(0.75)) continue;
      return { x, y };
    }
    return null;
  },

  findRoadSpawn(p, minD, maxD) {
    const nodes = G.world.lanes.usable;
    for (let i = 0; i < 50; i++) {
      const n = choice(nodes);
      const d = dist(n.x, n.y, p.x, p.y);
      if (d < minD || d > maxD) continue;
      if (!offScreen(n.x, n.y, 60)) continue;
      let occupied = false;
      for (const v of G.vehicles) {
        if (dist2(v.x, v.y, n.x, n.y) < 90 * 90) { occupied = true; break; }
      }
      if (occupied) continue;
      const dir = DIRS[n.d];
      return { x: n.x, y: n.y, angle: Math.atan2(dir.dy, dir.dx), node: n };
    }
    return null;
  },

  /** Fill the streets around the player before the first frame. */
  seed() {
    const p = G.player;
    for (let i = 0; i < 26; i++) {
      const spot = this.findRoadSpawn(p, 220, 1200);
      if (spot) spawnTrafficCar(spot.x, spot.y, spot.angle, spot.node);
    }
    for (let i = 0; i < 60; i++) {
      const a = rand(0, TAU), d = rand(90, 900);
      const x = clamp(p.x + Math.cos(a) * d, 20, G.world.size - 20);
      const y = clamp(p.y + Math.sin(a) * d, 20, G.world.size - 20);
      if (pointBlocked(x, y, 12)) continue;
      G.peds.push(new Ped(x, y, {}));
    }
    // Parked cars in lots and driveways.
    for (const spot of G.world.parkingSpots) {
      if (!chance(0.75)) continue;
      const v = spawnVehicle(choice(CIVILIAN_TYPES), spot.x, spot.y, spot.angle + (chance(0.5) ? 0 : Math.PI));
      v.ai = { mode: 'parked' };
      v.handbrake = true;
    }
  },
};
