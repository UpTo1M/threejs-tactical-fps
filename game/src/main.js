// SABLE LINE boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. ?shot=start|play|plant|end with &seed=N
// stages a deterministic frame, renders it twice, freezes it and sets
// window.__shotReady (used by the screenshot tooling).
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MAP } from './world.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { createGame } from './game.js';
import { createBots } from './bots.js';
import { stageShot } from './shots.js';
import {
  WEAPONS, createWeaponState, weaponReady, weaponReload, weaponSpread,
} from './weapons.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);
if (shot) {
  // deterministic staging: the shot's own rolls come from the seed
  Math.random = random;
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Flat fallback behind the sky dome (world.js), tinted like the horizon haze.
scene.background = new THREE.Color(0x46536e);
scene.fog = new THREE.Fog(new THREE.Color(0x46536e), 35, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene, camera);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const player = createPlayer(world.colliders, MAP.attackerSpawn);
player.sidearm = createWeaponState(WEAPONS.p9);
player.weapon = player.sidearm;
const game = createGame({ scene, colliders: world.colliders, shootables: world.shootables, effects, audio });
game.setPlayer(player);

// --- shared raycaster for line of sight (reused, never allocated per call) ---
const losRay = new THREE.Raycaster();
losRay.far = 95;
const losDir = new THREE.Vector3();
const losTmp = new THREE.Vector3();

function hasLineOfSight(from, to, dist) {
  losDir.copy(to).sub(from);
  const d = dist ?? losDir.length();
  losDir.normalize();
  losRay.set(from, losDir);
  const hits = losRay.intersectObjects(world.shootables, false);
  return !(hits.length && hits[0].distance < d - 0.4);
}

const botsApi = {
  resetRound(round) {
    bots.resetRound(round);
  },
  nearestAliveAlly(pos) {
    let best = null;
    let bestD = Infinity;
    for (const b of bots.bots) {
      if (b.team !== 'V' || !b.alive) continue;
      const d = Math.hypot(b.mover.body.position.x - pos.x, b.mover.body.position.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  },
  kill(bot) {
    bots.kill(bot);
  },
  aliveCount(team) {
    return bots.aliveCount(team);
  },
  hitMeshes() {
    return bots.hitMeshes();
  },
  hearShot(pos, team) {
    bots.hearShot(pos, team);
  },
  hasLineOfSight,
  blockedBySmoke(a, b) {
    return effects.blockedBySmoke(a, b);
  },
  enemiesOf(bot) {
    const out = [];
    if (bot.team === 'J' && game.state.playerAlive) out.push({ kind: 'player', ref: player.mover.body });
    for (const other of bots.bots) {
      if (other.team !== bot.team && other.alive) out.push({ kind: 'bot', ref: other });
    }
    return out;
  },
  damagePlayer(amount, fromPos) {
    game.damagePlayer(amount, fromPos);
  },
  damageBot(bot, amount, part, attacker) {
    game.damageBot(bot, amount, part, attacker);
  },
  addTracer(from, to) {
    effects.addTracer(from, to);
  },
  playShot(sound, from) {
    audio.shot(sound, camera.position.distanceTo(from));
  },
  botMuzzle(bot) {
    losTmp.set(bot.mover.body.position.x, bot.mover.body.position.y + 1.25, bot.mover.body.position.z);
    effects.burstParticles(losTmp, 3, new THREE.Color(0xffc46b), 2);
  },
  time() {
    return game.state.time;
  },
  playerSpeed() {
    return player.groundSpeed();
  },
  spikePlanted() {
    return game.spikePlanted();
  },
  spikePos() {
    return game.spikePos();
  },
  spikeSite() {
    return game.spikeSite();
  },
  spikePlantedBy(bot) {
    game.spikePlantedBy(bot);
  },
  spikeDefusedBy(bot) {
    game.spikeDefusedBy(bot);
  },
  botPlanting(bot, progress) {
    game.botPlanting(bot, progress);
  },
  botDefusing(bot, progress) {
    game.botDefusing(bot, progress);
  },
};

const bots = createBots(scene, world.colliders, botsApi);
botsApi.bots = bots.bots;
game.setBotsApi(botsApi);

// --- viewmodel: a simple gun in the player's hands, attached to the camera ---
// Lighter metals than the old near-black slab, a magazine, a front sight and
// a thin gold stripe, so it reads as a rifle in the dusk light.
const viewmodel = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x33373f, roughness: 0.55, metalness: 0.45 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x6a7078, roughness: 0.45, metalness: 0.55 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), accent);
  barrel.position.set(0, 0.03, -0.4);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), dark);
  grip.position.set(0, -0.14, 0.16);
  grip.rotation.x = 0.35;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.12), dark);
  mag.position.set(0, -0.13, -0.08);
  mag.rotation.x = 0.25;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.1), accent);
  sight.position.set(0, 0.09, -0.05);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.02, 0.3), gold);
  stripe.position.set(0, 0.045, -0.18);
  viewmodel.add(body, barrel, grip, mag, sight, stripe);
  viewmodel.position.set(0.3, -0.27, -0.55);
  camera.add(viewmodel);
}
let viewRecoil = 0;
let viewReload = 0;
let stepAcc = 0;

