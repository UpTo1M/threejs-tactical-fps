// SABLE LINE game state: one place holds the match. Rounds, money, the
// spike, grenades, the player's shots and every bot's damage all flow
// through here, so the HUD, the bots and the renderer never disagree.
import * as THREE from 'three';
import { MAP } from './world.js';
import {
  WEAPONS, GRENADES, GEAR,
  createWeaponState, weaponStep, weaponReady, weaponTakeRound,
  weaponReload, weaponRefill, weaponSpread,
} from './weapons.js';

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

  function emit(type, data) {
    events.push({ type, ...(data || {}) });
  }

  function siteCenter(site) {
    return site === 'A' ? MAP.siteA : MAP.siteB;
  }

  function currentWeapon() {
    return player.weapon;
  }

  function givePrimary(id) {
    state.primaryId = id;
    player.sidearm = createWeaponState(WEAPONS.p9);
    player.weapon = createWeaponState(WEAPONS[id]);
    player.weapon.mag = WEAPONS[id].mag;
    player.weapon.reserve = WEAPONS[id].reserve;
  }

  function resetMatch() {
    state.phase = 'buy';
    state.phaseTime = 0;
    state.round = 1;
    state.scoreV = 0;
    state.scoreJ = 0;
    state.lossStreak = 0;
    state.money = 800;
    state.kills = 0;
    state.deaths = 0;
    state.primaryId = null;
    state.grenades = { frag: 0, smoke: 0 };
    state.hasKevlar = false;
    state.hasKit = false;
    state.matchWinner = null;
    state.roundWinner = null;
    state.playerHp = 100;
    state.playerArmor = 0;
    player.sidearm = createWeaponState(WEAPONS.p9);
    player.weapon = player.sidearm;
    startRound();
  }

  function startRound() {
    state.phase = 'buy';
    state.phaseTime = MAP.buyTime;
    state.playerAlive = true;
    state.playerHp = 100;
    state.playerArmor = state.hasKevlar ? 100 : 0;
    state.spike.state = 'carried';
    state.spike.carrier = 'player';
    state.spike.site = Math.random() < 0.5 ? 'A' : 'B';
    state.spike.timer = 0;
    state.spike.plantProgress = 0;
    state.spike.defuseProgress = 0;
    state.spike.defuser = null;
    projectiles.length = 0;
    // loadout persists; ammo refills every round
    if (player) {
      weaponRefill(player.weapon);
      if (player.sidearm) weaponRefill(player.sidearm);
    }
    if (botsApi) botsApi.resetRound(state.round);
    emit('roundStart', { round: state.round, site: state.spike.site });
  }

  function endRound(winner, reason) {
    if (state.phase === 'over' || state.phase === 'matchover') return;
    state.phase = 'over';
    state.phaseTime = 4.5;
    state.roundWinner = winner;
    state.roundReason = reason;
    if (winner === 'V') {
      state.scoreV += 1;
      state.money += 3250;
      state.lossStreak = 0;
      audio.roundWin();
    } else {
      state.scoreJ += 1;
      state.money += 1900 + Math.min(1500, state.lossStreak * 500);
      state.lossStreak += 1;
      audio.roundLose();
    }
    emit('roundEnd', { winner, reason, scoreV: state.scoreV, scoreJ: state.scoreJ, money: state.money });
  }

  function nextRound() {
    if (state.scoreV >= 5 || state.scoreJ >= 5 || state.round >= 9) {
      state.phase = 'matchover';
      state.matchWinner = state.scoreV > state.scoreJ ? 'V' : state.scoreJ > state.scoreV ? 'J' : 'draw';
      emit('matchEnd', { winner: state.matchWinner, scoreV: state.scoreV, scoreJ: state.scoreJ });
      return;
    }
    state.round += 1;
    startRound();
  }

  // --- damage ---
  function damagePlayer(amount, fromPos) {
    if (!state.playerAlive || state.phase !== 'live') return;
    let rest = amount;
    if (state.playerArmor > 0) {
      const absorbed = Math.min(state.playerArmor, rest * 0.5);
      state.playerArmor -= absorbed;
      rest -= absorbed;
    }
    state.playerHp -= rest;
    audio.hurt();
    emit('playerHurt', { hp: state.playerHp, from: fromPos ? { x: fromPos.x, z: fromPos.z } : null });
    if (state.playerHp <= 0) {
      state.playerHp = 0;
      state.playerAlive = false;
      state.deaths += 1;
      // the spike passes to the nearest living Vanguard bot
      if (state.spike.state === 'carried' && state.spike.carrier === 'player' && botsApi) {
        const carrier = botsApi.nearestAliveAlly(player.mover.body.position);
        if (carrier) {
          carrier.hasSpike = true;
          state.spike.carrier = carrier;
          emit('spikePassed', { name: carrier.name });
        }
      }
      emit('playerDied', {});
    }
  }

  function damageBot(bot, amount, part, attacker) {
    if (!bot.alive) return;
    const dmg = part === 'head' ? amount * 2 : amount;
    bot.hp -= dmg;
    bot.damageFlash = 0.35;
    // planting / defusing is interrupted by damage
    if (bot.state === 'plant') {
      bot.plantProgress = 0;
      bot.state = 'move';
    }
    if (bot.state === 'defuse') {
      bot.defuseProgress = 0;
      bot.state = 'move';
    }
    if (bot.hp <= 0) {
      bot.hp = 0;
      botsApi.kill(bot);
      emit('kill', { victim: bot.name, victimTeam: bot.team, byPlayer: attacker === 'player', headshot: part === 'head' });
      if (attacker === 'player') {
        state.kills += 1;
        state.money += 300;
        audio.hit(true);
      }
    } else if (attacker === 'player') {
      audio.hit(false);
    }
  }

  // --- player shooting ---
  function playerShoot(camera, spread) {
    const w = player.weapon;
    if (!weaponReady(w)) return false;
    if (w.mag <= 0) {
      audio.dryFire();
      weaponReload(w);
      return false;
    }
    if (!weaponTakeRound(w)) return false;
    camera.getWorldDirection(tmpDir);
    tmpDir.x += (Math.random() * 2 - 1) * spread;
    tmpDir.y += (Math.random() * 2 - 1) * spread;
    tmpDir.z += (Math.random() * 2 - 1) * spread;
    tmpDir.normalize();
    raycaster.set(camera.position, tmpDir);
    const targets = shootables.concat(botsApi ? botsApi.hitMeshes() : []);
    const hits = raycaster.intersectObjects(targets, false);
    // First solid hit wins; friendly bots are never a target — the bullet
    // flies on past them to whatever is behind.
    let hit = null;
    for (const candidate of hits) {
      if (candidate.object.userData && candidate.object.userData.bot && candidate.object.userData.bot.team === 'V') continue;
      hit = candidate;
      break;
    }
    // muzzle world position (camera + small offset)
    camera.getWorldPosition(muzzleWorld);
    muzzleWorld.addScaledVector(tmpDir, 0.6);
    muzzleWorld.y -= 0.12;
    let endPoint = null;
    if (hit) {
      endPoint = hit.point;
      if (hit.object.userData && hit.object.userData.bot) {
        const bot = hit.object.userData.bot;
        const part = hit.object.userData.part;
        const dist = camera.position.distanceTo(hit.point);
        const falloff = dist < 20 ? 1 : Math.max(0.65, 1 - (dist - 20) * 0.006);
        const dmg = w.def.damage * falloff * (part === 'head' ? w.def.headMult : 1);
        damageBot(bot, dmg, part, 'player');
        effects.burstParticles(hit.point, 10, new THREE.Color(0xc22e2e), 3);
      } else {
        effects.burstParticles(hit.point, 8, new THREE.Color(0xd8cdb8), 3.5);
      }
    } else {
      endPoint = tmpTo.copy(camera.position).addScaledVector(tmpDir, 60);
    }
    effects.addTracer(muzzleWorld, endPoint);
    effects.muzzle();
    audio.shot(w.def.sound, 0);
    if (botsApi) botsApi.hearShot({ x: camera.position.x, z: camera.position.z }, 'V');
    return true;
  }

  function playerThrowGrenade(kind, camera) {
    if (state.grenades[kind] <= 0) return false;
    state.grenades[kind] -= 1;
    camera.getWorldDirection(tmpDir);
    const pos = camera.position.clone();
    pos.addScaledVector(tmpDir, 0.5);
    pos.y -= 0.15;
    projectiles.push({
      kind,
      pos,
      vel: tmpDir.clone().multiplyScalar(17).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: kind === 'frag' ? 1.6 : 1.1,
      alive: true,
    });
    audio.grenadeThrow();
    emit('grenadeThrown', { kind, left: state.grenades[kind] });
    return true;
  }

  function explodeFrag(pos) {
    effects.explosion(pos, 5);
    audio.explosion(player.mover.body.position.distanceTo(pos));
    // damage everyone in radius with line of sight
    const radius = 7;
    const victims = [];
    if (state.playerAlive) victims.push({ kind: 'player', pos: player.mover.body.position });
    if (botsApi) for (const b of botsApi.bots) if (b.alive) victims.push({ kind: 'bot', bot: b, pos: b.mover.body.position });
    for (const v of victims) {
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z) + Math.abs((v.pos.y + 1) - pos.y) * 0.4;
      if (d > radius) continue;
      tmpFrom.set(pos.x, pos.y + 0.3, pos.z);
      tmpTo.set(v.pos.x, v.pos.y + 1.2, v.pos.z);
      const dist = tmpFrom.distanceTo(tmpTo);
      raycaster.set(tmpFrom, tmpTo.sub(tmpFrom).normalize());
      const hits = raycaster.intersectObjects(shootables, false);
      if (hits.length && hits[0].distance < dist - 0.5) continue; // behind cover
      const dmg = 140 * Math.max(0.15, 1 - d / radius);
      if (v.kind === 'player') damagePlayer(dmg, pos);
      else damageBot(v.bot, dmg, 'body', 'player');
    }
    checkRoundEnd();
  }

  function stepProjectiles(dt) {
    for (const p of projectiles) {
      if (!p.alive) continue;
      p.fuse -= dt;
      p.vel.y -= 14 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.12) {
        p.pos.y = 0.12;
        p.vel.y = Math.abs(p.vel.y) > 1.5 ? -p.vel.y * 0.35 : 0;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
      }
      if (p.pos.x < -19.6 || p.pos.x > 19.6) p.vel.x *= -0.4;
      if (p.pos.z < -15.6 || p.pos.z > 15.6) p.vel.z *= -0.4;
      if (p.fuse <= 0) {
        p.alive = false;
        if (p.kind === 'frag') explodeFrag(p.pos);
        else effects.smoke(p.pos.x, p.pos.y, p.pos.z);
      }
    }
  }

  // --- spike ---
  function tryPlant(dt, holding) {
    const site = siteCenter(state.spike.site);
    const p = player.mover.body.position;
    const inside = Math.hypot(p.x - site.x, p.z - site.z) < site.r;
    if (!holding || !inside || !state.playerAlive) {
      if (state.spike.plantProgress > 0) state.spike.plantProgress = 0;
      return;
    }
    state.spike.plantProgress += dt;
    if (state.spike.plantProgress >= MAP.plantTime) {
      state.spike.plantProgress = 0;
      state.spike.state = 'planted';
      state.spike.pos.set(site.x, 0, site.z);
      state.spike.timer = MAP.spikeTime;
      state.money += 300;
      audio.plant();
      emit('spikePlanted', { site: state.spike.site });
    }
  }

  function checkRoundEnd() {
    if (state.phase !== 'live') return;
    const vAlive = (state.playerAlive ? 1 : 0) + (botsApi ? botsApi.aliveCount('V') : 0);
    const jAlive = botsApi ? botsApi.aliveCount('J') : 0;
    if (state.spike.state === 'planted') {
      if (jAlive === 0) endRound('V', 'Spike site cleared — detonation imminent');
      return; // defenders must defuse or the timer decides
    }
    if (jAlive === 0) endRound('V', 'Enemy team eliminated');
    else if (vAlive === 0) endRound('J', 'Your team was eliminated');
  }

  // --- buying ---
  function buy(itemId) {
    if (state.phase !== 'buy') return { ok: false, why: 'Buy phase is over' };
    const all = { ...WEAPONS, ...GRENADES, ...GEAR };
    const item = all[itemId];
    if (!item) return { ok: false, why: 'Unknown item' };
    if (itemId === 'p9') return { ok: false, why: 'The P9 is already yours' };
    if (WEAPONS[itemId]) {
      if (state.primaryId === itemId) return { ok: false, why: 'Already owned' };
      if (state.money < item.price) return { ok: false, why: 'Not enough money' };
      state.money -= item.price;
      givePrimary(itemId);
    } else if (GRENADES[itemId]) {
      if (state.grenades[itemId] >= 1) return { ok: false, why: 'Already carrying one' };
      if (state.money < item.price) return { ok: false, why: 'Not enough money' };
      state.money -= item.price;
      state.grenades[itemId] = 1;
    } else if (itemId === 'kevlar') {
      if (state.hasKevlar) return { ok: false, why: 'Already wearing kevlar' };
      if (state.money < item.price) return { ok: false, why: 'Not enough money' };
      state.money -= item.price;
      state.hasKevlar = true;
      state.playerArmor = 100;
    } else if (itemId === 'kit') {
      if (state.hasKit) return { ok: false, why: 'Already carrying a kit' };
      if (state.money < item.price) return { ok: false, why: 'Not enough money' };
      state.money -= item.price;
      state.hasKit = true;
    }
    audio.buy();
    emit('bought', { item: itemId, money: state.money });
    return { ok: true };
  }

  function switchWeapon() {
    if (!state.primaryId || !player.sidearm) return;
    const tmp = player.weapon;
    player.weapon = player.sidearm;
    player.sidearm = tmp;
    emit('weaponSwitched', { name: player.weapon.def.name });
  }

  // --- per-frame simulation (fixed step) ---
  function step(dt, input) {
    state.time += dt;
    if (state.phase === 'buy') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) {
        state.phase = 'live';
        state.phaseTime = MAP.roundTime;
        emit('roundLive', {});
      }
    } else if (state.phase === 'live') {
      state.phaseTime -= dt;
      // spike timer
      if (state.spike.state === 'planted') {
        state.spike.timer -= dt;
        if (Math.ceil(state.spike.timer * 2) !== Math.ceil((state.spike.timer + dt) * 2)) {
          if (state.spike.timer < 10) audio.beep(state.spike.timer < 3);
        }
        if (state.spike.timer <= 0) {
          effects.explosion(state.spike.pos, 8);
          audio.explosion(player.mover.body.position.distanceTo(state.spike.pos));
          endRound('V', 'Spike detonated');
          return;
        }
      }
      if (state.phaseTime <= 0 && state.spike.state !== 'planted') {
        endRound(state.spike.state === 'planted' ? 'V' : 'J', state.spike.state === 'planted' ? 'Spike detonated' : 'Time expired — spike never planted');
        return;
      }
      checkRoundEnd();
    } else if (state.phase === 'over') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) nextRound();
    }
    stepProjectiles(dt);
    if (player) {
      weaponStep(player.weapon, dt);
      if (player.sidearm) weaponStep(player.sidearm, dt);
    }
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
      if (state.spike.state !== 'carried') return;
      state.spike.state = 'planted';
      state.spike.pos.set(bot.mover.body.position.x, 0, bot.mover.body.position.z);
      state.spike.timer = MAP.spikeTime;
      state.money += 300;
      audio.plant();
      emit('spikePlanted', { site: state.spike.site, by: bot.name });
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
