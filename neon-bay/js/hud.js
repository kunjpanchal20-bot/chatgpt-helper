'use strict';
/* ============================================================
   Neon Bay — hud.js
   Radar, status bars, notifications and the full-screen map.
   ============================================================ */

const Notify = {
  items: [],
  big: null,

  show(text, color) {
    this.items.push({ text, color: color || '#ffffff', life: 3.4, max: 3.4 });
    if (this.items.length > 6) this.items.shift();
  },

  showBig(title, sub) {
    this.big = { title, sub: sub || '', life: 3.2, max: 3.2 };
  },

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      this.items[i].life -= dt;
      if (this.items[i].life <= 0) this.items.splice(i, 1);
    }
    if (this.big) {
      this.big.life -= dt;
      if (this.big.life <= 0) this.big = null;
    }
  },
};

const MAP_SCALE = 0.22;

const HUD = {
  mapCanvas: null,
  radarZoom: 0.19,
  showFullMap: false,

  /** Render the static city map once; the radar just samples from it. */
  buildMap(world) {
    const s = MAP_SCALE;
    const c = document.createElement('canvas');
    c.width = Math.ceil(world.size * s);
    c.height = Math.ceil(world.size * s);
    const g = c.getContext('2d');

    g.fillStyle = '#191a22';
    g.fillRect(0, 0, c.width, c.height);

    // Roads are the gaps between blocks, so paint blocks over the asphalt.
    for (const b of world.blocks) {
      g.fillStyle = b.mapColor || '#2e3040';
      g.fillRect(b.x * s, b.y * s, b.w * s, b.h * s);
    }

    // Building footprints give the map some texture.
    g.fillStyle = '#3c4055';
    for (const b of world.buildings) {
      g.fillRect(b.x * s, b.y * s, Math.max(1, b.w * s), Math.max(1, b.h * s));
    }

    // Grid lines to sell the "city map" look.
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1;
    for (let i = 0; i <= CITY.GRID; i++) {
      const p = (i * CITY.PITCH + CITY.ROAD / 2) * s;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, c.height); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(c.width, p); g.stroke();
    }

    this.mapCanvas = c;
  },

  draw(ctx, W, H) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textBaseline = 'alphabetic';

    if (this.showFullMap) {
      this.drawFullMap(ctx, W, H);
      return;
    }

    this.drawRadar(ctx, W, H);
    this.drawStatus(ctx, W, H);
    this.drawObjective(ctx, W, H);
    this.drawNotifications(ctx, W, H);
    this.drawPrompts(ctx, W, H);
    if (G.player.vehicle) this.drawSpeedo(ctx, W, H);
    this.drawOverlays(ctx, W, H);
  },

  // ---------------------------------------------------------- radar

  drawRadar(ctx, W, H) {
    const R = Math.min(112, W * 0.13);
    const cx = 22 + R, cy = H - 22 - R;
    const p = G.player;
    const z = this.radarZoom;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.closePath();
    ctx.save();
    ctx.clip();

    ctx.fillStyle = '#0d0f16';
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    if (this.mapCanvas) {
      const scale = z / MAP_SCALE;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-p.x * MAP_SCALE, -p.y * MAP_SCALE);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.mapCanvas, 0, 0);
      ctx.restore();
    }

    const toRadar = (x, y) => ({ x: cx + (x - p.x) * z, y: cy + (y - p.y) * z });

    // Mission markers.
    for (const m of G.markers) {
      const q = toRadar(m.x, m.y);
      const d = dist(q.x, q.y, cx, cy);
      let px = q.x, py = q.y, edge = false;
      if (d > R - 8) {
        const a = Math.atan2(q.y - cy, q.x - cx);
        px = cx + Math.cos(a) * (R - 8);
        py = cy + Math.sin(a) * (R - 8);
        edge = true;
      }
      ctx.fillStyle = m.color;
      ctx.beginPath();
      if (edge) {
        const a = Math.atan2(py - cy, px - cx);
        ctx.moveTo(px + Math.cos(a) * 6, py + Math.sin(a) * 6);
        ctx.lineTo(px + Math.cos(a + 2.4) * 6, py + Math.sin(a + 2.4) * 6);
        ctx.lineTo(px + Math.cos(a - 2.4) * 6, py + Math.sin(a - 2.4) * 6);
      } else {
        ctx.arc(px, py, 5, 0, TAU);
      }
      ctx.fill();
    }

    // Police.
    const flash = Math.sin(G.time * 9) > 0;
    for (const v of G.vehicles) {
      if (!v.isPolice || v.dead) continue;
      const q = toRadar(v.x, v.y);
      if (dist(q.x, q.y, cx, cy) > R) continue;
      ctx.fillStyle = flash ? '#4d7cff' : '#ff4d6d';
      ctx.fillRect(q.x - 2.5, q.y - 2.5, 5, 5);
    }
    for (const pe of G.peds) {
      if (!pe.cop || pe.dead || pe.vehicle) continue;
      const q = toRadar(pe.x, pe.y);
      if (dist(q.x, q.y, cx, cy) > R) continue;
      ctx.fillStyle = flash ? '#4d7cff' : '#ff4d6d';
      ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
    }

    // Pickups.
    for (const pk of G.pickups) {
      if (!pk.active) continue;
      const q = toRadar(pk.x, pk.y);
      if (dist(q.x, q.y, cx, cy) > R) continue;
      ctx.fillStyle = pk.def.color;
      ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    }

    // Player arrow.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p.vehicle ? p.vehicle.angle : p.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, -5.5);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-5, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore(); // clip

    // Bezel.
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 3.5, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, cy - R + 12);
    ctx.restore();
  },

  // ---------------------------------------------------------- status

  drawStatus(ctx, W, H) {
    const p = G.player;
    const x = W - 22;
    let y = 34;

    ctx.textAlign = 'right';

    // Money.
    ctx.font = 'bold 30px "Courier New", monospace';
    ctx.fillStyle = '#7bed9f';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6;
    ctx.fillText('$' + commas(G.money), x, y);
    ctx.shadowBlur = 0;
    y += 30;

    // Wanted stars.
    const lvl = G.wanted.level;
    ctx.font = '22px system-ui, sans-serif';
    for (let i = 0; i < 5; i++) {
      const on = i < lvl;
      const blink = on && G.wanted.cooldown <= 0 && Math.sin(G.time * 8) > 0;
      ctx.fillStyle = on ? (blink ? 'rgba(255,255,255,0.35)' : '#ffd166') : 'rgba(255,255,255,0.14)';
      ctx.fillText('★', x - i * 24, y);
    }
    y += 30;

    // Clock.
    const hours = Math.floor(G.clock) % 24;
    const mins = Math.floor((G.clock % 1) * 60);
    ctx.font = 'bold 15px "Courier New", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(
      (hours < 10 ? '0' : '') + hours + ':' + (mins < 10 ? '0' : '') + mins,
      x, y
    );
    y += 24;

    // Weapon + ammo.
    const w = WEAPONS[p.weapon];
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    const ammoText = w.melee ? '' : '  ' + (p.ammo[p.weapon] === Infinity ? '∞' : p.ammo[p.weapon]);
    ctx.fillText(w.name + ammoText, x, y);

    // Health + armor bars, bottom-left of the status stack.
    const bw = 190, bh = 13;
    const bx = W - 22 - bw, by = y + 14;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, bx - 3, by - 3, bw + 6, bh + 6, 4); ctx.fill();
    ctx.fillStyle = '#2f3542';
    roundRect(ctx, bx, by, bw, bh, 3); ctx.fill();
    const hpFrac = clamp(p.hp / p.maxHp, 0, 1);
    ctx.fillStyle = hpFrac > 0.5 ? '#2ecc71' : hpFrac > 0.22 ? '#f1c40f' : '#e74c3c';
    roundRect(ctx, bx, by, bw * hpFrac, bh, 3); ctx.fill();

    if (p.armor > 0) {
      const ay = by + bh + 5;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, bx - 3, ay - 3, bw + 6, bh + 6, 4); ctx.fill();
      ctx.fillStyle = '#2f3542';
      roundRect(ctx, bx, ay, bw, bh, 3); ctx.fill();
      ctx.fillStyle = '#3498db';
      roundRect(ctx, bx, ay, bw * clamp(p.armor / p.maxArmor, 0, 1), bh, 3); ctx.fill();
    }

    ctx.textAlign = 'left';
  },

  drawObjective(ctx, W) {
    const M = Missions;
    const text = M.objective;
    if (!text) return;

    ctx.textAlign = 'center';
    ctx.font = 'bold 16px system-ui, sans-serif';
    const cx = W / 2;
    const metrics = ctx.measureText(text);
    const pad = 16;
    const bw = metrics.width + pad * 2;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, cx - bw / 2, 14, bw, 34, 8);
    ctx.fill();
    ctx.fillStyle = M.active ? '#ffd166' : 'rgba(255,255,255,0.85)';
    ctx.fillText(text, cx, 37);

    if (M.useTimer) {
      const t = Math.max(0, M.timeLeft);
      ctx.font = 'bold 24px "Courier New", monospace';
      ctx.fillStyle = t < 20 ? '#ff4d6d' : '#ffffff';
      ctx.fillText(formatTime(t), cx, 78);
    }
    ctx.textAlign = 'left';
  },

  drawNotifications(ctx, W, H) {
    ctx.textAlign = 'center';
    let y = H - 130;
    for (let i = Notify.items.length - 1; i >= 0; i--) {
      const n = Notify.items[i];
      const a = clamp(n.life / 0.6, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const tw = ctx.measureText(n.text).width;
      roundRect(ctx, W / 2 - tw / 2 - 12, y - 19, tw + 24, 28, 6);
      ctx.fill();
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, W / 2, y);
      y -= 34;
    }
    ctx.globalAlpha = 1;

    if (Notify.big) {
      const b = Notify.big;
      const a = clamp(b.life / 0.8, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = 'bold 52px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(b.title, W / 2 + 3, H * 0.36 + 3);
      ctx.fillStyle = '#ffd166';
      ctx.fillText(b.title, W / 2, H * 0.36);
      if (b.sub) {
        ctx.font = 'bold 22px system-ui, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(b.sub, W / 2, H * 0.36 + 38);
      }
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  },

  drawPrompts(ctx, W, H) {
    const prompts = [];
    if (G.jobPrompt) prompts.push('[H] Start job: ' + G.jobPrompt.title);
    if (!G.player.vehicle && G.nearVehicle) prompts.push('[F] Enter vehicle');
    if (G.player.vehicle && !Missions.active && !Missions.sideJob) {
      if (G.player.vehicle.type === 'taxi') prompts.push('[H] Start taxi shift');
      else if (G.player.vehicle.isPolice) prompts.push('[H] Start vigilante duty');
    }
    if (Missions.sideJob) prompts.push('[H] End shift');
    if (!prompts.length) return;

    ctx.textAlign = 'center';
    let y = H - 62;
    for (const t of prompts) {
      ctx.font = 'bold 15px system-ui, sans-serif';
      const tw = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      roundRect(ctx, W / 2 - tw / 2 - 12, y - 18, tw + 24, 26, 6);
      ctx.fill();
      ctx.fillStyle = '#22d3ee';
      ctx.fillText(t, W / 2, y);
      y -= 30;
    }
    ctx.textAlign = 'left';
  },

  drawSpeedo(ctx, W, H) {
    const v = G.player.vehicle;
    const cx = W - 90, cy = H - 80, r = 54;
    const mph = Math.abs(v.speed) * 0.36;
    const frac = clamp(Math.abs(v.speed) / v.def.top, 0, 1.1);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
    ctx.stroke();

    const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0, '#22d3ee');
    grad.addColorStop(0.6, '#ffd166');
    grad.addColorStop(1, '#ff3d81');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * frac);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.fillText(Math.round(mph), cx, cy + 6);
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('MPH', cx, cy + 22);

    // Vehicle condition.
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    roundRect(ctx, cx - 40, cy + 32, 80, 6, 3); ctx.fill();
    const hf = clamp(v.hp / v.maxHp, 0, 1);
    ctx.fillStyle = hf > 0.5 ? '#7bed9f' : hf > 0.25 ? '#ffd166' : '#ff4d6d';
    roundRect(ctx, cx - 40, cy + 32, 80 * hf, 6, 3); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'left';
  },

  drawOverlays(ctx, W, H) {
    if (G.state === 'wasted' || G.state === 'busted') {
      const busted = G.state === 'busted';
      ctx.fillStyle = busted ? 'rgba(20,40,90,0.55)' : 'rgba(90,10,20,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.font = 'bold 78px system-ui, sans-serif';
      ctx.fillStyle = busted ? '#9ad0ff' : '#ff4d6d';
      ctx.fillText(busted ? 'BUSTED' : 'WASTED', W / 2, H / 2);
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(busted ? 'The cops took everything you were carrying' : 'You woke up at the clinic — minus a fee', W / 2, H / 2 + 40);
      ctx.textAlign = 'left';
    }
  },

  // ---------------------------------------------------------- full map

  drawFullMap(ctx, W, H) {
    ctx.fillStyle = 'rgba(6,8,14,0.94)';
    ctx.fillRect(0, 0, W, H);

    const size = Math.min(W - 120, H - 120);
    const ox = (W - size) / 2, oy = (H - size) / 2;
    const s = size / G.world.size;

    if (this.mapCanvas) {
      ctx.drawImage(this.mapCanvas, ox, oy, size, size);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox, oy, size, size);

    const p = G.player;
    for (const m of G.markers) {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(ox + m.x * s, oy + m.y * s, 7, 0, TAU);
      ctx.fill();
      if (m.label) {
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(m.label, ox + m.x * s, oy + m.y * s - 12);
      }
    }
    for (const v of G.vehicles) {
      if (!v.isPolice || v.dead) continue;
      ctx.fillStyle = '#4d7cff';
      ctx.fillRect(ox + v.x * s - 2, oy + v.y * s - 2, 4, 4);
    }

    ctx.save();
    ctx.translate(ox + p.x * s, oy + p.y * s);
    ctx.rotate(p.vehicle ? p.vehicle.angle : p.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(11, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = '#ffd166';
    ctx.fillText('NEON BAY', W / 2, oy - 26);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText('[M] close map', W / 2, oy + size + 30);
    ctx.textAlign = 'left';
  },
};