// --- game state ---
const body = player.mover.body;
let started = false;
let frozen = false;
let paused = false;
let accumulator = 0;
let lastTime = performance.now();
let buyOpen = false;
let scoped = false;
let muted = false;
let prevFiring = false;

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  const ok = game.playerShoot(camera, spread);
  if (ok) {
    viewRecoil = Math.min(1, viewRecoil + 0.55);
    player.recoil(player.weapon.def.recoil * (0.8 + Math.random() * 0.4), (Math.random() * 2 - 1) * 0.003);
    hud.setAmmo(player.weapon.mag, player.weapon.reserve);
  }
  return ok;
}

function shootAt(point) {
  aimAt(point);
  shoot(0);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function ownedMap() {
  const owned = { p9: true };
  if (game.state.primaryId) owned[game.state.primaryId] = true;
  if (game.state.grenades.frag) owned.frag = true;
  if (game.state.grenades.smoke) owned.smoke = true;
  if (game.state.hasKevlar) owned.kevlar = true;
  if (game.state.hasKit) owned.kit = true;
  return owned;
}

function refreshHud() {
  const S = game.state;
  hud.setHealth(S.playerHp, S.playerArmor);
  hud.setAmmo(player.weapon.mag, player.weapon.reserve, player.weapon.def.name);
  hud.setGrenades(S.grenades.frag, S.grenades.smoke);
  hud.setMoney(S.money);
  hud.setScore(S.scoreV, S.scoreJ, S.round);
  hud.refreshBuy(S.money, ownedMap());
  const timer = S.phase === 'buy' ? S.phaseTime : S.spike.state === 'planted' ? S.spike.timer : S.phaseTime;
  hud.setTimer(timer, S.spike.state === 'planted');
  if (S.spike.state === 'planted') hud.setSpike('planted', S.spike.timer);
  else if (S.spike.carrier === 'player' && S.phase === 'live') {
    const site = S.spike.site === 'A' ? MAP.siteA : MAP.siteB;
    const d = Math.hypot(body.position.x - site.x, body.position.z - site.z);
    hud.setSpike(d < site.r ? 'site' : 'carry', site.name);
  } else if (S.spike.carrier !== 'player' && S.phase === 'live') {
    hud.setSpike('carry', `with your squad — site ${S.spike.site}`);
  } else hud.setSpike('none');
}

// drain game events into HUD + audio
function drainEvents() {
  for (const e of game.events.splice(0)) {
    if (e.type === 'kill') {
      const who = e.byPlayer ? 'You' : e.victimTeam === 'J' ? 'Squad' : 'Jackals';
      hud.killfeedAdd(`${who} ▸ ${e.victim}${e.headshot ? ' (headshot)' : ''}`, e.byPlayer);
      if (e.byPlayer) hud.hitMarker(true);
    } else if (e.type === 'playerHurt') {
      hud.damageFlash();
      hud.setHealth(game.state.playerHp, game.state.playerArmor);
    } else if (e.type === 'playerDied') {
      hud.setHealth(0, game.state.playerArmor);
      input.releaseLock();
      paused = false;
      hud.showOverlay('dead');
    } else if (e.type === 'roundStart') {
      player.mover.teleport(MAP.attackerSpawn.x, MAP.attackerSpawn.z, MAP.attackerSpawn.yaw);
      hud.hideBanner();
      if (!shot) hud.hideOverlay();
      hud.setScore(game.state.scoreV, game.state.scoreJ, e.round);
      buyOpen = true;
      hud.showBuy(true);
      hud.setHint('Buy phase — press B to close, 1–7 to buy');
    } else if (e.type === 'roundLive') {
      buyOpen = false;
      hud.showBuy(false);
      hud.setHint('');
    } else if (e.type === 'roundEnd') {
      buyOpen = false;
      hud.showBuy(false);
      hud.showBanner(
        e.winner === 'V' ? 'ROUND WON' : 'ROUND LOST',
        `${e.reason} — Vanguard ${e.scoreV} : ${e.scoreJ} Jackals`,
        e.winner === 'V',
      );
      hud.setScore(e.scoreV, e.scoreJ, game.state.round);
      hud.setMoney(e.money);
    } else if (e.type === 'matchEnd') {
      input.releaseLock();
      hud.showOverlay('match', e.winner === 'V' ? 'VANGUARD WINS THE YARD' : e.winner === 'J' ? 'JACKALS TAKE THE YARD' : 'DRAW — THE YARD IS SPLIT');
    } else if (e.type === 'spikePlanted') {
      hud.killfeedAdd(`Spike planted at site ${e.site}${e.by ? ` by ${e.by}` : ''}`, true);
    } else if (e.type === 'spikePassed') {
      hud.killfeedAdd(`Spike passed to ${e.name}`, true);
    } else if (e.type === 'bought') {
      hud.setMoney(e.money);
      hud.refreshBuy(e.money, ownedMap());
    } else if (e.type === 'grenadeThrown') {
      hud.setGrenades(game.state.grenades.frag, game.state.grenades.smoke);
    } else if (e.type === 'weaponSwitched') {
      hud.setAmmo(player.weapon.mag, player.weapon.reserve, player.weapon.def.name);
    } else if (e.type === 'botDefusing') {
      hud.setSpike('defusing', e.name);
    }
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  paused = false;
  if (game.state.phase === 'menu') {
    game.resetMatch();
    game.state.phase = 'buy';
    started = true;
    hud.hideOverlay();
    input.requestLock();
  } else if (game.state.phase === 'matchover') {
    game.resetMatch();
    hud.hideOverlay();
    input.requestLock();
  } else {
    hud.hideOverlay();
    input.requestLock();
  }
});

hud.onBuy((itemId) => {
  const res = game.buy(itemId);
  if (!res.ok) {
    audio.denied();
    hud.setHint(res.why);
    setTimeout(() => hud.setHint(''), 1500);
  } else {
    hud.setAmmo(player.weapon.mag, player.weapon.reserve, player.weapon.def.name);
    hud.setGrenades(game.state.grenades.frag, game.state.grenades.smoke);
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    paused = false;
    started = true;
    hud.hideOverlay();
    if (buyOpen) hud.showBuy(true);
  } else if (game.state.phase !== 'menu' && game.state.phase !== 'matchover' && game.state.playerAlive) {
    paused = true;
    hud.showOverlay('paused');
    hud.showBuy(false);
  }
}

function step(dt) {
  const S = game.state;
  // keep world matrices fresh for raycasts (staging runs steps with no render)
  scene.updateMatrixWorld(true);
  // look
  const look = input.takeLook();
  const sens = scoped ? 0.0009 : 0.0021;
  player.look(look.x, look.y, sens);
  // scope
  const wantScope = input.state.firingAlt && player.weapon.def.scoped && weaponReady(player.weapon);
  if (wantScope !== scoped) {
    scoped = wantScope;
    hud.setScope(scoped);
    camera.fov = scoped ? 32 : 74;
    camera.updateProjectionMatrix();
  }
  // firing (semi-auto needs a fresh press)
  const firing = input.state.firing;
  if (firing && S.playerAlive && S.phase === 'live') {
    if (player.weapon.def.auto || (!prevFiring && firing)) {
      if (weaponReady(player.weapon) || player.weapon.mag === 0) {
        const spread = weaponSpread(player.weapon, player.groundSpeed(), scoped);
        shoot(spread);
      }
    }
  }
  prevFiring = firing;
  // reload
  const pressed = input.takePressed();
  if (pressed.has('KeyR') && S.playerAlive) {
    if (weaponReload(player.weapon)) {
      audio.reload();
      viewReload = 1;
    }
  }
  if (pressed.has('KeyQ') && S.playerAlive) game.switchWeapon();
  if (pressed.has('KeyG') && S.playerAlive && S.phase === 'live') game.playerThrowGrenade('frag', camera);
  if (pressed.has('KeyT') && S.playerAlive && S.phase === 'live') game.playerThrowGrenade('smoke', camera);
  if (pressed.has('KeyB') && S.phase === 'buy') {
    buyOpen = !buyOpen;
    hud.showBuy(buyOpen);
    hud.refreshBuy(S.money, ownedMap());
  }
  if (pressed.has('KeyM')) {
    // mute toggle
    audio.setEnabled(muted);
    muted = !muted;
  }
  // buy hotkeys 1..7 while the menu is open
  if (buyOpen && S.phase === 'buy') {
    const ids = ['vk9', 'ar77', 'lancer', 'frag', 'smoke', 'kevlar', 'kit'];
    for (let i = 0; i < ids.length; i += 1) {
      if (pressed.has(`Digit${i + 1}`)) {
        const res = game.buy(ids[i]);
        if (!res.ok) audio.denied();
        else {
          hud.setAmmo(player.weapon.mag, player.weapon.reserve, player.weapon.def.name);
          hud.setGrenades(S.grenades.frag, S.grenades.smoke);
        }
      }
    }
  }
  // plant: hold E while carrying the spike inside the site
  if (S.phase === 'live' && S.playerAlive && S.spike.state === 'carried' && S.spike.carrier === 'player') {
    game.tryPlant(dt, input.state.keys.has('KeyE'));
    if (S.spike.plantProgress > 0) {
      hud.setHint(`Planting… ${Math.ceil((1 - S.spike.plantProgress / MAP.plantTime) * 10) / 10}s — hold E`);
    }
  }
  // movement
  if (S.playerAlive && (S.phase === 'live' || S.phase === 'buy')) {
    const speedScale = (scoped ? 0.45 : 1) * (player.weapon.def.speed / 5.4);
    player.step(dt, input.state.keys, speedScale);
    // footsteps
    stepAcc += player.groundSpeed() * dt;
    if (stepAcc > 2.4) {
      stepAcc = 0;
      audio.step();
    }
  }
  game.step(dt, input);
  // Bots fight only while the round is live: the buy phase is a freeze,
  // and a decided round is over.
  if (S.phase === 'live') bots.step(dt);
  effects.step(dt);
  // viewmodel motion
  viewRecoil = Math.max(0, viewRecoil - dt * 6);
  viewReload = Math.max(0, viewReload - dt * 1.4);
  const bob = player.groundSpeed() > 0.5 && S.playerAlive ? Math.sin(performance.now() * 0.011) * 0.008 : 0;
  viewmodel.position.z = -0.55 + viewRecoil * 0.09;
  viewmodel.position.y = -0.27 + bob - viewReload * 0.12;
  viewmodel.rotation.x = viewRecoil * 0.14 + viewReload * 0.7;
  drainEvents();
  refreshHud();
  hud.setCrosshair(4 + weaponSpread(player.weapon, player.groundSpeed(), scoped) * 240);
  syncCamera();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && !paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    hud.drawMinimap(now, body.position, body.yaw, bots.bots, game.state.spike);
  }
  renderer.render(scene, camera);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  game.resetMatch();
  drainEvents(); // consume roundStart before staging, so it cannot move the player
  stageShot(name, {
    game,
    bots,
    player,
    hud,
    effects,
    aimAt,
    shootAt,
    settle,
  });
  refreshHud();
  drainEvents(); // killfeed / banner events from the staged action
  // the live loop never runs in shot mode, so draw the minimap once here
  hud.drawMinimap(performance.now(), body.position, body.yaw, bots.bots, game.state.spike);
  syncCamera();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setHealth(100, 0);
hud.setAmmo(12, 48, 'P9 Sidearm');
hud.setMoney(800);
hud.setScore(0, 0, 1);
hud.setTimer(100, false);
// Dev hook for automated playtests (?debug=1): exposes the live sim objects.
// Never used by the game itself.
if (params.get('debug')) {
  window.__sable = { game, bots, player, input, hud, effects, step, aimAt, shoot, settle, syncCamera };
}
if (shot) {
  hud.hideOverlay();
  runShot(shot);
} else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
