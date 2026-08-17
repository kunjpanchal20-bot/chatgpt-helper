'use strict';
/* ============================================================
   Neon Bay — missions.js
   Story jobs, side hustles and the marker system they run on.
   ============================================================ */

const Missions = {
  index: 0,
  active: null,
  objective: '',
  timeLeft: 0,
  useTimer: false,
  startMarker: null,
  sideJob: null,

  // ---------------------------------------------------------- markers

  addMarker(opts) {
    const m = Object.assign({
      x: 0, y: 0, r: 26, color: '#ffd166', label: '', type: 'goto',
      pulse: 0, onEnter: null, requireCar: false, requireFoot: false, blip: true,
    }, opts);
    G.markers.push(m);
    return m;
  },

  // ---------------------------------------------------------- flow

  init() {
    this.placeNextStartMarker();
  },

  placeNextStartMarker() {
    G.markers.length = 0;
    this.startMarker = null;
    const def = STORY[this.index];
    if (!def) {
      // All jobs done — free roam.
      this.objective = 'Free roam — the city is yours';
      return;
    }
    const pos = def.startPos(G.world);
    this.startMarker = this.addMarker({
      x: pos.x, y: pos.y, r: 30, color: '#ffd166', type: 'job',
      label: def.title, blip: true,
    });
    this.objective = 'Go to the job marker (' + def.title + ')';
  },

  start(def) {
    this.active = {
      def,
      state: {},
      elapsed: 0,
    };
    this.useTimer = false;
    this.timeLeft = 0;
    G.markers.length = 0;
    this.startMarker = null;
    G.state = 'play';
    Audio_.missionStart();
    Notify.showBig(def.title, def.tagline || '');
    def.onStart(this.active.state, this);
  },

  setObjective(text) { this.objective = text; },

  setTimer(seconds) {
    this.useTimer = true;
    this.timeLeft = seconds;
  },

  complete() {
    const def = this.active.def;
    G.money += def.reward;
    G.stats.earned += def.reward;
    G.stats.missions++;
    Audio_.missionDone();
    Notify.showBig('MISSION PASSED', '+$' + commas(def.reward));
    if (def.onEnd) def.onEnd(this.active.state, this, true);
    this.active = null;
    this.useTimer = false;
    this.index = Math.min(STORY.length, this.index + 1);
    this.cleanupMissionEntities();
    this.placeNextStartMarker();
    saveGame();
  },

  fail(reason) {
    if (!this.active) return;
    const def = this.active.def;
    Audio_.missionFail();
    Notify.showBig('MISSION FAILED', reason || '');
    if (def.onEnd) def.onEnd(this.active.state, this, false);
    this.active = null;
    this.useTimer = false;
    this.cleanupMissionEntities();
    this.placeNextStartMarker();
  },

  cleanupMissionEntities() {
    for (const v of G.vehicles) {
      if (v.mission) { v.persistent = false; v.mission = false; if (v.driver !== G.player) v.removed = true; }
    }
    for (const p of G.peds) {
      if (p.mission) { p.persistent = false; p.mission = false; p.removed = true; }
    }
  },

  onPlayerDeath() {
    if (this.active) this.fail('You were wasted');
    if (this.sideJob) this.endSideJob('Wasted');
  },

  onBusted() {
    if (this.active) this.fail('You were busted');
    if (this.sideJob) this.endSideJob('Busted');
  },

  // ---------------------------------------------------------- side jobs

  toggleSideJob() {
    const p = G.player;
    if (this.sideJob) { this.endSideJob('Shift over'); return; }
    if (this.active) { Notify.show('Finish your current job first', '#ff9f43'); return; }
    if (!p.vehicle) { Notify.show('Get in a taxi or a cop car first', '#ff9f43'); return; }

    if (p.vehicle.type === 'taxi') this.startTaxi();
    else if (p.vehicle.isPolice) this.startVigilante();
    else Notify.show('No side work in this vehicle', '#ff9f43');
  },

  startTaxi() {
    this.sideJob = { type: 'taxi', stage: 'pickup', fares: 0, payout: 0 };
    Audio_.missionStart();
    Notify.showBig('TAXI DRIVER', 'Pick up a fare');
    this.nextFare();
  },

  nextFare() {
    const job = this.sideJob;
    const p = G.player;
    let spot = null;
    for (let i = 0; i < 60; i++) {
      const a = rand(0, TAU), d = rand(280, 900);
      const x = clamp(p.x + Math.cos(a) * d, 40, G.world.size - 40);
      const y = clamp(p.y + Math.sin(a) * d, 40, G.world.size - 40);
      if (!pointBlocked(x, y, 22) && G.world.isOnRoad(x, y)) { spot = { x, y }; break; }
    }
    if (!spot) spot = { x: p.x + 200, y: p.y + 200 };
    job.stage = 'pickup';
    G.markers.length = 0;
    this.addMarker({ x: spot.x, y: spot.y, r: 34, color: '#f1c40f', type: 'goto', label: 'Fare' });
    this.setObjective('Taxi: pick up the fare');
  },

  startVigilante() {
    this.sideJob = { type: 'vigilante', busts: 0 };
    Audio_.missionStart();
    Notify.showBig('VIGILANTE', 'Take down the suspect');
    this.nextSuspect();
  },

  nextSuspect() {
    const p = G.player;
    const spot = Population.findRoadSpawn(p, 350, 900);
    if (!spot) { this.endSideJob('No suspects nearby'); return; }
    const v = spawnVehicle(choice(['muscle', 'sports', 'compact']), spot.x, spot.y, spot.angle, '#2f3640');
    v.ai = { mode: 'flee', node: spot.node };
    v.persistent = true;
    v.mission = true;
    const driver = new Ped(spot.x, spot.y, { shirt: '#2f3640' });
    driver.vehicle = v; driver.mission = true; driver.persistent = true;
    v.driver = driver;
    G.peds.push(driver);
    this.sideJob.target = v;
    G.markers.length = 0;
    this.setObjective('Vigilante: wreck the suspect vehicle');
  },

  endSideJob(reason) {
    if (!this.sideJob) return;
    const job = this.sideJob;
    this.sideJob = null;
    G.markers.length = 0;
    this.cleanupMissionEntities();
    Notify.show((job.type === 'taxi' ? 'Taxi shift ended' : 'Vigilante ended') + (reason ? ' — ' + reason : ''), '#ffa502');
    this.placeNextStartMarker();
  },

  updateSideJob(dt) {
    const job = this.sideJob;
    const p = G.player;
    if (job.type === 'taxi') {
      if (!p.vehicle || p.vehicle.type !== 'taxi') { this.endSideJob('Left the taxi'); return; }
      const m = G.markers[0];
      if (!m) return;
      if (dist2(p.x, p.y, m.x, m.y) < (m.r + 20) * (m.r + 20) && Math.abs(p.vehicle.speed) < 60) {
        if (job.stage === 'pickup') {
          job.stage = 'dropoff';
          Audio_.pickup();
          Notify.show('Fare picked up — drive them home', '#f1c40f');
          let spot = null;
          for (let i = 0; i < 60; i++) {
            const a = rand(0, TAU), d = rand(500, 1400);
            const x = clamp(p.x + Math.cos(a) * d, 40, G.world.size - 40);
            const y = clamp(p.y + Math.sin(a) * d, 40, G.world.size - 40);
            if (!pointBlocked(x, y, 22) && G.world.isOnRoad(x, y)) { spot = { x, y }; break; }
          }
          spot = spot || { x: p.x + 400, y: p.y };
          job.dropDist = dist(p.x, p.y, spot.x, spot.y);
          G.markers.length = 0;
          this.addMarker({ x: spot.x, y: spot.y, r: 34, color: '#2ecc71', type: 'goto', label: 'Drop off' });
          this.setObjective('Taxi: drop the fare off');
        } else {
          const pay = Math.round(40 + (job.dropDist || 400) * 0.22);
          G.money += pay;
          G.stats.earned += pay;
          job.fares++;
          Audio_.cash();
          Notify.show('Fare complete +$' + commas(pay), '#2ecc71');
          this.nextFare();
        }
      }
    } else if (job.type === 'vigilante') {
      if (!p.vehicle || !p.vehicle.isPolice) { this.endSideJob('Left the cruiser'); return; }
      const t = job.target;
      if (!t || t.removed || t.dead) {
        job.busts++;
        const pay = 350 + job.busts * 120;
        G.money += pay;
        G.stats.earned += pay;
        Audio_.cash();
        Notify.show('Suspect down +$' + commas(pay), '#2ecc71');
        this.nextSuspect();
      } else {
        this.setObjective('Vigilante: wreck the suspect (' + Math.round(dist(p.x, p.y, t.x, t.y)) + 'm)');
      }
    }
    void dt;
  },

  // ---------------------------------------------------------- tick

  update(dt) {
    // Marker triggers.
    const p = G.player;
    for (let i = G.markers.length - 1; i >= 0; i--) {
      const m = G.markers[i];
      m.pulse += dt;
      if (!m.onEnter) continue;
      if (m.requireCar && !p.vehicle) continue;
      if (m.requireFoot && p.vehicle) continue;
      if (dist2(p.x, p.y, m.x, m.y) < (m.r + 14) * (m.r + 14)) {
        m.onEnter(m);
      }
    }

    const pressed = G.input.jobPressed;

    if (this.active) {
      this.active.elapsed += dt;
      if (this.useTimer) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) { this.fail('Out of time'); return; }
      }
      const def = this.active.def;
      if (def.onUpdate) def.onUpdate(this.active.state, this, dt);
      return;
    }

    if (this.sideJob) {
      if (pressed) { this.endSideJob('Shift over'); return; }
      this.updateSideJob(dt);
      return;
    }

    // No job running: H either starts the story job you are standing on, or
    // clocks in for side work in whatever you are driving.
    let onStartMarker = false;
    if (this.startMarker) {
      const m = this.startMarker;
      onStartMarker = dist2(p.x, p.y, m.x, m.y) < (m.r + 16) * (m.r + 16);
      G.jobPrompt = onStartMarker ? STORY[this.index] : null;
    } else {
      G.jobPrompt = null;
    }

    if (pressed) {
      if (onStartMarker) this.start(STORY[this.index]);
      else this.toggleSideJob();
    }
  },
};

