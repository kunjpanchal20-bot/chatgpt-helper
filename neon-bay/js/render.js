'use strict';
/* ============================================================
   Neon Bay — render.js
   Top-down world rendering with camera-relative extrusion, so
   buildings lean away from the middle of the screen and the
   city reads as 3D without a 3D engine.
   ============================================================ */

// Virtual camera height. Lower = more dramatic lean on tall buildings.
const CAM_H = 620;

const Render = {
  view: { x: 0, y: 0, w: 0, h: 0 },

  /** Project a ground point up to `h` units, away from the camera. */
  projX(x, h, cam) { return cam.x + (x - cam.x) * (1 + h / CAM_H); },
  projY(y, h, cam) { return cam.y + (y - cam.y) * (1 + h / CAM_H); },

  draw(ctx, W, H) {
    const cam = G.cam;
    const zoom = cam.zoom;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0f1a';
    ctx.fillRect(0, 0, W, H);

    const shakeX = G.shake > 0 ? rand(-G.shake, G.shake) : 0;
    const shakeY = G.shake > 0 ? rand(-G.shake, G.shake) : 0;

    ctx.setTransform(zoom, 0, 0, zoom,
      -cam.x * zoom + W / 2 + shakeX,
      -cam.y * zoom + H / 2 + shakeY);

    const vw = W / zoom, vh = H / zoom;
    const view = this.view;
    view.x = cam.x - vw / 2 - 60;
    view.y = cam.y - vh / 2 - 60;
    view.w = vw + 120;
    view.h = vh + 120;

    const night = G.nightAmount;

    this.drawGround(ctx, view, night);
    this.drawGroundDecals(ctx, view);
    this.drawMarkers(ctx, view);
    this.drawPickups(ctx, view);
    this.drawEntities(ctx, view, night);
    this.drawStructures(ctx, view, cam, night);
    this.drawOccludedPlayer(ctx, cam);
    this.drawParticles(ctx, view);
    if (night > 0.02) this.drawNight(ctx, view, night, W, H, zoom, cam, shakeX, shakeY);
    this.drawFlash(ctx, W, H, zoom, cam, shakeX, shakeY);
  },

  // ------------------------------------------------------------ ground

  drawGround(ctx, view, night) {
    const w = G.world;
    const size = w.size;

    // Asphalt everywhere, then everything else painted on top.
    ctx.fillStyle = PALETTE.road;
    ctx.fillRect(view.x, view.y, view.w, view.h);

    // Ocean past the southern edge.
    if (view.y + view.h > size) {
      const g = ctx.createLinearGradient(0, size, 0, size + 900);
      g.addColorStop(0, '#1c5570');
      g.addColorStop(0.3, PALETTE.water);
      g.addColorStop(1, '#07202f');
      ctx.fillStyle = g;
      ctx.fillRect(view.x, size, view.w, view.h + 900);
      // Lazy surf lines.
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const y = size + 22 + i * 46 + Math.sin(G.time * 0.6 + i) * 5;
        ctx.beginPath();
        for (let x = view.x; x < view.x + view.w; x += 44) {
          ctx.lineTo(x, y + Math.sin(x * 0.013 + G.time * 0.9 + i) * 6);
        }
        ctx.stroke();
      }
    }

    // Outside the map: dark void so the edge reads as intentional.
    ctx.fillStyle = '#080b12';
    if (view.x < 0) ctx.fillRect(view.x, view.y, -view.x, view.h);
    if (view.x + view.w > size) ctx.fillRect(size, view.y, view.x + view.w - size, view.h);
    if (view.y < 0) ctx.fillRect(view.x, view.y, view.w, -view.y);

    // Lane markings.
    this.drawRoadMarkings(ctx, view);

    // Blocks: sidewalk slab under everything the block contains.
    ctx.fillStyle = PALETTE.sidewalk;
    for (const b of w.blocks) {
      if (b.x + b.w < view.x || b.x > view.x + view.w || b.y + b.h < view.y || b.y > view.y + view.h) continue;
      ctx.fillRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
      // Kerb highlight.
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(b.x - 2, b.y - 2, b.w + 4, 3);
      ctx.fillStyle = PALETTE.sidewalk;
    }

    // Static decals (grass, sand, lots, plazas, paths).
    for (const d of w.decals) {
      if (d.x + d.w < view.x || d.x > view.x + view.w || d.y + d.h < view.y || d.y > view.y + view.h) continue;
      switch (d.type) {
        case 'grass':
          ctx.fillStyle = PALETTE.grass;
          ctx.fillRect(d.x, d.y, d.w, d.h);
          break;
        case 'sand':
          ctx.fillStyle = PALETTE.sand;
          ctx.fillRect(d.x, d.y, d.w, d.h);
          break;
        case 'path':
          ctx.fillStyle = '#6b6250';
          ctx.fillRect(d.x, d.y, d.w, d.h);
          break;
        case 'pond':
          ctx.fillStyle = '#1f5c78';
          ctx.beginPath();
          ctx.ellipse(d.x + d.w / 2, d.y + d.h / 2, d.w / 2, d.h / 2, 0, 0, TAU);
          ctx.fill();
          break;
        case 'lot':
          ctx.fillStyle = PALETTE.lot;
          ctx.fillRect(d.x, d.y, d.w, d.h);
          break;
        case 'plaza':
          ctx.fillStyle = '#4a4438';
          ctx.fillRect(d.x, d.y, d.w, d.h);
          ctx.strokeStyle = 'rgba(0,0,0,0.18)';
          ctx.lineWidth = 1;
          for (let x = d.x; x < d.x + d.w; x += 30) {
            ctx.beginPath(); ctx.moveTo(x, d.y); ctx.lineTo(x, d.y + d.h); ctx.stroke();
          }
          for (let y = d.y; y < d.y + d.h; y += 30) {
            ctx.beginPath(); ctx.moveTo(d.x, y); ctx.lineTo(d.x + d.w, y); ctx.stroke();
          }
          break;
        case 'stall':
          ctx.strokeStyle = 'rgba(255,255,255,0.20)';
          ctx.lineWidth = 2;
          ctx.strokeRect(d.x, d.y, d.w, d.h);
          break;
        case 'garage':
          ctx.fillStyle = '#3b3450';
          ctx.fillRect(d.x, d.y, d.w, d.h);
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 3;
          ctx.setLineDash([10, 8]);
          ctx.strokeRect(d.x + 4, d.y + 4, d.w - 8, d.h - 8);
          ctx.setLineDash([]);
          break;
        case 'fountainbase':
          ctx.fillStyle = '#5d5647';
          ctx.beginPath();
          ctx.ellipse(d.x + d.w / 2, d.y + d.h / 2, d.w / 2, d.h / 2, 0, 0, TAU);
          ctx.fill();
          break;
        case 'umbrella':
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.beginPath();
          ctx.ellipse(d.x + 4, d.y + 4, 15, 12, 0, 0, TAU);
          ctx.fill();
          break;
        default: break;
      }
    }
    void night;
  },

  drawRoadMarkings(ctx, view) {
    const P = CITY.PITCH, R = CITY.ROAD, N = CITY.GRID;
    const i0 = Math.max(0, Math.floor(view.x / P) - 1);
    const i1 = Math.min(N, Math.ceil((view.x + view.w) / P));
    const j0 = Math.max(0, Math.floor(view.y / P) - 1);
    const j1 = Math.min(N, Math.ceil((view.y + view.h) / P));

    ctx.strokeStyle = PALETTE.roadLine;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([18, 22]);
    ctx.globalAlpha = 0.55;

    for (let i = i0; i <= i1; i++) {
      const cx = i * P + R / 2;
      ctx.beginPath();
      ctx.moveTo(cx, Math.max(0, view.y));
      ctx.lineTo(cx, Math.min(G.world.size, view.y + view.h));
      ctx.stroke();
    }
    for (let j = j0; j <= j1; j++) {
      const cy = j * P + R / 2;
      ctx.beginPath();
      ctx.moveTo(Math.max(0, view.x), cy);
      ctx.lineTo(Math.min(G.world.size, view.x + view.w), cy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Crosswalks on the approach to each intersection.
    ctx.fillStyle = 'rgba(230,230,230,0.30)';
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = i * P, y = j * P;
        for (let s = 0; s < 5; s++) {
          const o = 8 + s * 17;
          ctx.fillRect(x + o, y - 12, 11, 10);
          ctx.fillRect(x + o, y + R + 2, 11, 10);
          ctx.fillRect(x - 12, y + o, 10, 11);
          ctx.fillRect(x + R + 2, y + o, 10, 11);
        }
      }
    }
  },

  drawGroundDecals(ctx, view) {
    for (const d of G.decals) {
      if (d.x < view.x || d.x > view.x + view.w || d.y < view.y || d.y > view.y + view.h) continue;
      const a = clamp(d.life / d.maxLife, 0, 1);
      switch (d.type) {
        case 'tire':
          ctx.fillStyle = 'rgba(12,12,16,' + (0.5 * a) + ')';
          ctx.fillRect(d.x - 2, d.y - 2, 4, 4);
          break;
        case 'bloodpool':
          ctx.fillStyle = 'rgba(120,10,18,' + (0.65 * a) + ')';
          ctx.beginPath();
          ctx.ellipse(d.x, d.y, d.size, d.size * 0.72, d.rot, 0, TAU);
          ctx.fill();
          break;
        case 'scorch':
          ctx.fillStyle = 'rgba(10,8,8,' + (0.62 * a) + ')';
          ctx.beginPath();
          ctx.ellipse(d.x, d.y, d.size, d.size * 0.86, d.rot, 0, TAU);
          ctx.fill();
          break;
        case 'bullethole':
          ctx.fillStyle = 'rgba(0,0,0,' + (0.55 * a) + ')';
          ctx.fillRect(d.x - 1.2, d.y - 1.2, 2.4, 2.4);
          break;
        default: break;
      }
    }
  },

  // ------------------------------------------------------------ markers

  drawMarkers(ctx, view) {
    for (const m of G.markers) {
      if (m.x < view.x - 60 || m.x > view.x + view.w + 60 || m.y < view.y - 60 || m.y > view.y + view.h + 60) continue;
      const pulse = 0.5 + Math.sin(m.pulse * 3) * 0.5;
      ctx.save();
      ctx.globalAlpha = 0.22 + pulse * 0.18;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r + 3 + pulse * 5, 0, TAU);
      ctx.stroke();

      // Floating pillar so markers are visible over rooftops.
      ctx.globalAlpha = 0.35;
      const topY = m.y - 34 - pulse * 8;
      const grad = ctx.createLinearGradient(0, topY, 0, m.y);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, m.color);
      ctx.fillStyle = grad;
      ctx.fillRect(m.x - m.r * 0.55, topY, m.r * 1.1, m.y - topY);
      ctx.restore();
    }
  },

  drawPickups(ctx, view) {
    for (const p of G.pickups) {
      if (!p.active) continue;
      if (p.x < view.x || p.x > view.x + view.w || p.y < view.y || p.y > view.y + view.h) continue;
      const bob = Math.sin(p.bob) * 4;
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 6, 11, 5, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.translate(p.x, p.y - 8 + bob);
      ctx.rotate(p.bob * 0.6);
      ctx.fillStyle = p.def.color;
      ctx.shadowColor = p.def.color;
      ctx.shadowBlur = 14;
      roundRect(ctx, -8, -8, 16, 16, 4);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.rotate(-p.bob * 0.6);
      ctx.fillText(p.def.label, 0, 1);
      ctx.restore();
    }
  },

  // ------------------------------------------------------------ actors

  drawEntities(ctx, view, night) {
    // Corpses first so the living stand on top of them.
    for (const p of G.peds) {
      if (!p.dead || p.vehicle) continue;
      if (this.cull(p, view, 40)) continue;
      this.drawPed(ctx, p);
    }
    for (const p of G.peds) {
      if (p.dead || p.vehicle) continue;
      if (this.cull(p, view, 40)) continue;
      this.drawPed(ctx, p);
    }
    for (const v of G.vehicles) {
      if (this.cull(v, view, 90)) continue;
      this.drawVehicle(ctx, v, night);
    }
    if (G.player.alive && !G.player.vehicle) this.drawPlayer(ctx, G.player);

    // Bullet tracers.
    ctx.lineCap = 'round';
    for (const b of G.bullets) {
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  },

  cull(e, view, pad) {
    return e.x < view.x - pad || e.x > view.x + view.w + pad ||
           e.y < view.y - pad || e.y > view.y + view.h + pad;
  },

  drawPed(ctx, p) {
    ctx.save();
    ctx.translate(p.x, p.y);

    if (p.dead) {
      ctx.rotate(p.angle);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(2, 3, 12, 7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = p.shirt;
      roundRect(ctx, -9, -5, 18, 10, 4); ctx.fill();
      ctx.fillStyle = p.skin;
      ctx.beginPath(); ctx.arc(10, 0, 4.4, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(2.5, 3.5, 8, 6, 0, 0, TAU);
    ctx.fill();

    ctx.rotate(p.angle);
    const step = Math.sin(p.bob) * (p.speed > 8 ? 2.6 : 0);

    // Legs.
    ctx.fillStyle = p.pants;
    roundRect(ctx, -3, -5 + step * 0.5, 7, 4, 2); ctx.fill();
    roundRect(ctx, -3, 1 - step * 0.5, 7, 4, 2); ctx.fill();

    // Torso.
    ctx.fillStyle = p.cop ? '#20356b' : p.shirt;
    roundRect(ctx, -5.5, -5, 11, 10, 4);
    ctx.fill();
    if (p.cop) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(-1, -5, 2, 10);
    }

    // Arms.
    ctx.fillStyle = p.skin;
    if (p.armed && (p.state === 'chase' || p.hostile)) {
      roundRect(ctx, 2, -4.5, 8, 3, 1.5); ctx.fill();
      ctx.fillStyle = '#22242c';
      ctx.fillRect(8, -4.2, 6, 2.4);
    } else {
      roundRect(ctx, -1, -7 + step, 5, 2.6, 1.3); ctx.fill();
      roundRect(ctx, -1, 4.4 - step, 5, 2.6, 1.3); ctx.fill();
    }

    // Head.
    ctx.fillStyle = p.skin;
    ctx.beginPath();
    ctx.arc(1.5, 0, 4.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(0.2, 0, 4.6, Math.PI * 0.55, Math.PI * 1.45);
    ctx.fill();

    ctx.restore();
  },

  drawPlayer(ctx, p) {
    // A soft ring under the player: at this camera height a lone figure in a
    // crowd is easy to lose track of.
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(G.time * 3) * 0.12;
    ctx.strokeStyle = '#ff3d81';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(p.x, p.y + 2, 15, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(p.x, p.y);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(3, 4, 9, 6.5, 0, 0, TAU);
    ctx.fill();

    ctx.rotate(p.angle);
    const step = Math.sin(p.bob) * (p.speed > 10 ? 3 : 0);
    const kick = p.recoil * 2;

    ctx.fillStyle = p.pants;
    roundRect(ctx, -3.5 - kick, -5.5 + step * 0.5, 8, 4.4, 2); ctx.fill();
    roundRect(ctx, -3.5 - kick, 1.2 - step * 0.5, 8, 4.4, 2); ctx.fill();

    ctx.fillStyle = p.shirt;
    roundRect(ctx, -6 - kick, -5.6, 12, 11.2, 4.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,61,129,0.9)';
    ctx.fillRect(-2 - kick, -5.6, 2.2, 11.2);

    // Weapon arm points where you aim.
    const w = WEAPONS[p.weapon];
    ctx.fillStyle = p.skin;
    if (w.melee) {
      roundRect(ctx, -0.5 - kick, -7.5 + step, 6, 3, 1.5); ctx.fill();
      roundRect(ctx, -0.5 - kick, 4.5 - step, 6, 3, 1.5); ctx.fill();
    } else {
      roundRect(ctx, 1 - kick, -5, 9, 3.2, 1.6); ctx.fill();
      roundRect(ctx, 1 - kick, 1.8, 9, 3.2, 1.6); ctx.fill();
      ctx.fillStyle = '#23252d';
      const gunLen = p.weapon === 'shotgun' || p.weapon === 'rifle' ? 15 : 9;
      ctx.fillRect(8 - kick, -2.4, gunLen, 4);
      if (p.muzzle > 0.05) {
        ctx.save();
        ctx.globalAlpha = p.muzzle;
        ctx.fillStyle = '#ffd97a';
        ctx.beginPath();
        ctx.moveTo(8 + gunLen - kick, -3.6);
        ctx.lineTo(8 + gunLen + 16 * p.muzzle - kick, 0);
        ctx.lineTo(8 + gunLen - kick, 3.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.fillStyle = p.skin;
    ctx.beginPath();
    ctx.arc(1.5, 0, 5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2b2620';
    ctx.beginPath();
    ctx.arc(0, 0, 5, Math.PI * 0.5, Math.PI * 1.5);
    ctx.fill();

    ctx.restore();

    // Aim line.
    if (!WEAPONS[p.weapon].melee) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = '#ff3d81';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(p.aim) * 18, p.y + Math.sin(p.aim) * 18);
      ctx.lineTo(p.x + Math.cos(p.aim) * 330, p.y + Math.sin(p.aim) * 330);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  },

  drawVehicle(ctx, v, night) {
    const d = v.def;
    const L = d.len, Wd = d.wid;

    ctx.save();
    ctx.translate(v.x, v.y);

    // Ground shadow, offset away from the camera for a hint of height.
    ctx.save();
    ctx.rotate(v.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    roundRect(ctx, -L / 2 + 3, -Wd / 2 + 4, L, Wd, 7);
    ctx.fill();
    ctx.restore();

    ctx.rotate(v.angle);

    // Wheels.
    ctx.fillStyle = '#141419';
    const wr = Wd * 0.5 + 1;
    const wheelLen = d.bike ? 9 : 11;
    const wheelW = d.bike ? 4 : 5;
    if (d.bike) {
      ctx.fillRect(L * 0.28, -wheelW / 2, wheelLen, wheelW);
      ctx.fillRect(-L * 0.4, -wheelW / 2, wheelLen, wheelW);
    } else {
      const steerA = v.steer * 0.4;
      ctx.save();
      ctx.translate(L * 0.28, -wr + 1);
      ctx.rotate(steerA);
      ctx.fillRect(-wheelLen / 2, -wheelW / 2, wheelLen, wheelW);
      ctx.restore();
      ctx.save();
      ctx.translate(L * 0.28, wr - 1);
      ctx.rotate(steerA);
      ctx.fillRect(-wheelLen / 2, -wheelW / 2, wheelLen, wheelW);
      ctx.restore();
      ctx.fillRect(-L * 0.38 - wheelLen / 2, -wr - wheelW / 2 + 1, wheelLen, wheelW);
      ctx.fillRect(-L * 0.38 - wheelLen / 2, wr - wheelW / 2 - 1, wheelLen, wheelW);
    }

    // Body.
    const dmg = clamp(1 - v.hp / v.maxHp, 0, 1);
    const body = v.dead ? '#3a3134' : v.color;
    ctx.fillStyle = body;
    roundRect(ctx, -L / 2, -Wd / 2, L, Wd, d.bike ? 5 : 8);
    ctx.fill();

    // Top highlight for a bit of curvature.
    const grad = ctx.createLinearGradient(0, -Wd / 2, 0, Wd / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.20)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.02)');
    grad.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = grad;
    roundRect(ctx, -L / 2, -Wd / 2, L, Wd, d.bike ? 5 : 8);
    ctx.fill();

    if (!d.bike) {
      // Cabin + windows.
      ctx.fillStyle = 'rgba(20,26,38,0.92)';
      roundRect(ctx, -L * 0.18, -Wd / 2 + 3, L * 0.34, Wd - 6, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,190,230,0.35)';
      roundRect(ctx, L * 0.16, -Wd / 2 + 4, L * 0.1, Wd - 8, 2);
      ctx.fill();
      roundRect(ctx, -L * 0.3, -Wd / 2 + 4, L * 0.08, Wd - 8, 2);
      ctx.fill();

      // Livery.
      if (v.isPolice) {
        ctx.fillStyle = '#12203f';
        ctx.fillRect(-L * 0.5 + 4, -Wd / 2, L * 0.28, Wd);
        ctx.fillRect(L * 0.26, -Wd / 2, L * 0.2, Wd);
        // Light bar.
        const flash = Math.sin(G.time * 14 + v.sirenPhase) > 0;
        if (v.sirenOn) {
          ctx.fillStyle = flash ? '#ff2b45' : '#2b6bff';
          ctx.fillRect(-2, -Wd / 2 - 1, 7, Wd * 0.45);
          ctx.fillStyle = flash ? '#2b6bff' : '#ff2b45';
          ctx.fillRect(-2, Wd * 0.05, 7, Wd * 0.45);
          ctx.shadowColor = flash ? '#ff2b45' : '#2b6bff';
          ctx.shadowBlur = 18;
          ctx.fillRect(-2, -Wd / 2 - 1, 7, Wd);
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = '#4b5563';
          ctx.fillRect(-2, -Wd / 2 - 1, 7, Wd);
        }
      } else if (v.type === 'taxi') {
        ctx.fillStyle = '#1b1b1f';
        ctx.fillRect(-4, -Wd / 2 - 1.5, 9, 5);
        ctx.fillStyle = '#f5c518';
        ctx.fillRect(-3, -Wd / 2 - 0.5, 7, 3);
      } else if (v.type === 'truck' || v.type === 'van') {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(-L * 0.45, -Wd / 2 + 3, L * 0.22, Wd - 6);
      }

      // Lights.
      ctx.fillStyle = night > 0.2 ? '#fff6c9' : 'rgba(255,246,201,0.5)';
      ctx.fillRect(L / 2 - 3, -Wd / 2 + 3, 3, 5);
      ctx.fillRect(L / 2 - 3, Wd / 2 - 8, 3, 5);
      ctx.fillStyle = v.throttle < 0 ? '#ff5252' : 'rgba(190,50,50,0.75)';
      ctx.fillRect(-L / 2, -Wd / 2 + 3, 3, 5);
      ctx.fillRect(-L / 2, Wd / 2 - 8, 3, 5);
    } else {
      // Rider.
      ctx.fillStyle = '#22242c';
      roundRect(ctx, -6, -5, 12, 10, 4);
      ctx.fill();
      ctx.fillStyle = '#d9d9e0';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
    }

    // Damage grime.
    if (dmg > 0.25) {
      ctx.globalAlpha = (dmg - 0.25) * 0.7;
      ctx.fillStyle = '#15130f';
      roundRect(ctx, -L / 2, -Wd / 2, L, Wd, 8);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  },

  // ------------------------------------------------------------ structures

  _visible: [],

  drawStructures(ctx, view, cam, night) {
    const w = G.world;
    const list = this._visible;
    list.length = 0;

    // Extrusion can throw a tower a long way from its footprint, so the
    // structure cull is much looser than the entity cull.
    const M = 760;
    for (const b of w.buildings) {
      if (b.x + b.w < view.x - M || b.x > view.x + view.w + M ||
          b.y + b.h < view.y - M || b.y > view.y + view.h + M) continue;
      b._d = dist2(b.x + b.w / 2, b.y + b.h / 2, cam.x, cam.y);
      list.push(b);
    }
    for (const p of w.props) {
      if (p.cx < view.x - 80 || p.cx > view.x + view.w + 80 ||
          p.cy < view.y - 140 || p.cy > view.y + view.h + 80) continue;
      p._d = dist2(p.cx, p.cy, cam.x, cam.y);
      list.push(p);
    }

    // Extrusion points away from the camera, so the farthest structures are
    // occluded by the nearer ones: draw far to near.
    list.sort((a, b) => b._d - a._d);

    for (const s of list) {
      if (s.type) this.drawProp(ctx, s, cam, night);
      else this.drawBuilding(ctx, s, cam, night);
    }
  },

  drawBuilding(ctx, b, cam, night) {
    const h = b.height;
    const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;

    const rx0 = this.projX(x0, h, cam), rx1 = this.projX(x1, h, cam);
    const ry0 = this.projY(y0, h, cam), ry1 = this.projY(y1, h, cam);

    // Contact shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(x0 - 3, y0 - 3, b.w + 6, b.h + 6);

    // Visible side faces: a face shows when it points away from the camera.
    const faces = [];
    if (cam.x < x0) faces.push({ ax: x0, ay: y0, bx: x0, by: y1, rax: rx0, ray: ry0, rbx: rx0, rby: ry1, shade: 0.72, vertical: true });
    if (cam.x > x1) faces.push({ ax: x1, ay: y0, bx: x1, by: y1, rax: rx1, ray: ry0, rbx: rx1, rby: ry1, shade: 0.60, vertical: true });
    if (cam.y < y0) faces.push({ ax: x0, ay: y0, bx: x1, by: y0, rax: rx0, ray: ry0, rbx: rx1, rby: ry0, shade: 0.80, vertical: false });
    if (cam.y > y1) faces.push({ ax: x0, ay: y1, bx: x1, by: y1, rax: rx0, ray: ry1, rbx: rx1, rby: ry1, shade: 0.50, vertical: false });

    for (const f of faces) {
      ctx.fillStyle = shadeColor(b.color, f.shade);
      ctx.beginPath();
      ctx.moveTo(f.ax, f.ay);
      ctx.lineTo(f.bx, f.by);
      ctx.lineTo(f.rbx, f.rby);
      ctx.lineTo(f.rax, f.ray);
      ctx.closePath();
      ctx.fill();

      // Fake ambient occlusion: walls darken toward street level.
      const gx0 = (f.ax + f.bx) / 2, gy0 = (f.ay + f.by) / 2;
      const gx1 = (f.rax + f.rbx) / 2, gy1 = (f.ray + f.rby) / 2;
      const ao = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      ao.addColorStop(0, 'rgba(0,0,0,0.38)');
      ao.addColorStop(0.55, 'rgba(0,0,0,0.05)');
      ao.addColorStop(1, 'rgba(255,255,255,0.05)');
      ctx.fillStyle = ao;
      ctx.fill();

      if (h > 34 && G.quality > 0) this.drawWindows(ctx, f, b, night);
    }

    // Roof.
    const rw = rx1 - rx0, rh = ry1 - ry0;
    ctx.fillStyle = b.roof;
    ctx.fillRect(rx0, ry0, rw, rh);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(rx0 + 1, ry0 + 1, rw - 2, rh - 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx0 + 3.5, ry0 + 3.5, rw - 7, rh - 7);

    // Roof clutter — fixed-size units so big roofs do not get big blobs.
    if (rw > 34 && rh > 34) {
      const s = b.seed;
      const units = 1 + (s & 3);
      for (let i = 0; i < units; i++) {
        const uw = 12 + ((s >> (i * 3)) & 7) * 3;
        const uh = 10 + ((s >> (i * 2 + 5)) & 7) * 2.5;
        const ux = rx0 + 8 + (((s >> (i * 5)) & 31) / 31) * Math.max(1, rw - uw - 16);
        const uy = ry0 + 8 + (((s >> (i * 4 + 3)) & 31) / 31) * Math.max(1, rh - uh - 16);
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.28)';
        ctx.fillRect(ux, uy, uw, uh);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(ux + 2, uy + uh, uw, 3);
      }
      // Rooftop pipework.
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rx0 + 6, ry0 + rh * 0.5);
      ctx.lineTo(rx0 + rw - 6, ry0 + rh * 0.5);
      ctx.stroke();
    }

    // Neon: a lit cornice along the top edge of each facade we can see, which
    // reads as signage far better than outlining the whole roof.
    if (b.neon && faces.length) {
      ctx.save();
      ctx.globalAlpha = 0.22 + night * 0.7;
      ctx.strokeStyle = b.neon;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.shadowColor = b.neon;
      ctx.shadowBlur = 8 + night * 30;
      for (const f of faces) {
        ctx.beginPath();
        ctx.moveTo(f.rax, f.ray);
        ctx.lineTo(f.rbx, f.rby);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.restore();
    }

    // Aviation beacon on the tall ones.
    if (h > 150) {
      const on = Math.sin(G.time * 2.4 + b.seed) > 0.3;
      ctx.fillStyle = on ? '#ff4d4d' : 'rgba(120,30,30,0.6)';
      ctx.beginPath();
      ctx.arc(rx0 + rw * 0.5, ry0 + rh * 0.5, on ? 4 : 2.5, 0, TAU);
      ctx.fill();
      if (on) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ff4d4d';
        ctx.beginPath();
        ctx.arc(rx0 + rw * 0.5, ry0 + rh * 0.5, 12, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  },

  drawWindows(ctx, f, b, night) {
    const spanX = f.bx - f.ax, spanY = f.by - f.ay;
    const span = Math.hypot(spanX, spanY);
    const cols = Math.max(1, Math.floor(span / 22));
    const rows = Math.max(1, Math.min(9, Math.floor(b.height / 26)));
    if (cols * rows > 90) return;

    const seed = b.seed;
    for (let r = 0; r < rows; r++) {
      const t0 = 0.1 + (r / rows) * 0.82;
      const t1 = t0 + (0.82 / rows) * 0.52;
      for (let c = 0; c < cols; c++) {
        const u0 = (c + 0.26) / cols, u1 = (c + 0.74) / cols;
        const bit = ((seed >> ((r * 3 + c) & 15)) ^ (r * 7 + c * 13)) & 7;
        const lit = night > 0.25 && bit > 3;
        ctx.fillStyle = lit
          ? (bit > 6 ? 'rgba(255,226,150,0.85)' : 'rgba(255,206,120,0.6)')
          : 'rgba(15,20,32,0.42)';

        const ax = lerp(f.ax, f.bx, u0), ay = lerp(f.ay, f.by, u0);
        const bx = lerp(f.ax, f.bx, u1), by = lerp(f.ay, f.by, u1);
        const p0x = lerp(ax, lerp(f.rax, f.rbx, u0), t0), p0y = lerp(ay, lerp(f.ray, f.rby, u0), t0);
        const p1x = lerp(bx, lerp(f.rax, f.rbx, u1), t0), p1y = lerp(by, lerp(f.ray, f.rby, u1), t0);
        const p2x = lerp(bx, lerp(f.rax, f.rbx, u1), t1), p2y = lerp(by, lerp(f.ray, f.rby, u1), t1);
        const p3x = lerp(ax, lerp(f.rax, f.rbx, u0), t1), p3y = lerp(ay, lerp(f.ray, f.rby, u0), t1);

        ctx.beginPath();
        ctx.moveTo(p0x, p0y);
        ctx.lineTo(p1x, p1y);
        ctx.lineTo(p2x, p2y);
        ctx.lineTo(p3x, p3y);
        ctx.closePath();
        ctx.fill();
      }
    }
  },

  drawProp(ctx, p, cam, night) {
    const tx = this.projX(p.cx, p.height, cam);
    const ty = this.projY(p.cy, p.height, cam);

    if (p.type === 'tree' || p.type === 'palm') {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(p.cx + 4, p.cy + 4, p.r * 0.9, p.r * 0.65, 0, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = '#4a3524';
      ctx.lineWidth = p.type === 'palm' ? 5 : 7;
      ctx.beginPath();
      ctx.moveTo(p.cx, p.cy);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      if (p.type === 'palm') {
        ctx.fillStyle = '#2f7a44';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + p.cx * 0.01;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.quadraticCurveTo(
            tx + Math.cos(a) * p.r * 1.4, ty + Math.sin(a) * p.r * 1.4,
            tx + Math.cos(a) * p.r * 2.2, ty + Math.sin(a) * p.r * 2.2
          );
          ctx.lineTo(tx + Math.cos(a + 0.3) * p.r * 1.2, ty + Math.sin(a + 0.3) * p.r * 1.2);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        ctx.fillStyle = '#2f6b3d';
        ctx.beginPath(); ctx.arc(tx, ty, p.r, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(120,200,130,0.25)';
        ctx.beginPath(); ctx.arc(tx - p.r * 0.3, ty - p.r * 0.3, p.r * 0.55, 0, TAU); ctx.fill();
      }
      return;
    }

    if (p.type === 'lamp') {
      ctx.strokeStyle = '#4b5160';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.cx, p.cy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.fillStyle = night > 0.25 ? '#ffe9a8' : '#8b93a5';
      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, TAU);
      ctx.fill();
      return;
    }

    if (p.type === 'fountain') {
      ctx.fillStyle = '#6b6455';
      ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2b7ea1';
      ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r * 0.72, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(190,235,255,0.75)';
      ctx.beginPath();
      ctx.arc(tx, ty, 5 + Math.sin(G.time * 4) * 1.6, 0, TAU);
      ctx.fill();
      return;
    }
  },

  /** Keep the player readable when a tower is standing in front of them. */
  drawOccludedPlayer(ctx, cam) {
    const p = G.player;
    if (!p.alive) return;
    const px = p.vehicle ? p.vehicle.x : p.x;
    const py = p.vehicle ? p.vehicle.y : p.y;

    let occluded = false;
    const near = G.world.hash.queryCircle(px, py, 340, G._scratchC);
    for (let i = 0; i < near.length; i++) {
      const b = near[i];
      if (b.height === undefined || b.height < 22) continue;
      const rx0 = this.projX(b.x, b.height, cam), rx1 = this.projX(b.x + b.w, b.height, cam);
      const ry0 = this.projY(b.y, b.height, cam), ry1 = this.projY(b.y + b.h, b.height, cam);
      const minX = Math.min(b.x, rx0), maxX = Math.max(b.x + b.w, rx1);
      const minY = Math.min(b.y, ry0), maxY = Math.max(b.y + b.h, ry1);
      if (px > minX && px < maxX && py > minY && py < maxY) { occluded = true; break; }
    }
    if (!occluded) return;

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#ff3d81';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(px, py, p.vehicle ? p.vehicle.def.len * 0.5 : 12, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#ff3d81';
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, TAU);
    ctx.fill();
    ctx.restore();
  },

  // ------------------------------------------------------------ fx

  drawParticles(ctx, view) {
    for (const p of G.particles) {
      if (p.x < view.x || p.x > view.x + view.w || p.y < view.y || p.y > view.y + view.h) continue;
      const t = p.life / p.maxLife;
      switch (p.type) {
        case 'smoke':
          ctx.globalAlpha = t * 0.35;
          ctx.fillStyle = '#8b8b96';
          ctx.beginPath();
          ctx.arc(p.x, p.y, (1 - t) * 16 * p.size + 3, 0, TAU);
          ctx.fill();
          break;
        case 'fire':
          ctx.globalAlpha = t;
          ctx.fillStyle = t > 0.6 ? '#fff3b0' : t > 0.3 ? '#ff9f1c' : '#e63946';
          ctx.beginPath();
          ctx.arc(p.x, p.y, (t * 9 + 2) * p.size, 0, TAU);
          ctx.fill();
          break;
        case 'blood':
          ctx.globalAlpha = t;
          ctx.fillStyle = '#a4161a';
          ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
          break;
        case 'spark':
          ctx.globalAlpha = t;
          ctx.strokeStyle = '#ffd166';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.012, p.y - p.vy * 0.012);
          ctx.stroke();
          break;
        case 'debris':
          ctx.globalAlpha = t;
          ctx.fillStyle = '#4b4b55';
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot + (1 - t) * 8);
          ctx.fillRect(-2.5, -1.6, 5, 3.2);
          ctx.restore();
          break;
        default: break;
      }
    }
    ctx.globalAlpha = 1;

    for (const s of G.shockwaves) {
      const t = s.life / s.maxLife;
      ctx.globalAlpha = t * 0.6;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 4 * t + 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  drawNight(ctx, view, night, W, H, zoom, cam, sx, sy) {
    // Dim pass.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(8,12,34,' + (night * 0.62) + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Additive light pass, back in world space.
    ctx.save();
    ctx.setTransform(zoom, 0, 0, zoom, -cam.x * zoom + W / 2 + sx, -cam.y * zoom + H / 2 + sy);
    ctx.globalCompositeOperation = 'lighter';

    // Street lamps.
    for (const p of G.world.props) {
      if (!p.light) continue;
      if (p.cx < view.x || p.cx > view.x + view.w || p.cy < view.y || p.cy > view.y + view.h) continue;
      const g = ctx.createRadialGradient(p.cx, p.cy, 4, p.cx, p.cy, 74);
      g.addColorStop(0, 'rgba(255,214,130,' + (0.30 * night) + ')');
      g.addColorStop(1, 'rgba(255,214,130,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.cx - 74, p.cy - 74, 148, 148);
    }

    // Headlights.
    for (const v of G.vehicles) {
      if (this.cull(v, view, 120) || v.dead) continue;
      const c = Math.cos(v.angle), s = Math.sin(v.angle);
      const hx = v.x + c * v.def.len * 0.5, hy = v.y + s * v.def.len * 0.5;
      const reach = 190;
      const g = ctx.createRadialGradient(hx, hy, 6, hx, hy, reach);
      g.addColorStop(0, 'rgba(255,244,214,' + (0.26 * night) + ')');
      g.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.arc(hx, hy, reach, v.angle - 0.42, v.angle + 0.42);
      ctx.closePath();
      ctx.fill();

      if (v.sirenOn) {
        const flash = Math.sin(G.time * 14 + v.sirenPhase) > 0;
        const col = flash ? '255,60,80' : '70,120,255';
        const g2 = ctx.createRadialGradient(v.x, v.y, 4, v.x, v.y, 120);
        g2.addColorStop(0, 'rgba(' + col + ',0.35)');
        g2.addColorStop(1, 'rgba(' + col + ',0)');
        ctx.fillStyle = g2;
        ctx.fillRect(v.x - 120, v.y - 120, 240, 240);
      }
    }

    // Muzzle flash + fire glow.
    const p = G.player;
    if (p.muzzle > 0.05) {
      const mx = p.x + Math.cos(p.aim) * 22, my = p.y + Math.sin(p.aim) * 22;
      const g = ctx.createRadialGradient(mx, my, 2, mx, my, 150);
      g.addColorStop(0, 'rgba(255,220,150,' + (0.5 * p.muzzle) + ')');
      g.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.fillStyle = g;
      ctx.fillRect(mx - 150, my - 150, 300, 300);
    }
    for (const part of G.particles) {
      if (part.type !== 'fire') continue;
      const t = part.life / part.maxLife;
      const g = ctx.createRadialGradient(part.x, part.y, 1, part.x, part.y, 70 * part.size);
      g.addColorStop(0, 'rgba(255,170,80,' + (0.34 * t) + ')');
      g.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.fillStyle = g;
      ctx.fillRect(part.x - 70 * part.size, part.y - 70 * part.size, 140 * part.size, 140 * part.size);
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  },

  drawFlash(ctx, W, H) {
    if (G.flash <= 0.01) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(255,220,170,' + (G.flash * 0.4) + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  },
};

/** Multiply a "#rrggbb" colour by a factor. */
function shadeColor(hex, factor) {
  const v = parseInt(hex.slice(1), 16);
  const r = Math.round(((v >> 16) & 255) * factor);
  const g = Math.round(((v >> 8) & 255) * factor);
  const b = Math.round((v & 255) * factor);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}
