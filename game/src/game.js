// SABLE LINE game state: one place holds the match. Rounds, money, the
// spike, grenades, the player's shots and every bot's damage all flow
// through here, so the HUD, the bots and the renderer never disagree.
import * as THREE from 'three';
import { MAP } from './world.js';
import {
  WEAPONS, GRENADES, GEAR, createWeaponState, weaponStep,
  weaponReady, weaponTakeRound, weaponReload, weaponRefill,
} from './weapons.js';

const ROUND_REWARD = 3250;
const KILL_REWARD = 300;
const PLANT_REWARD = 300;
const CATALOGUE = { ...WEAPONS, ...GRENADES, ...GEAR };

export function createGame(opts) {
  const { scene, colliders, shootables, effects, audio } = opts;
  const raycaster = new THREE.Raycaster();
  raycaster.far = 95;
  const events = [];
  const tmpDir = new THREE.Vector3();
  const tmpFrom = new THREE.Vector3();
  const tmpTo = new THREE.Vector3();

  const state = {
    phase: 'menu', // menu | buy | live | over | matchover
    phaseTime: 0,
    round: 1,
    scoreV: 0,
    scoreJ: 0,
    lossStreak: 0,
    money: 800,
    kills: 0,
    deaths: 0,
    playerAlive: true,
    playerHp: 100,
    playerArmor: 0,
    hasKevlar: false,
    hasKit: false,
    primaryId: null, // null = sidearm only
    grenades: { frag: 0, smoke: 0 },
    spike: {
      state: 'carried', // carried | planted | dropped
      carrier: 'player', // 'player' or a bot
      site: 'A',
      pos: new THREE.Vector3(0, 0, 0),
      timer: 0,
      plantProgress: 0,
      defuseProgress: 0,
      defuser: null,
    },
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    time: 0,
  };

  let player = null; // set by main: { mover, weapon, ... }
  let botsApi = null; // set by main
  const projectiles = [];
  const muzzleWorld = new THREE.Vector3();

  // --- planted spike device: a visible, blinking charge on the ground ---
  // The spike used to be state only — defenders had nothing to look at.
  // Now it is a dark charge with a hot orange core, an aerial and a red
  // beacon light, plus a pulsing ring on the asphalt, so a planted site
  // reads instantly from across the yard. Visual only: no collider, never
  // a raycast target.
  const spikeGroup = new THREE.Group();
  {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.26, 0.36),
      new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.45, metalness: 0.65, emissive: 0xff5a1e, emissiveIntensity: 0.55 }),
    );
    body.position.y = 0.13;
    body.castShadow = true;
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.1, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xff7a2e }),
    );
    core.position.y = 0.29;
    const aerial = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.85, 6),
      new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6, metalness: 0.5 }),
    );
    aerial.position.set(0.2, 0.62, 0);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.05, 1.3, 32),
      new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    spikeGroup.add(body, core, aerial, ring);
    spikeGroup.visible = false;
    scene.add(spikeGroup);
  }
  const spikeRing = spikeGroup.children[3];
  const spikeLight = new THREE.PointLight(0xff5a1e, 0, 14, 1.7);
  scene.add(spikeLight);

  function emit(type, data) {
    events.push({ type, ...(data || {}) });
  }

  function siteCenter(site) {
    return site === 'A' ? MAP.siteA : MAP.siteB;
  }

  function givePrimary(id) {
    state.primaryId = id;
    player.sidearm = createWeaponState(WEAPONS.p9);
    player.weapon = createWeaponState(WEAPONS[id]);
  }

  function resetMatch() {
    Object.assign(state, {
      round: 1,
      scoreV: 0,
      scoreJ: 0,
      lossStreak: 0,
      money: 800,
      kills: 0,
      deaths: 0,
      primaryId: null,
      hasKevlar: false,
      hasKit: false,
      matchWinner: null,
      grenades: { frag: 0, smoke: 0 },
    });
    events.length = 0;
    player.sidearm = createWeaponState(WEAPONS.p9);
    player.weapon = player.sidearm;
    startRound();
  }

  function startRound() {
    Object.assign(state, {
      phase: 'buy',
      phaseTime: MAP.buyTime,
      playerAlive: true,
      playerHp: 100,
      playerArmor: state.hasKevlar ? 100 : 0,
      roundWinner: null,
      roundReason: '',
    });
    Object.assign(state.spike, {
      state: 'carried',
      carrier: 'player',
      site: Math.random() < 0.5 ? 'A' : 'B',
      timer: 0,
      plantProgress: 0,
      defuseProgress: 0,
      defuser: null,
    });
    projectiles.length = 0;
    spikeGroup.visible = false;
    spikeLight.intensity = 0;
    // Surviving purchases carry over; ammunition is renewed in both slots.
    for (const slot of [player?.weapon, player?.sidearm]) {
      if (slot) weaponRefill(slot);
    }
    botsApi?.resetRound(state.round);
    emit('roundStart', { round: state.round, site: state.spike.site });
  }

  function endRound(winner, reason) {
    if (['over', 'matchover'].includes(state.phase)) return;
    Object.assign(state, {
      phase: 'over',
      phaseTime: 4.5,
      roundWinner: winner,
      roundReason: reason,
    });
    spikeGroup.visible = false;
    spikeLight.intensity = 0;
    const won = winner === 'V';
    const payout = won ? ROUND_REWARD : 1900 + Math.min(state.lossStreak, 3) * 500;
    state.money += payout;
    state[won ? 'scoreV' : 'scoreJ'] += 1;
    state.lossStreak = won ? 0 : state.lossStreak + 1;
    if (won) audio.roundWin();
    else audio.roundLose();
    emit('roundEnd', {
      winner,
      reason,
      money: state.money,
      scoreV: state.scoreV,
      scoreJ: state.scoreJ,
    });
  }

  function nextRound() {
    const finished = Math.max(state.scoreV, state.scoreJ) >= 5 || state.round >= 9;
    if (!finished) {
      state.round += 1;
      startRound();
      return;
    }
    state.phase = 'matchover';
    const lead = state.scoreV - state.scoreJ;
    state.matchWinner = lead > 0 ? 'V' : lead < 0 ? 'J' : 'draw';
    emit('matchEnd', {
      winner: state.matchWinner,
      scoreV: state.scoreV,
      scoreJ: state.scoreJ,
    });
  }

  // --- damage ---
  function damagePlayer(amount, fromPos) {
    if (state.phase !== 'live' || !state.playerAlive) return;
    const armorDamage = Math.min(amount * 0.5, state.playerArmor);
    state.playerArmor -= armorDamage;
    state.playerHp = Math.max(state.playerHp - amount + armorDamage, 0);
    audio.hurt();
    emit('playerHurt', {
      hp: state.playerHp,
      from: fromPos ? { x: fromPos.x, z: fromPos.z } : null,
    });
    if (state.playerHp > 0) return;
    state.playerAlive = false;
    state.deaths += 1;
    const charge = state.spike;
    if (charge.state === 'carried' && charge.carrier === 'player') {
      const ally = botsApi?.nearestAliveAlly(player.mover.body.position);
      if (ally) {
        ally.hasSpike = true;
        charge.carrier = ally;
        emit('spikePassed', { name: ally.name });
      }
    }
    emit('playerDied');
  }

  function damageBot(bot, amount, part, attacker) {
    if (!bot.alive) return;
    const headshot = part === 'head';
    const byPlayer = attacker === 'player';
    bot.hp = Math.max(bot.hp - amount * (headshot ? 2 : 1), 0);
    bot.damageFlash = 0.35;
    if (['plant', 'defuse'].includes(bot.state)) {
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.state = 'move';
    }
    if (bot.hp > 0) {
      if (byPlayer) audio.hit(false);
      return;
    }
    botsApi.kill(bot);
    emit('kill', { victim: bot.name, victimTeam: bot.team, byPlayer, headshot });
    if (byPlayer) {
      state.kills += 1;
      state.money += KILL_REWARD;
      audio.hit(true);
    }
  }

  // --- player shooting ---
  const impactBlood = new THREE.Color(0xc22e2e);
  const impactDust = new THREE.Color(0xd8cdb8);
  const shotTargets = [];
  const shotHits = [];

  function playerShoot(camera, spread) {
    const gun = player.weapon;
    if (!state.playerAlive || state.phase !== 'live' || !weaponReady(gun)) return false;
    if (gun.mag < 1) {
      audio.dryFire();
      weaponReload(gun);
      return false;
    }
    if (!weaponTakeRound(gun)) return false;
    camera.getWorldDirection(tmpDir);
    tmpDir.x += (Math.random() * 2 - 1) * spread;
    tmpDir.y += (Math.random() * 2 - 1) * spread;
    tmpDir.z += (Math.random() * 2 - 1) * spread;
    tmpDir.normalize();
    raycaster.set(camera.position, tmpDir);
    shotTargets.length = 0;
    for (const wall of shootables) shotTargets.push(wall);
    if (botsApi) {
      for (const mesh of botsApi.hitMeshes()) shotTargets.push(mesh);
    }
    shotHits.length = 0;
    raycaster.intersectObjects(shotTargets, false, shotHits);
    tmpTo.copy(camera.position).addScaledVector(tmpDir, 60);
    // Raycaster orders cover and hitboxes together. Ignore allied hitboxes.
    for (const intersection of shotHits) {
      const { bot, part } = intersection.object.userData;
      if (bot?.team === 'V') continue;
      tmpTo.copy(intersection.point);
      if (!bot) {
        effects.burstParticles(tmpTo, 8, impactDust, 3.5);
      } else {
        const beyondNearRange = Math.max(camera.position.distanceTo(tmpTo) - 20, 0);
        const falloff = Math.max(1 - beyondNearRange * 0.006, 0.65);
        const hitScale = part === 'head' ? gun.def.headMult : 1;
        damageBot(bot, gun.def.damage * falloff * hitScale, part, 'player');
        effects.burstParticles(tmpTo, 10, impactBlood, 3);
      }
      break;
    }
    camera.getWorldPosition(muzzleWorld).addScaledVector(tmpDir, 0.6);
    muzzleWorld.y -= 0.12;
    effects.addTracer(muzzleWorld, tmpTo);
    effects.muzzle();
    audio.shot(gun.def.sound, 0);
    botsApi?.hearShot(camera.position, 'V');
    return true;
  }

  function playerThrowGrenade(kind, camera) {
    if (!state.playerAlive || state.phase !== 'live') return false;
    const stocked = Object.hasOwn(GRENADES, kind) && state.grenades[kind] > 0;
    if (!stocked) return false;
    camera.getWorldDirection(tmpDir);
    const position = camera.position.clone().addScaledVector(tmpDir, 0.5);
    const velocity = tmpDir.clone().multiplyScalar(17);
    position.y -= 0.15;
    velocity.y += 4.5;
    projectiles.push({
      kind,
      pos: position,
      vel: velocity,
      fuse: kind === 'frag' ? 1.6 : 1.1,
    });
    state.grenades[kind] -= 1;
    emit('grenadeThrown', { kind, left: state.grenades[kind] });
    audio.grenadeThrow();
    return true;
  }

  function explodeFrag(pos) {
    effects.explosion(pos, 5);
    audio.explosion(player.mover.body.position.distanceTo(pos));
    if (state.playerAlive) {
      const damage = blastDamage(pos, player.mover.body.position);
      if (damage > 0) damagePlayer(damage, pos);
    }
    for (const bot of botsApi?.bots ?? []) {
      if (!bot.alive) continue;
      const damage = blastDamage(pos, bot.mover.body.position);
      if (damage > 0) damageBot(bot, damage, 'body', 'player');
    }
    checkRoundEnd();
  }

  function blastDamage(origin, victim) {
    const horizontal = Math.hypot(origin.x - victim.x, origin.z - victim.z);
    const weightedHeight = Math.abs(origin.y - victim.y - 1) * 0.4;
    const radiusDistance = horizontal + weightedHeight;
    if (radiusDistance > 7) return 0;
    tmpFrom.set(origin.x, origin.y + 0.3, origin.z);
    tmpTo.set(victim.x, victim.y + 1.2, victim.z);
    tmpDir.subVectors(tmpTo, tmpFrom);
    const targetDistance = tmpDir.length();
    raycaster.set(tmpFrom, tmpDir.normalize());
    shotHits.length = 0;
    raycaster.intersectObjects(shootables, false, shotHits);
    if (shotHits.length && shotHits[0].distance < targetDistance - 0.5) return 0;
    return 140 * Math.max(1 - radiusDistance / 7, 0.15);
  }

  function bounceBoundary(grenade, axis, extent) {
    const coordinate = grenade.pos[axis];
    if (coordinate >= -extent && coordinate <= extent) return;
    grenade.pos[axis] = coordinate < 0 ? -extent : extent;
    grenade.vel[axis] *= -0.4;
  }

  function stepProjectiles(seconds) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const projectile = projectiles[i];
      const { pos, vel } = projectile;
      projectile.fuse -= seconds;
      vel.y -= seconds * 14;
      pos.addScaledVector(vel, seconds);
      if (pos.y < 0.12) {
        pos.y = 0.12;
        vel.y = Math.abs(vel.y) > 1.5 ? -vel.y * 0.35 : 0;
        vel.x *= 0.6;
        vel.z *= 0.6;
      }
      bounceBoundary(projectile, 'x', 19.6);
      bounceBoundary(projectile, 'z', 15.6);
      if (projectile.fuse > 0) continue;
      if (projectile.kind === 'smoke') {
        effects.smoke(pos.x, pos.y, pos.z);
      } else {
        explodeFrag(pos);
      }
      projectiles.splice(i, 1);
    }
  }

  // --- spike ---
  function plantAt(x, z, planter) {
    const charge = state.spike;
    if (charge.state !== 'carried') return;
    Object.assign(charge, {
      state: 'planted',
      timer: MAP.spikeTime,
      plantProgress: 0,
      defuseProgress: 0,
      defuser: null,
    });
    charge.pos.set(x, 0, z);
    state.money += PLANT_REWARD;
    audio.plant();
    emit('spikePlanted', { site: charge.site, ...(planter ? { by: planter } : {}) });
  }

  function tryPlant(dt, holding) {
    const charge = state.spike;
    const site = siteCenter(charge.site);
    const position = player.mover.body.position;
    const inZone = Math.hypot(position.x - site.x, position.z - site.z) < site.r;
    if (!holding || !inZone || !state.playerAlive || state.phase !== 'live'
      || charge.state !== 'carried' || charge.carrier !== 'player') {
      charge.plantProgress = 0;
      return;
    }
    charge.plantProgress += dt;
    if (charge.plantProgress >= MAP.plantTime) plantAt(site.x, site.z);
  }

  function checkRoundEnd() {
    if (state.phase !== 'live') return;
    const attackers = Number(state.playerAlive) + (botsApi?.aliveCount('V') ?? 0);
    const defenders = botsApi?.aliveCount('J') ?? 0;
    const planted = state.spike.state === 'planted';
    if (defenders === 0) {
      endRound('V', planted ? 'Spike site cleared — detonation imminent' : 'Enemy team eliminated');
    } else if (attackers === 0 && !planted) {
      endRound('J', 'Your team was eliminated');
    }
  }

  // --- buying ---
  function buy(itemId) {
    if (state.phase !== 'buy') return { ok: false, why: 'Buy phase is over' };
    if (!Object.hasOwn(CATALOGUE, itemId)) return { ok: false, why: 'Unknown item' };
    const item = CATALOGUE[itemId];
    if (itemId === 'p9') return { ok: false, why: 'The P9 is already yours' };
    if (state.primaryId === itemId) return { ok: false, why: 'Already owned' };
    const grenade = Object.hasOwn(GRENADES, itemId);
    if (grenade && state.grenades[itemId] > 0) return { ok: false, why: 'Already carrying one' };
    if (itemId === 'kevlar' && state.hasKevlar) return { ok: false, why: 'Already wearing kevlar' };
    if (itemId === 'kit' && state.hasKit) return { ok: false, why: 'Already carrying a kit' };
    if (state.money < item.price) return { ok: false, why: 'Not enough money' };

    // Cash changes only after every inventory restriction has passed.
    if (Object.hasOwn(WEAPONS, itemId)) {
      givePrimary(itemId);
    } else if (grenade) {
      state.grenades[itemId] = 1;
    } else if (itemId === 'kevlar') {
      state.hasKevlar = true;
      state.playerArmor = 100;
    } else {
      state.hasKit = true;
    }
    state.money -= item.price;
    audio.buy();
    emit('bought', { item: itemId, money: state.money });
    return { ok: true };
  }

  function switchWeapon() {
    if (!state.primaryId || !player.sidearm) return;
    [player.weapon, player.sidearm] = [player.sidearm, player.weapon];
    emit('weaponSwitched', { name: player.weapon.def.name });
  }

  // --- per-frame simulation (fixed step) ---
  function advanceLiveRound(seconds) {
    const charge = state.spike;
    state.phaseTime -= seconds;
    if (charge.state !== 'planted') {
      if (state.phaseTime <= 0) endRound('J', 'Time expired — spike never planted');
      else checkRoundEnd();
      return;
    }
    const previousBeat = Math.ceil(charge.timer * 2);
    charge.timer -= seconds;
    const beat = Math.ceil(charge.timer * 2);
    if (beat !== previousBeat && charge.timer < 10) audio.beep(charge.timer < 3);
    if (charge.timer > 0) {
      checkRoundEnd();
      return;
    }
    effects.explosion(charge.pos, 8);
    audio.explosion(player.mover.body.position.distanceTo(charge.pos));
    endRound('V', 'Spike detonated');
  }

  function updateChargeModel() {
    const charge = state.spike;
    const active = state.phase === 'live' && charge.state === 'planted';
    spikeGroup.visible = active;
    if (!active) {
      spikeLight.intensity = 0;
      return;
    }
    spikeGroup.position.set(charge.pos.x, 0, charge.pos.z);
    spikeLight.position.set(charge.pos.x, 1.2, charge.pos.z);
    const bright = Math.sin(6 * state.time) > 0;
    spikeLight.intensity = bright ? 22 : 8;
    spikeRing.material.opacity = bright ? 0.65 : 0.45;
    spikeRing.scale.setScalar(Math.sin(3 * state.time) * 0.15 + 1);
  }

  function step(seconds) {
    state.time += seconds;
    switch (state.phase) {
      case 'buy':
        state.phaseTime -= seconds;
        if (state.phaseTime <= 0) {
          state.phase = 'live';
          state.phaseTime = MAP.roundTime;
          emit('roundLive');
        }
        break;
      case 'live':
        advanceLiveRound(seconds);
        break;
      case 'over':
        state.phaseTime -= seconds;
        if (state.phaseTime <= 0) nextRound();
        break;
    }
    stepProjectiles(seconds);
    if (player !== null) {
      weaponStep(player.weapon, seconds);
      if (player.sidearm) weaponStep(player.sidearm, seconds);
    }
    updateChargeModel();
  }

  return {
    state,
    events,
    setPlayer(p) {
      player = p;
    },
    setBotsApi(api) {
      botsApi = api;
    },
    resetMatch,
    startRound,
    nextRound,
    damagePlayer,
    damageBot,
    playerShoot,
    playerThrowGrenade,
    tryPlant,
    buy,
    switchWeapon,
    checkRoundEnd,
    step,
    // bot API surface
    spikePlanted() {
      return state.spike.state === 'planted';
    },
    spikePos() {
      return state.spike.pos;
    },
    spikeSite() {
      return siteCenter(state.spike.site);
    },
    spikePlantedBy(bot) {
      const { x, z } = bot.mover.body.position;
      plantAt(x, z, bot.name);
    },
    spikeDefusedBy(bot) {
      if (state.spike.state !== 'planted') return;
      state.spike.state = 'carried';
      endRound('J', `${bot.name} defused the spike`);
    },
    botPlanting(bot, progress) {
      state.spike.plantProgress = progress;
      if (progress > 0) emit('botPlanting', { name: bot.name, progress });
    },
    botDefusing(bot, progress) {
      state.spike.defuseProgress = progress;
      state.spike.defuser = bot.name;
      emit('botDefusing', { name: bot.name, progress });
    },
  };
}
