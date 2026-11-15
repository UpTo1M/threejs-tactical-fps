// Bots: waypoint-graph navigation, line-of-sight combat, hearing, roles,
// spike plant/defuse and retakes. One module, one job: decide what each bot
// does; the caller (main.js) owns damage, the spike and the round.
import * as THREE from 'three';
import { createMover } from './player.js';
import { WAYPOINTS, EDGES, MAP } from './world.js';
import { WEAPONS, createWeaponState } from './weapons.js';

const VANGUARD_NAMES = ['Rook', 'Heron', 'Fable', 'Moss'];
const JACKAL_NAMES = ['Vex', 'Dagger', 'Bramble', 'Slate', 'Wick'];
const BOT_SPEED = 4.3;

// BFS over the waypoint graph; returns node indices from start to goal.
const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}
export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const dx = WAYPOINTS[i][0] - x;
    const dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
export function findPath(fromNode, toNode, avoid = []) {
  if (fromNode === toNode) return [toNode];
  const avoidSet = new Set(avoid);
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [fromNode];
  prev[fromNode] = fromNode;
  while (queue.length) {
    const n = queue.shift();
    for (const m of ADJ[n]) {
      if (prev[m] !== -1) continue;
      if (avoidSet.has(m) && m !== toNode) continue;
      prev[m] = n;
      if (m === toNode) {
        const path = [m];
        let cur = n;
        while (cur !== fromNode) {
          path.unshift(cur);
          cur = prev[cur];
        }
        return path;
      }
      queue.push(m);
    }
  }
  return [toNode];
}

function makeNameSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = '600 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.9)';
  g.shadowBlur = 8;
  g.fillStyle = color;
  g.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.5, 0.38, 1);
  return sprite;
}

function makeBotMesh(team, name) {
  const group = new THREE.Group();
  const teamColor = team === 'V' ? 0x3fb8a6 : 0xe07830;
  const cloth = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6f56, roughness: 0.8 });
  // legs
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.18), dark);
  legL.position.set(-0.11, 0.39, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  // torso (vest)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), cloth);
  torso.position.y = 1.09;
  // arms
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.15), cloth);
  armL.position.set(-0.33, 1.12, 0.08);
  armL.rotation.x = -0.7;
  const armR = armL.clone();
  armR.position.x = 0.33;
  // head + helmet
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skin);
  head.position.y = 1.56;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.185, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
  helmet.position.y = 1.58;
  // rifle
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.85), dark);
  gun.position.set(0.12, 1.22, 0.42);
  group.add(legL, legR, torso, armL, armR, head, helmet, gun);
  const tag = makeNameSprite(name, team === 'V' ? '#7fe0d2' : '#ffb37a');
  tag.position.y = 2.05;
  group.add(tag);
  group.traverse((o) => {
    o.castShadow = true;
  });
  return { group, torso, head, gun, tag, cloth };
}

