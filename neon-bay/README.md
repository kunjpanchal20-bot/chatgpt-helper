# Neon Bay

A top-down open-world driving-and-shooting sandbox that runs entirely in the
browser. Twelve blocks of procedurally generated city, traffic that obeys lanes,
pedestrians that panic, police with a five-star wanted system, eight story jobs
and two side hustles.

**Play it:** open `index.html`. No build step, no server, no dependencies — it
works straight off the filesystem or off GitHub Pages.

> Neon Bay is an original game. Every pixel is drawn at runtime from code and
> every sound is synthesised by the Web Audio API. It contains no assets, code,
> characters or trademarks from any commercial game.

## Controls

| | |
|---|---|
| `W` `A` `S` `D` | move / drive |
| Mouse | aim &middot; **Click** to shoot (works as a drive-by from a car) |
| `Shift` | sprint |
| `Space` | handbrake — hold it into a corner to drift |
| `F` | enter / exit vehicle (carjack if it's occupied) |
| `1`–`5`, `Q`/`E`, wheel | switch weapon |
| `H` | start the story job you're standing on, or clock in for side work |
| `M` | full-screen map |
| `R` | next radio station |
| `P` / `Esc` | pause |

On a touchscreen, drag on the left half of the screen to steer and tap the right
half to fire.

## What's in it

**The city.** `city.js` generates a 4848×4848 world from a seed: a road grid,
zoned blocks (downtown / midtown / suburb / industrial / beachfront), buildings
subdivided into lots, parks with ponds, plazas, parking lots and a safehouse.
Traffic runs on a directed lane graph built from the same grid, with right-hand
lanes and no U-turns at junctions.

**The look.** Everything is 2D canvas, but buildings are extruded away from a
virtual camera point, so facades and rooftops resolve into a fake-3D city that
leans as you drive through it. Windows light up after dark, streetlamps pool on
the asphalt, headlights sweep the road, and the day/night cycle runs a full day
every seven minutes.

**Driving.** Arcade physics with per-vehicle acceleration, grip and mass across
nine vehicle types. Lateral grip is what makes it feel like a car: pull the
handbrake and traction drops, the back end steps out, and you leave rubber on
the road. Collisions trade momentum by mass and do damage above a speed
threshold; wreck a car badly enough and it burns, then explodes.

**Trouble.** Crimes add heat, heat becomes stars, stars summon police. Cruisers
route to you along the road network from a distance and switch to ramming up
close; at three stars they start shooting from the window, and officers dismount
to arrest you on foot. Shooting where nobody can see you doesn't raise anything
— you need witnesses.

**Jobs.** Eight story missions (delivery, package runs, a car theft with an
alarm on it, a demolition contract, a 90-second survival, a pickup-and-drive, a
gang shootout and a chase-then-escape finale), plus taxi driving in any taxi and
vigilante duty in any police car. Progress and cash save to `localStorage`.

**Sound.** No audio files. Engine noise is two oscillators tracking RPM through
a filter, gunshots are enveloped noise bursts, and the four radio stations are a
scheduled arpeggio-bass-drums sequencer with a different scale and tempo each.

## Cheats

Type these while playing: `guns`, `heal`, `cash`, `heat`, `clean`, `boom`,
`tank`, `ghost`.

## Source layout

| File | Role |
|---|---|
| `js/util.js` | math, seeded RNG, spatial hash, collision primitives |
| `js/audio.js` | Web Audio synthesis: SFX, engine, siren, radio |
| `js/city.js` | procedural city generation and the traffic lane graph |
| `js/entities.js` | vehicles, pedestrians, bullets, particles, pickups |
| `js/player.js` | weapons, the player, on-foot vs. driving |
| `js/ai.js` | pedestrian brains, traffic + police driving, wanted level, population |
| `js/missions.js` | story jobs, side hustles, marker system |
| `js/render.js` | world rendering, extrusion, lighting |
| `js/hud.js` | radar, status bars, notifications, full map |
| `js/game.js` | global state, input, main loop, save/load |

Scripts load in that order as plain `<script>` tags (no modules), which is what
lets the game run from a `file://` URL.