/* ================================================================== */
/*  Story                                                              */
/* ================================================================== */

/** Somewhere drivable near a block, used to place mission targets. */
function randomStreetPoint(minFrom, fromX, fromY) {
  for (let i = 0; i < 120; i++) {
    const n = choice(G.world.lanes.usable);
    if (minFrom && dist2(n.x, n.y, fromX, fromY) < minFrom * minFrom) continue;
    return { x: n.x, y: n.y };
  }
  const n = choice(G.world.lanes.usable);
  return { x: n.x, y: n.y };
}

function safehousePos(world) {
  const lm = world.landmarks.find((l) => l.type === 'safehouse');
  return lm ? { x: lm.x, y: lm.y } : { x: world.size / 2, y: world.size / 2 };
}

const STORY = [
  // ---------------------------------------------------------------- 1
  {
    id: 'first-gear',
    title: 'First Gear',
    tagline: 'Grab a ride and get moving',
    reward: 600,
    startPos: (w) => {
      const s = safehousePos(w);
      return { x: s.x + 120, y: s.y - 90 };
    },
    onStart(st, M) {
      const drop = randomStreetPoint(900, G.player.x, G.player.y);
      st.drop = M.addMarker({ x: drop.x, y: drop.y, r: 34, color: '#2ecc71', type: 'goto', label: 'Drop' });
      M.setObjective('Steal any car and drive it to the drop');
      M.setTimer(160);
    },
    onUpdate(st, M) {
      const p = G.player;
      if (!p.vehicle) {
        M.setObjective('Get in a car');
        return;
      }
      M.setObjective('Deliver the car — ' + Math.round(dist(p.x, p.y, st.drop.x, st.drop.y)) + 'm');
      if (dist2(p.x, p.y, st.drop.x, st.drop.y) < (st.drop.r + 18) * (st.drop.r + 18) && Math.abs(p.vehicle.speed) < 70) {
        M.complete();
      }
    },
  },

  // ---------------------------------------------------------------- 2
  {
    id: 'package-run',
    title: 'Package Run',
    tagline: 'Five drops, one clock',
    reward: 1200,
    startPos: (w) => {
      const s = safehousePos(w);
      return { x: s.x - 200, y: s.y - 220 };
    },
    onStart(st, M) {
      st.left = 5;
      st.markers = [];
      for (let i = 0; i < 5; i++) {
        const pt = randomStreetPoint(300, G.player.x, G.player.y);
        const m = M.addMarker({
          x: pt.x, y: pt.y, r: 24, color: '#22d3ee', type: 'package', label: 'Package',
        });
        m.onEnter = (mk) => {
          const idx = G.markers.indexOf(mk);
          if (idx >= 0) G.markers.splice(idx, 1);
          st.left--;
          Audio_.pickup();
          G.money += 60;
          Notify.show('Package collected (' + (5 - st.left) + '/5)', '#22d3ee');
          if (st.left <= 0) M.complete();
        };
        st.markers.push(m);
      }
      M.setTimer(190);
      M.setObjective('Collect 5 packages');
    },
    onUpdate(st, M) {
      M.setObjective('Collect the packages — ' + st.left + ' left');
    },
  },

  // ---------------------------------------------------------------- 3
  {
    id: 'hot-property',
    title: 'Hot Property',
    tagline: 'The boss wants that car. Today.',
    reward: 1800,
    startPos: (w) => ({ x: w.roadCenter(3) + 40, y: w.roadCenter(8) - 40 }),
    onStart(st, M) {
      const spot = Population.findRoadSpawn(G.player, 420, 900) || { x: G.player.x + 400, y: G.player.y, angle: 0 };
      const v = spawnVehicle('sports', spot.x, spot.y, spot.angle, '#ff3d81');
      v.ai = { mode: 'parked' };
      v.persistent = true;
      v.mission = true;
      v.handbrake = true;
      st.car = v;
      st.marker = M.addMarker({ x: v.x, y: v.y, r: 26, color: '#ff3d81', type: 'car', label: 'Target car' });
      st.phase = 'steal';
      M.setObjective('Steal the pink sports car');
      M.setTimer(240);
    },
    onUpdate(st, M) {
      const p = G.player;
      if (st.car.removed || st.car.dead) { M.fail('The car was destroyed'); return; }

      if (st.phase === 'steal') {
        st.marker.x = st.car.x; st.marker.y = st.car.y;
        if (p.vehicle === st.car) {
          st.phase = 'deliver';
          const home = safehousePos(G.world);
          G.markers.length = 0;
          st.marker = M.addMarker({ x: home.x, y: home.y, r: 36, color: '#2ecc71', type: 'goto', label: 'Garage' });
          Wanted.addCrime('mission', 60);
          Notify.show('Alarm tripped — lose the cops and get to the garage', '#ff9f43');
        }
      } else {
        if (p.vehicle !== st.car) {
          M.setObjective('Get back in the target car');
          return;
        }
        M.setObjective('Deliver to the garage — ' + Math.round(dist(p.x, p.y, st.marker.x, st.marker.y)) + 'm');
        if (dist2(p.x, p.y, st.marker.x, st.marker.y) < (st.marker.r + 16) * (st.marker.r + 16) && Math.abs(p.vehicle.speed) < 60) {
          if (G.wanted.level > 0) {
            M.setObjective('Lose the cops before delivering!');
            return;
          }
          M.complete();
        }
      }
    },
  },

  // ---------------------------------------------------------------- 4
  {
    id: 'scrap-metal',
    title: 'Scrap Metal',
    tagline: 'Four cars. No witnesses. Well — some witnesses.',
    reward: 2400,
    startPos: (w) => ({ x: w.roadCenter(8) - 40, y: w.roadCenter(4) + 40 }),
    onStart(st, M) {
      st.targets = [];
      for (let i = 0; i < 4; i++) {
        const spot = Population.findRoadSpawn(G.player, 260, 800);
        if (!spot) continue;
        const v = spawnVehicle(choice(['van', 'muscle', 'sedan', 'truck']), spot.x, spot.y, spot.angle, '#4b6584');
        v.ai = { mode: 'flee', node: spot.node };
        v.persistent = true;
        v.mission = true;
        const d = new Ped(spot.x, spot.y, {});
        d.vehicle = v; d.mission = true; d.persistent = true;
        v.driver = d;
        G.peds.push(d);
        const mk = M.addMarker({ x: v.x, y: v.y, r: 20, color: '#ff4d6d', type: 'car', label: 'Target' });
        st.targets.push({ v, mk });
      }
      M.setTimer(210);
      M.setObjective('Destroy 4 target vehicles');
    },
    onUpdate(st, M) {
      let left = 0;
      for (const t of st.targets) {
        if (t.v.removed || t.v.dead) {
          if (t.mk) {
            const i = G.markers.indexOf(t.mk);
            if (i >= 0) G.markers.splice(i, 1);
            t.mk = null;
            Notify.show('Target destroyed', '#ff4d6d');
          }
          continue;
        }
        left++;
        if (t.mk) { t.mk.x = t.v.x; t.mk.y = t.v.y; }
      }
      M.setObjective('Destroy the targets — ' + left + ' left');
      if (left === 0) M.complete();
    },
  },

  // ---------------------------------------------------------------- 5
  {
    id: 'heat',
    title: 'Heat',
    tagline: 'Survive three stars for 90 seconds',
    reward: 3000,
    startPos: (w) => ({ x: w.roadCenter(6) + 40, y: w.roadCenter(9) - 40 }),
    onStart(st, M) {
      Wanted.heat = WANTED_THRESHOLDS[3] + 12;
      Wanted.recompute();
      Wanted.cooldown = 30;
      st.survived = 0;
      M.setObjective('Survive 90s');
      Notify.show('Cops incoming!', '#ff4d6d');
    },
    onUpdate(st, M, dt) {
      st.survived += dt;
      if (G.wanted.level < 3 && st.survived < 90) {
        // Keep the pressure on for the duration.
        Wanted.heat = Math.max(Wanted.heat, WANTED_THRESHOLDS[3] + 4);
        Wanted.recompute();
        Wanted.cooldown = Math.max(Wanted.cooldown, 6);
      }
      M.setObjective('Survive — ' + Math.max(0, Math.ceil(90 - st.survived)) + 's');
      if (st.survived >= 90) {
        Wanted.cooldown = 0;
        M.complete();
      }
    },
  },

  // ---------------------------------------------------------------- 6
  {
    id: 'the-pickup',
    title: 'The Pickup',
    tagline: 'Collect the contact, get them to the pier',
    reward: 3600,
    startPos: (w) => ({ x: w.roadCenter(2) + 40, y: w.roadCenter(2) + 40 }),
    onStart(st, M) {
      const pt = randomStreetPoint(500, G.player.x, G.player.y);
      const ped = new Ped(pt.x + 30, pt.y + 20, { shirt: '#111827', pants: '#111827' });
      ped.mission = true; ped.persistent = true; ped.state = 'wander';
      G.peds.push(ped);
      st.contact = ped;
      st.phase = 'fetch';
      st.marker = M.addMarker({ x: ped.x, y: ped.y, r: 28, color: '#a78bfa', type: 'ped', label: 'Contact' });
      M.setObjective('Pick up the contact (bring a car)');
      M.setTimer(230);
    },
    onUpdate(st, M) {
      const p = G.player;
      if (st.contact.dead) { M.fail('The contact is dead'); return; }

      if (st.phase === 'fetch') {
        st.marker.x = st.contact.x; st.marker.y = st.contact.y;
        if (p.vehicle && dist2(p.x, p.y, st.contact.x, st.contact.y) < 60 * 60 && Math.abs(p.vehicle.speed) < 60) {
          st.phase = 'drive';
          st.contact.removed = true;
          Audio_.pickup();
          const beachY = G.world.size - CITY.BLOCK * 0.5;
          G.markers.length = 0;
          st.marker = M.addMarker({ x: G.world.roadCenter(6), y: beachY, r: 38, color: '#2ecc71', type: 'goto', label: 'Pier' });
          Notify.show('Get them to the pier', '#a78bfa');
          Wanted.addCrime('mission', 30);
        }
      } else {
        if (!p.vehicle) { M.setObjective('Get back in the car'); return; }
        M.setObjective('Drive to the pier — ' + Math.round(dist(p.x, p.y, st.marker.x, st.marker.y)) + 'm');
        if (dist2(p.x, p.y, st.marker.x, st.marker.y) < (st.marker.r + 20) * (st.marker.r + 20)) M.complete();
      }
    },
  },

  // ---------------------------------------------------------------- 7
  {
    id: 'shot-caller',
    title: 'Shot Caller',
    tagline: 'Six rivals, one afternoon',
    reward: 4200,
    startPos: (w) => ({ x: w.roadCenter(9) - 40, y: w.roadCenter(9) - 40 }),
    onStart(st, M) {
      st.targets = [];
      const centre = randomStreetPoint(300, G.player.x, G.player.y);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        let x = centre.x + Math.cos(a) * rand(60, 200);
        let y = centre.y + Math.sin(a) * rand(60, 200);
        if (pointBlocked(x, y, 12)) { x = centre.x; y = centre.y; }
        const ped = new Ped(x, y, { shirt: '#7f1d1d', pants: '#111827', hp: 60 });
        ped.mission = true; ped.persistent = true; ped.armed = 'pistol';
        ped.cop = false;
        ped.state = 'wander';
        ped.hostile = true;
        G.peds.push(ped);
        const mk = M.addMarker({ x, y, r: 18, color: '#ff4d6d', type: 'ped', label: '' });
        st.targets.push({ ped, mk });
      }
      // Give the player something to work with.
      if (!G.player.owned.smg) G.player.giveWeapon('smg', 90);
      else G.player.giveWeapon(G.player.weapon === 'fist' ? 'smg' : G.player.weapon, 60);
      M.setTimer(240);
      M.setObjective('Take out 6 rivals');
    },
    onUpdate(st, M) {
      let left = 0;
      for (const t of st.targets) {
        if (t.ped.dead || t.ped.removed) {
          if (t.mk) {
            const i = G.markers.indexOf(t.mk);
            if (i >= 0) G.markers.splice(i, 1);
            t.mk = null;
          }
          continue;
        }
        left++;
        t.mk.x = t.ped.x; t.mk.y = t.ped.y;
        // Rivals shoot back once they see you.
        const d = dist(t.ped.x, t.ped.y, G.player.x, G.player.y);
        if (d < 300 && hasLineOfSight(t.ped.x, t.ped.y, G.player.x, G.player.y)) {
          t.ped.state = 'chase';
          t.ped.cop = true;              // reuse the "engage the player" brain
        }
      }
      M.setObjective('Rivals remaining: ' + left);
      if (left === 0) M.complete();
    },
    onEnd(st) {
      for (const t of st.targets) if (t.ped) { t.ped.persistent = false; t.ped.mission = false; }
    },
  },

  // ---------------------------------------------------------------- 8
  {
    id: 'last-exit',
    title: 'Last Exit',
    tagline: 'Run down the informant, then disappear',
    reward: 12000,
    startPos: (w) => {
      const s = safehousePos(w);
      return { x: s.x - 120, y: s.y + 40 };
    },
    onStart(st, M) {
      const spot = Population.findRoadSpawn(G.player, 300, 700) || { x: G.player.x + 300, y: G.player.y, angle: 0 };
      const v = spawnVehicle('sports', spot.x, spot.y, spot.angle, '#1b1b22');
      v.ai = { mode: 'flee', node: spot.node };
      v.persistent = true; v.mission = true;
      v.hp = v.maxHp = 220;
      const d = new Ped(spot.x, spot.y, { shirt: '#111827' });
      d.vehicle = v; d.mission = true; d.persistent = true;
      v.driver = d;
      G.peds.push(d);
      st.target = v;
      st.phase = 'chase';
      st.marker = M.addMarker({ x: v.x, y: v.y, r: 22, color: '#ff4d6d', type: 'car', label: 'Informant' });
      M.setObjective('Wreck the informant\'s car');
      Notify.show('He is running — do not let him leave the bay', '#ff4d6d');
    },
    onUpdate(st, M) {
      const p = G.player;
      if (st.phase === 'chase') {
        if (st.target.removed || st.target.dead) {
          st.phase = 'escape';
          Wanted.heat = WANTED_THRESHOLDS[4] + 20;
          Wanted.recompute();
          Wanted.cooldown = 20;
          const home = safehousePos(G.world);
          G.markers.length = 0;
          st.marker = M.addMarker({ x: home.x, y: home.y, r: 40, color: '#2ecc71', type: 'goto', label: 'Safehouse' });
          Notify.showBig('NOW LOSE THEM', 'Get back to the safehouse');
          return;
        }
        st.marker.x = st.target.x; st.marker.y = st.target.y;
        M.setObjective('Wreck the informant — ' + Math.round(dist(p.x, p.y, st.target.x, st.target.y)) + 'm');
      } else {
        M.setObjective(G.wanted.level > 0
          ? 'Lose the cops, then reach the safehouse'
          : 'Get to the safehouse');
        if (dist2(p.x, p.y, st.marker.x, st.marker.y) < (st.marker.r + 18) * (st.marker.r + 18)) {
          if (G.wanted.level > 0) {
            M.setObjective('Too hot — lose the cops first!');
            return;
          }
          M.complete();
        }
      }
    },
  },
];