export function createBots(scene, colliders, api) {
  const bots = [];
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();

  function addBot(team, name, role, site) {
    const spawn = team === 'V' ? MAP.attackerSpawn : MAP.defenderSpawn;
    const mover = createMover(colliders, { x: spawn.x + (Math.random() - 0.5) * 3, z: spawn.z + (Math.random() - 0.5) * 1.5, yaw: spawn.yaw });
    const mesh = makeBotMesh(team, name);
    scene.add(mesh.group);
    const weaponDef = role === 'sniper' ? WEAPONS.lancer : role === 'rusher' ? WEAPONS.vk9 : WEAPONS.ar77;
    const bot = {
      id: bots.length,
      team,
      name,
      role,
      site,
      mover,
      mesh,
      weapon: createWeaponState(weaponDef),
      hp: 100,
      armor: 0,
      alive: true,
      state: 'move',
      path: [],
      pathIndex: 0,
      holdNode: -1,
      target: null, // {kind:'player'|'bot', ref, pos}
      lastSeen: null,
      reaction: 0,
      burstLeft: 0,
      burstPause: 0,
      thinkIn: Math.random() * 0.2,
      plantProgress: 0,
      defuseProgress: 0,
      hasSpike: false,
      investigate: null,
      yawTarget: null,
      damageFlash: 0,
    };
    // hit meshes for the player's raycaster
    mesh.head.userData = { bot, part: 'head' };
    mesh.torso.userData = { bot, part: 'body' };
    bot.hitMeshes = [mesh.head, mesh.torso];
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 4; i += 1) {
    const role = i === 0 ? 'rusher' : i === 1 ? 'rusher' : 'support';
    addBot('V', VANGUARD_NAMES[i], role, i < 2 ? 'A' : 'B');
  }
  for (let i = 0; i < 5; i += 1) {
    const site = i < 2 ? 'A' : i < 4 ? 'B' : null;
    const role = i === 4 ? 'sniper' : 'holder';
    addBot('J', JACKAL_NAMES[i], role, site);
  }

  function siteNode(site) {
    return site === 'A' ? 13 : 16;
  }
  function setPath(bot, toNode, avoid = []) {
    const from = nearestNode(bot.mover.body.position.x, bot.mover.body.position.z);
    bot.path = findPath(from, toNode, avoid);
    bot.pathIndex = 0;
  }
  function setDestination(bot, x, z, avoid = []) {
    // path to the nearest node to the point, then the point itself
    const node = nearestNode(x, z);
    setPath(bot, node, avoid);
    bot.path.push(-1); // sentinel: final exact point
    bot.finalPoint = { x, z };
    bot.pathAvoidsMid = avoid.includes(4);
  }

  function resetRound(roundNumber) {
    for (const bot of bots) {
      const spawn = bot.team === 'V' ? MAP.attackerSpawn : MAP.defenderSpawn;
      const side = bot.team === 'V' ? 1 : -1;
      bot.mover.teleport(
        spawn.x + (bot.id % 4 - 1.5) * 1.4,
        spawn.z + side * (bot.id % 2) * 0.9,
        spawn.yaw,
      );
      bot.hp = 100;
      bot.armor = 0;
      bot.alive = true;
      bot.state = 'move';
      bot.target = null;
      bot.lastSeen = null;
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.hasSpike = false;
      bot.investigate = null;
      bot.mesh.group.visible = true;
      bot.mesh.group.rotation.set(0, 0, 0);
      bot.mesh.group.position.y = 0;
      bot.mesh.cloth.emissive = new THREE.Color(0x000000);
      bot.weapon = createWeaponState(bot.role === 'sniper' ? WEAPONS.lancer : bot.role === 'rusher' ? WEAPONS.vk9 : WEAPONS.ar77);
      // opening orders
      if (bot.team === 'J') {
        if (bot.site) {
          bot.holdNode = bot.site === 'A' ? (bot.id === 0 ? 13 : 12) : (bot.id === 2 ? 16 : 15);
          setPath(bot, bot.holdNode);
          bot.state = 'move';
        } else {
          // the sniper watches the west lane / A approach from the back,
          // never straight down mid at the enemy spawn
          bot.holdNode = 19;
          setPath(bot, 19);
        }
      } else {
        setPath(bot, bot.site === 'A' ? 12 : 15);
      }
    }
  }

  function eyePos(bot, out) {
    out.set(bot.mover.body.position.x, bot.mover.body.position.y + bot.mover.body.eye, bot.mover.body.position.z);
    return out;
  }

  function chestPosOf(target, out) {
    if (target.kind === 'player') {
      const p = target.ref;
      out.set(p.position.x, p.position.y + 1.25, p.position.z);
    } else {
      const b = target.ref;
      out.set(b.mover.body.position.x, b.mover.body.position.y + 1.2, b.mover.body.position.z);
    }
    return out;
  }

  function canSee(bot, target) {
    const from = eyePos(bot, tmpV);
    const to = chestPosOf(target, tmpV2);
    const dist = from.distanceTo(to);
    if (dist > 60) return false;
    if (api.blockedBySmoke(from, to)) return false;
    return api.hasLineOfSight(from, to, dist);
  }

  function pickTarget(bot) {
    // nearest visible enemy, prefer the player if equally close
    let best = null;
    let bestD = Infinity;
    const enemies = api.enemiesOf(bot);
    for (const e of enemies) {
      if (!canSee(bot, e)) continue;
      const to = chestPosOf(e, tmpV2);
      const d = eyePos(bot, tmpV).distanceTo(to);
      if (d < bestD) {
        bestD = d;
        best = { target: e, dist: d };
      }
    }
    return best;
  }

  function fireAt(bot, target, dist, dt) {
    const w = bot.weapon;
    if (w.reloadLeft > 0) return false;
    if (w.mag <= 0) {
      w.reloadLeft = w.def.reloadTime;
      return false;
    }
    if (w.cooldown > 0) return false;
    w.cooldown = w.def.fireInterval * (bot.role === 'sniper' ? 1.6 : 1);
    w.mag -= 1;
    const from = eyePos(bot, tmpV).clone();
    from.y -= 0.12;
    const to = chestPosOf(target, tmpV2);
    const targetSpeed = target.kind === 'player' ? api.playerSpeed() : Math.hypot(target.ref.mover.body.velocity.x, target.ref.mover.body.velocity.z);
    const moving = Math.hypot(bot.mover.body.velocity.x, bot.mover.body.velocity.z) > 0.5;
    // Bots are dangerous but not laser-accurate: a player in the open has
    // ~3-4 s to react and reach cover before a bot's fire turns lethal.
    let chance = 0.42 - dist * 0.006 - targetSpeed * 0.028 - (moving ? 0.16 : 0);
    if (bot.role === 'sniper') chance += 0.06;
    chance = Math.max(0.06, Math.min(0.55, chance));
    const hit = Math.random() < chance;
    const end = tmpV2.clone();
    if (!hit) {
      end.x += (Math.random() - 0.5) * 2.4;
      end.y += (Math.random() - 0.5) * 1.6;
      end.z += (Math.random() - 0.5) * 2.4;
    }
    api.addTracer(from, end);
    api.playShot(w.def.sound, from, hit ? to : end);
    api.botMuzzle(bot);
    if (hit) {
      const dmg = w.def.damage * (0.85 + Math.random() * 0.3) * 0.6;
      if (target.kind === 'player') api.damagePlayer(dmg, from);
      else api.damageBot(target.ref, dmg, 'body', bot);
    }
    return true;
  }

  // One burst-fire sequence against a visible target: reaction pause, then
  // bursts of 3-5 shots with a pause between them.
  function combatFire(bot, target, dist, dt) {
    if (target.kind === 'bot' && !target.ref.alive) {
      bot.target = null;
      return;
    }
    if (bot.reaction > 0) {
      bot.reaction -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      if (bot.burstPause > 0) bot.burstPause -= dt;
      else {
        bot.burstLeft = bot.role === 'sniper' ? 1 : 3 + Math.floor(Math.random() * 3);
        bot.burstPause = 0;
      }
    } else if (fireAt(bot, target, dist, dt)) {
      bot.burstLeft -= 1;
      if (bot.burstLeft <= 0) bot.burstPause = 0.7 + Math.random() * 0.6;
    }
  }

  function stepBot(bot, dt) {
    if (!bot.alive) return;
    const body = bot.mover.body;
    bot.thinkIn -= dt;
    if (bot.damageFlash > 0) {
      bot.damageFlash -= dt;
      bot.mesh.cloth.emissive.setRGB(bot.damageFlash * 2.2, 0, 0);
    }

    // --- perception (staggered) ---
    if (bot.thinkIn <= 0) {
      bot.thinkIn = 0.15 + Math.random() * 0.08;
      const found = pickTarget(bot);
      if (found) {
        const hadTarget = bot.target;
        bot.target = found.target;
        bot.lastSeen = { x: found.target.kind === 'player' ? found.target.ref.position.x : found.target.ref.mover.body.position.x, z: found.target.kind === 'player' ? found.target.ref.position.z : found.target.ref.mover.body.position.z };
        if (bot.hasSpike) {
          // the carrier never stops to duel: it keeps pushing to the site
          // and returns fire on the move (see the 'move' branch)
          if (!hadTarget) {
            bot.reaction = 0.55 + Math.random() * 0.4;
            bot.burstLeft = 0;
            bot.burstPause = 0;
          }
        } else if (bot.state !== 'engage') {
          bot.reaction = 0.55 + Math.random() * 0.4;
          bot.burstLeft = 0;
          bot.burstPause = 0;
          bot.state = 'engage';
        }
      } else {
        if (bot.state === 'engage') {
          bot.target = null;
          bot.state = bot.holdNode >= 0 ? 'hold' : 'move';
          if (bot.lastSeen) {
            bot.investigate = bot.lastSeen;
            bot.lastSeen = null;
          }
        } else {
          bot.target = null;
        }
      }
    }

    // --- spike duties override movement when idle ---
    if (bot.state !== 'engage' && bot.state !== 'dead') {
      if (api.spikePlanted()) {
        if (bot.team === 'J' && bot.state !== 'defuse') {
          // retake: converge on the planted site
          const s = api.spikePos();
          const d = Math.hypot(s.x - body.position.x, s.z - body.position.z);
          if (d < 2.2) {
            bot.state = 'defuse';
            bot.defuseProgress = 0;
          } else if (bot.state !== 'move' || !bot.path.length) {
            setDestination(bot, s.x, s.z);
            bot.state = 'move';
          }
        } else if (bot.team === 'V') {
          // guard the spike: hold near it
          const s = api.spikePos();
          const d = Math.hypot(s.x - body.position.x, s.z - body.position.z);
          if (d > 6 && bot.state !== 'move') {
            setDestination(bot, s.x + (Math.random() - 0.5) * 4, s.z + (Math.random() - 0.5) * 4);
            bot.state = 'move';
          } else if (d <= 6) {
            bot.state = 'hold';
            bot.holdNode = -1;
          }
        }
      } else if (bot.team === 'V' && bot.hasSpike && bot.state !== 'plant') {
        const site = api.spikeSite();
        const d = Math.hypot(site.x - body.position.x, site.z - body.position.z);
        if (d < site.r * 0.7) {
          bot.state = 'plant';
          bot.plantProgress = 0;
        } else if (bot.state !== 'move' || !bot.path.length || !bot.pathAvoidsMid) {
          // flank route: the carrier avoids the contested mid lane. The
          // re-path also fires when the bot picked the spike up mid-route
          // on the short (mid) path its opening orders gave it.
          setDestination(bot, site.x, site.z, [4, 5]);
          bot.state = 'move';
        }
      } else if (bot.investigate && bot.state !== 'move' && bot.state !== 'hold') {
        setDestination(bot, bot.investigate.x, bot.investigate.z);
        bot.state = 'move';
      }
    }

    // --- act ---
    let wishX = 0;
    let wishZ = 0;
    let speed = BOT_SPEED;
    let crouch = false;

    if (bot.state === 'engage' && bot.target) {
      const to = chestPosOf(bot.target, tmpV2);
      const dx = to.x - body.position.x;
      const dz = to.z - body.position.z;
      const dist = Math.hypot(dx, dz);
      // face the target
      bot.mover.body.yaw = Math.atan2(-dx, -dz);
      // hold ground at mid range, strafe a little
      if (dist > 16) {
        wishX = dx / dist;
        wishZ = dz / dist;
      } else if (dist < 5) {
        wishX = -dx / dist;
        wishZ = -dz / dist;
      } else {
        const strafe = Math.sin(api.time() * 0.9 + bot.id * 2.1) * 0.5;
        wishX = (-dz / dist) * strafe;
        wishZ = (dx / dist) * strafe;
      }
      speed = BOT_SPEED * 0.55;
      combatFire(bot, bot.target, dist, dt);
    } else if (bot.state === 'plant') {
      bot.plantProgress += dt;
      api.botPlanting(bot, bot.plantProgress / MAP.plantTime);
      if (bot.plantProgress >= MAP.plantTime) {
        api.spikePlantedBy(bot);
        bot.state = 'hold';
        bot.hasSpike = false;
      }
    } else if (bot.state === 'defuse') {
      bot.defuseProgress += dt;
      api.botDefusing(bot, bot.defuseProgress / MAP.defuseTime);
      if (bot.defuseProgress >= MAP.defuseTime) {
        api.spikeDefusedBy(bot);
        bot.state = 'hold';
      }
    } else if (bot.state === 'move' || bot.state === 'hold') {
      if (bot.state === 'move' && bot.path.length) {
        let node = bot.path[bot.pathIndex];
        let tx;
        let tz;
        if (node === -1) {
          tx = bot.finalPoint.x;
          tz = bot.finalPoint.z;
        } else {
          tx = WAYPOINTS[node][0];
          tz = WAYPOINTS[node][1];
        }
        const dx = tx - body.position.x;
        const dz = tz - body.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.7) {
          bot.pathIndex += 1;
          if (bot.pathIndex >= bot.path.length) {
            bot.path = [];
            if (bot.holdNode >= 0) bot.state = 'hold';
            else if (bot.investigate) {
              bot.investigate = null;
              bot.state = 'hold';
            } else bot.state = 'hold';
          }
        } else {
          wishX = dx / dist;
          wishZ = dz / dist;
          bot.mover.body.yaw = Math.atan2(-wishX, -wishZ);
        }
        // the carrier returns fire while it advances — it faces its target
        // to shoot, but its feet keep following the path
        if (bot.hasSpike && bot.target) {
          const tto = chestPosOf(bot.target, tmpV2);
          const tdx = tto.x - body.position.x;
          const tdz = tto.z - body.position.z;
          const tdist = Math.hypot(tdx, tdz);
          bot.mover.body.yaw = Math.atan2(-tdx, -tdz);
          combatFire(bot, bot.target, tdist, dt);
        }
      } else if (bot.state === 'hold') {
        // scan: slow yaw sweep
        bot.mover.body.yaw += Math.sin(api.time() * 0.5 + bot.id * 1.7) * dt * 0.35;
        if (bot.team === 'V' && bot.hasSpike) {
          // carrier that reached its hold point plants if on site
          const site = api.spikeSite();
          const d = Math.hypot(site.x - body.position.x, site.z - body.position.z);
          if (d < site.r * 0.7) {
            bot.state = 'plant';
            bot.plantProgress = 0;
          }
        }
      }
    }

    bot.mover.step(dt, wishX, wishZ, speed, crouch, false);
    // weapon cooldowns
    const w = bot.weapon;
    if (w.cooldown > 0) w.cooldown -= dt;
    if (w.reloadLeft > 0) {
      w.reloadLeft -= dt;
      if (w.reloadLeft <= 0) {
        w.mag = w.def.mag;
        w.reloadLeft = 0;
      }
    }
    // sync mesh
    const g = bot.mesh.group;
    g.position.set(body.position.x, body.position.y, body.position.z);
    g.rotation.y = body.yaw;
    // walk bob
    const gs = Math.hypot(body.velocity.x, body.velocity.z);
    g.position.y = body.position.y + (gs > 0.5 ? Math.abs(Math.sin(api.time() * 9 + bot.id)) * 0.05 : 0);
  }

  function hearShot(pos, shooterTeam) {
    for (const bot of bots) {
      if (!bot.alive || bot.team === shooterTeam) continue;
      const d = Math.hypot(pos.x - bot.mover.body.position.x, pos.z - bot.mover.body.position.z);
      if (d < 26 && bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') {
        bot.investigate = { x: pos.x, z: pos.z };
        if (bot.state === 'hold') {
          setDestination(bot, pos.x, pos.z);
          bot.state = 'move';
        }
      }
    }
  }

  function kill(bot) {
    bot.alive = false;
    bot.state = 'dead';
    bot.mesh.group.rotation.x = -Math.PI / 2;
    bot.mesh.group.position.y = 0.25;
    bot.mesh.tag.visible = false;
  }

  return {
    bots,
    resetRound,
    hearShot,
    kill,
    step(dt) {
      for (const bot of bots) stepBot(bot, dt);
    },
    aliveCount(team) {
      let n = 0;
      for (const bot of bots) if (bot.team === team && bot.alive) n += 1;
      return n;
    },
    hitMeshes() {
      const out = [];
      for (const bot of bots) if (bot.alive) out.push(...bot.hitMeshes);
      return out;
    },
  };
}
