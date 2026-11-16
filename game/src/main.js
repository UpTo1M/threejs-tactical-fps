// SABLE LINE boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. ?shot=start|play|plant|end with &seed=N
// stages a deterministic frame, renders it twice, freezes it and sets
// window.__shotReady (used by the screenshot tooling).
import * as THREE from 'three';
import { MAP, createWorld } from './world.js';
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
const BUY_KEYS = ['vk9', 'ar77', 'lancer', 'frag', 'smoke', 'kevlar', 'kit'];
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
const muzzleColor = new THREE.Color(0xffc46b);

function hasLineOfSight(from, to, dist) {
  losDir.subVectors(to, from);
  const distance = dist ?? losDir.length();
  losRay.set(from, losDir.normalize());
  sightHits.length = 0;
  losRay.intersectObjects(world.shootables, false, sightHits);
  return !sightHits.length || sightHits[0].distance >= distance - 0.4;
}
const sightHits = [];

const botsApi = {
  resetRound(round) {
    bots.resetRound(round);
  },
  nearestAliveAlly(pos) {
    let nearest = null;
    let minimum = Infinity;
    for (const actor of bots.bots) {
      if (actor.team !== 'V' || !actor.alive) continue;
      const point = actor.mover.body.position;
      const separation = Math.hypot(point.x - pos.x, point.z - pos.z);
      if (separation < minimum) {
        minimum = separation;
        nearest = actor;
      }
    }
    return nearest;
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
    const enemies = bots.bots
      .filter((candidate) => candidate.alive && candidate.team !== bot.team)
      .map((candidate) => ({ kind: 'bot', ref: candidate }));
    if (bot.team === 'J' && game.state.playerAlive) {
      enemies.unshift({ kind: 'player', ref: player.mover.body });
    }
    return enemies;
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
    effects.burstParticles(losTmp, 3, muzzleColor, 2);
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
let frozen = false;
let paused = false;
let accumulator = 0;
let lastTime = performance.now();
let buyOpen = false;
let scoped = false;
let muted = false;
let prevFiring = false;

function syncCamera() {
  camera.position.copy(body.position);
  camera.position.y += body.eye;
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dz = point.z - body.position.z;
  const dy = point.y - (body.position.y + body.eye);
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  syncCamera();
}

function shoot(spread) {
  if (!game.playerShoot(camera, spread)) return false;
  const gun = player.weapon;
  viewRecoil = Math.min(1, viewRecoil + 0.55);
  const vertical = (Math.random() * 0.4 + 0.8) * gun.def.recoil;
  const horizontal = (Math.random() * 2 - 1) * 0.003;
  player.recoil(vertical, horizontal);
  hud.setAmmo(gun.mag, gun.reserve);
  return true;
}

function shootAt(point) {
  aimAt(point);
  shoot(0);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function ownedMap() {
  const match = game.state;
  const owned = {
    p9: true,
    frag: match.grenades.frag > 0,
    smoke: match.grenades.smoke > 0,
    kevlar: match.hasKevlar,
    kit: match.hasKit,
  };
  if (match.primaryId !== null) owned[match.primaryId] = true;
  return owned;
}

function refreshHud() {
  const state = game.state;
  const objective = state.spike;
  hud.setHealth(state.playerHp, state.playerArmor);
  updateLoadoutHud();
  hud.setMoney(state.money);
  hud.setScore(state.scoreV, state.scoreJ, state.round);
  hud.refreshBuy(state.money, ownedMap());
  const planted = objective.state === 'planted';
  const clock = planted && state.phase !== 'buy' ? objective.timer : state.phaseTime;
  hud.setTimer(clock, planted);
  if (planted) {
    hud.setSpike('planted', objective.timer);
  } else if (state.phase !== 'live') {
    hud.setSpike('none');
  } else if (objective.carrier !== 'player') {
    hud.setSpike('carry', `with your squad — site ${objective.site}`);
  } else {
    const zone = objective.site === 'A' ? MAP.siteA : MAP.siteB;
    const separation = Math.hypot(zone.x - body.position.x, zone.z - body.position.z);
    hud.setSpike(separation < zone.r ? 'site' : 'carry', zone.name);
  }
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
  if (game.state.phase === 'menu' || game.state.phase === 'matchover') {
    game.resetMatch();
  }
  hud.hideOverlay();
  input.requestLock();
});

hud.onBuy((itemId) => {
  const purchase = game.buy(itemId);
  if (!purchase.ok) {
    audio.denied();
    hud.setHint(purchase.why);
    setTimeout(() => hud.setHint(''), 1500);
  } else {
    updateLoadoutHud();
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    paused = false;
    accumulator = 0;
    hud.hideOverlay();
    if (buyOpen) hud.showBuy(true);
  } else if (game.state.phase !== 'menu' && game.state.phase !== 'matchover' && game.state.playerAlive) {
    paused = true;
    hud.showOverlay('paused');
    hud.showBuy(false);
  }
}

function updateScope() {
  const gun = player.weapon;
  const nextScope = Boolean(input.state.firingAlt && gun.def.scoped && weaponReady(gun));
  if (scoped === nextScope) return;
  scoped = nextScope;
  camera.fov = scoped ? 32 : 74;
  camera.updateProjectionMatrix();
  hud.setScope(scoped);
}

function handleTrigger() {
  const held = input.state.firing;
  const pressedNow = held && !prevFiring;
  prevFiring = held;
  if (!held || game.state.phase !== 'live' || !game.state.playerAlive) return;
  const gun = player.weapon;
  if (!gun.def.auto && !pressedNow) return;
  if (!weaponReady(gun) && gun.mag > 0) return;
  shoot(weaponSpread(gun, player.groundSpeed(), scoped));
}

function updateLoadoutHud() {
  const { mag, reserve, def } = player.weapon;
  const { frag, smoke } = game.state.grenades;
  hud.setAmmo(mag, reserve, def.name);
  hud.setGrenades(frag, smoke);
}

function handleKeys(pressed) {
  const state = game.state;
  if (state.playerAlive) {
    if (pressed.has('KeyR') && weaponReload(player.weapon)) {
      viewReload = 1;
      audio.reload();
    }
    if (pressed.has('KeyQ')) game.switchWeapon();
    if (state.phase === 'live') {
      if (pressed.has('KeyG')) game.playerThrowGrenade('frag', camera);
      if (pressed.has('KeyT')) game.playerThrowGrenade('smoke', camera);
    }
  }
  if (pressed.has('KeyB') && state.phase === 'buy') {
    buyOpen = !buyOpen;
    hud.showBuy(buyOpen);
    hud.refreshBuy(state.money, ownedMap());
  }
  if (pressed.has('KeyM')) {
    muted = !muted;
    audio.setEnabled(!muted);
  }
  if (state.phase !== 'buy' || !buyOpen) return;
  for (let i = 0; i < BUY_KEYS.length; i++) {
    if (!pressed.has(`Digit${i + 1}`)) continue;
    if (game.buy(BUY_KEYS[i]).ok) updateLoadoutHud();
    else audio.denied();
  }
}

let plantingHint = false;
function handlePlant(dt) {
  const state = game.state;
  const { spike } = state;
  const carrying = spike.state === 'carried' && spike.carrier === 'player';
  const allowed = state.playerAlive && state.phase === 'live' && carrying;
  if (allowed) game.tryPlant(dt, input.state.keys.has('KeyE'));
  const showing = allowed && spike.plantProgress > 0;
  if (showing) {
    const remaining = Math.max(0, MAP.plantTime - spike.plantProgress);
    hud.setHint(`Planting… ${remaining.toFixed(1)}s — hold E`);
  } else if (plantingHint) {
    hud.setHint('');
  }
  plantingHint = showing;
}

function movePlayer(dt) {
  const { phase, playerAlive } = game.state;
  if (!playerAlive || (phase !== 'buy' && phase !== 'live')) return;
  const equipmentSpeed = player.weapon.def.speed / 5.4;
  player.step(dt, input.state.keys, equipmentSpeed * (scoped ? 0.45 : 1));
  stepAcc += dt * player.groundSpeed();
  if (stepAcc <= 2.4) return;
  stepAcc = 0;
  audio.step();
}

function animateViewmodel(dt) {
  viewRecoil = Math.max(viewRecoil - 6 * dt, 0);
  viewReload = Math.max(viewReload - 1.4 * dt, 0);
  const moving = game.state.playerAlive && player.groundSpeed() > 0.5;
  const bob = moving ? Math.sin(game.state.time * 11) * 0.008 : 0;
  viewmodel.position.set(0.3, -0.27 - 0.12 * viewReload + bob, -0.55 + 0.09 * viewRecoil);
  viewmodel.rotation.x = 0.7 * viewReload + 0.14 * viewRecoil;
}

function step(dt) {
  // This also runs without rendering in the screenshot and test drivers.
  scene.updateMatrixWorld(true);
  const { x, y } = input.takeLook();
  player.look(x, y, scoped ? 0.0009 : 0.0021);
  syncCamera();
  updateScope();
  handleTrigger();
  handleKeys(input.takePressed());
  handlePlant(dt);
  movePlayer(dt);
  game.step(dt, input);
  if (game.state.phase === 'live') bots.step(dt);
  effects.step(dt);
  animateViewmodel(dt);
  drainEvents();
  refreshHud();
  const spread = weaponSpread(player.weapon, player.groundSpeed(), scoped);
  hud.setCrosshair(4 + 240 * spread);
  syncCamera();
}

function frame(now) {
  const elapsed = Math.max(0, Math.min((now - lastTime) / 1000, 0.1));
  lastTime = now;
  if (!frozen && !paused) {
    accumulator += elapsed;
    for (let tick = 0; tick < 5 && accumulator >= FIXED_STEP; tick++) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
    if (accumulator > 5 * FIXED_STEP) accumulator = 0;
    syncCamera();
    hud.drawMinimap(now, body.position, body.yaw, bots.bots, game.state.spike);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function paintTwiceThenReady() {
  let framesLeft = 2;
  function paint() {
    syncCamera();
    renderer.render(scene, camera);
    framesLeft -= 1;
    if (framesLeft === 0) {
      frozen = true;
      window.__shotReady = true;
    } else {
      requestAnimationFrame(paint);
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
