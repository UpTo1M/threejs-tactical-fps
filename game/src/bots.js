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
const neighbors = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) {
  neighbors[a].push(b);
  neighbors[b].push(a);
}
export function nearestNode(x, z) {
  let nearest = 0;
  let minimum = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i][0] - x;
    const dz = WAYPOINTS[i][1] - z;
    const squared = dx * dx + dz * dz;
    if (squared < minimum) {
      minimum = squared;
      nearest = i;
    }
  }
  return nearest;
}
export function findPath(fromNode, toNode, avoid = []) {
  if (!neighbors[fromNode] || !neighbors[toNode]) return [];
  if (fromNode === toNode) return [toNode];
  const predecessor = new Int32Array(WAYPOINTS.length).fill(-1);
  const frontier = [fromNode];
  predecessor[fromNode] = fromNode;
  for (let head = 0; head < frontier.length && predecessor[toNode] < 0; head++) {
    const current = frontier[head];
    for (const adjacent of neighbors[current]) {
      if (predecessor[adjacent] >= 0) continue;
      if (adjacent !== toNode && avoid.includes(adjacent)) continue;
      predecessor[adjacent] = current;
      frontier.push(adjacent);
    }
  }
  if (predecessor[toNode] < 0) return [];
  const steps = [];
  for (let node = toNode; node !== fromNode; node = predecessor[node]) steps.push(node);
  steps.reverse();
  return steps;
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
  tag.position.y = 2.12;
  tag.scale.set(1.35, 0.34, 1);
  group.add(tag);
  group.traverse((o) => {
    o.castShadow = true;
  });
  return { group, torso, head, gun, tag, cloth };
}

export function createBots(scene, colliders, api) {
  const bots = [];
  const aliveHitMeshes = [];
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

  function setPath(bot, toNode, avoid = []) {
    const position = bot.mover.body.position;
    bot.path = findPath(nearestNode(position.x, position.z), toNode, avoid);
    bot.pathIndex = 0;
  }
  function setDestination(bot, x, z, avoid = []) {
    setPath(bot, nearestNode(x, z), avoid);
    // -1 names the precise destination after the graph's last waypoint.
    bot.finalPoint = { x, z };
    bot.path.push(-1);
    bot.pathAvoidsMid = avoid.includes(4);
  }

  function resetRound() {
    for (const bot of bots) {
      const attacking = bot.team === 'V';
      const spawn = attacking ? MAP.attackerSpawn : MAP.defenderSpawn;
      bot.mover.teleport(
        spawn.x + (bot.id % 4 - 1.5) * 1.4,
        spawn.z + (bot.id % 2) * (attacking ? 0.9 : -0.9),
        spawn.yaw,
      );
      Object.assign(bot, {
        hp: 100,
        armor: 0,
        alive: true,
        state: 'move',
        target: null,
        lastSeen: null,
        investigate: null,
        plantProgress: 0,
        defuseProgress: 0,
        hasSpike: false,
        reaction: 0,
        burstLeft: 0,
        burstPause: 0,
        damageFlash: 0,
        holdNode: -1,
        pathAvoidsMid: false,
      });
      const model = bot.mesh;
      model.group.visible = true;
      model.tag.visible = true;
      model.group.rotation.set(0, 0, 0);
      model.group.position.copy(bot.mover.body.position);
      model.cloth.emissive.setHex(0);
      const loadout = bot.role === 'sniper' ? 'lancer' : bot.role === 'rusher' ? 'vk9' : 'ar77';
      bot.weapon = createWeaponState(WEAPONS[loadout]);
      const destination = attacking ? (bot.site === 'A' ? 12 : 15)
        : bot.site === 'A' ? 12 : bot.site === 'B' ? 15 : 19;
      if (!attacking) bot.holdNode = destination;
      setPath(bot, destination);
    }
  }

  function eyePos(bot, out) {
    const actor = bot.mover.body;
    out.copy(actor.position);
    out.y += actor.eye;
    return out;
  }

  function chestPosOf(target, out) {
    const human = target.kind === 'player';
    out.copy(human ? target.ref.position : target.ref.mover.body.position);
    out.y += human ? 1.25 : 1.2;
    return out;
  }

  function canSee(bot, target) {
    eyePos(bot, tmpV);
    chestPosOf(target, tmpV2);
    const distance = tmpV.distanceTo(tmpV2);
    if (distance > 60 || api.blockedBySmoke(tmpV, tmpV2)) return false;
    return api.hasLineOfSight(tmpV, tmpV2, distance);
  }

  function pickTarget(bot) {
    let target = null;
    let dist = Infinity;
    for (const candidate of api.enemiesOf(bot)) {
      if (!canSee(bot, candidate)) continue;
      const separation = tmpV.distanceTo(tmpV2);
      if (separation >= dist) continue;
      target = candidate;
      dist = separation;
    }
    return target ? { target, dist } : null;
  }

  const shotOrigin = new THREE.Vector3();
  const shotEnd = new THREE.Vector3();
  function fireAt(bot, target, dist) {
    const gun = bot.weapon;
    if (gun.cooldown > 0 || gun.reloadLeft > 0) return false;
    if (gun.mag === 0) {
      gun.reloadLeft = gun.def.reloadTime;
      return false;
    }
    const marksman = bot.role === 'sniper';
    gun.cooldown = gun.def.fireInterval * (marksman ? 1.6 : 1);
    gun.mag -= 1;
    eyePos(bot, shotOrigin).y -= 0.12;
    chestPosOf(target, shotEnd);
    const targetSpeed = target.kind === 'player' ? api.playerSpeed() : target.ref.mover.groundSpeed();
    let chance = 0.42 - dist * 0.006 - targetSpeed * 0.028;
    if (bot.mover.groundSpeed() > 0.5) chance -= 0.16;
    if (marksman) chance += 0.06;
    const landed = Math.random() < Math.max(0.06, Math.min(0.55, chance));
    if (!landed) {
      shotEnd.x += 2.4 * (Math.random() - 0.5);
      shotEnd.y += 1.6 * (Math.random() - 0.5);
      shotEnd.z += 2.4 * (Math.random() - 0.5);
    }
    api.addTracer(shotOrigin, shotEnd);
    api.playShot(gun.def.sound, shotOrigin, shotEnd);
    api.botMuzzle(bot);
    if (landed) {
      const damage = gun.def.damage * (0.85 + Math.random() * 0.3) * 0.6;
      if (target.kind === 'player') api.damagePlayer(damage, shotOrigin);
      else api.damageBot(target.ref, damage, 'body', bot);
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
    if (bot.burstLeft > 0) {
      if (fireAt(bot, target, dist)) {
        bot.burstLeft--;
        if (bot.burstLeft === 0) bot.burstPause = 0.7 + 0.6 * Math.random();
      }
      return;
    }
    if (bot.burstPause > 0) {
      bot.burstPause -= dt;
      return;
    }
    bot.burstLeft = bot.role === 'sniper' ? 1 : Math.floor(3 + 3 * Math.random());
    bot.burstPause = 0;
  }

  function perceive(bot, seconds) {
    bot.thinkIn -= seconds;
    if (bot.thinkIn > 0) return;
    bot.thinkIn = Math.random() * 0.08 + 0.15;
    const contact = pickTarget(bot);
    if (!contact) {
      bot.target = null;
      if (bot.state === 'engage') {
        bot.state = bot.holdNode >= 0 ? 'hold' : 'move';
        if (bot.lastSeen) {
          bot.investigate = bot.lastSeen;
          bot.lastSeen = null;
        }
      }
      return;
    }
    const newContact = bot.hasSpike ? !bot.target : bot.state !== 'engage';
    bot.target = contact.target;
    chestPosOf(bot.target, tmpV2);
    bot.lastSeen = { x: tmpV2.x, z: tmpV2.z };
    if (newContact) {
      bot.reaction = Math.random() * 0.4 + 0.55;
      bot.burstLeft = 0;
      bot.burstPause = 0;
    }
    // The carrier can shoot without abandoning its route to the site.
    if (!bot.hasSpike) bot.state = 'engage';
  }

  function distanceTo(bot, point) {
    const position = bot.mover.body.position;
    return Math.hypot(point.x - position.x, point.z - position.z);
  }

  function approach(bot, point, avoid = []) {
    setDestination(bot, point.x, point.z, avoid);
    bot.state = 'move';
  }

  function objectiveOrders(bot) {
    if (bot.state === 'engage' || bot.state === 'dead') return;
    if (api.spikePlanted()) {
      const charge = api.spikePos();
      const distance = distanceTo(bot, charge);
      if (bot.team === 'J') {
        if (bot.state === 'defuse') return;
        if (distance < 2.2) {
          bot.state = 'defuse';
          bot.defuseProgress = 0;
        } else if (bot.state !== 'move' || bot.path.length === 0) {
          approach(bot, charge);
        }
      } else if (distance <= 6) {
        bot.state = 'hold';
        bot.holdNode = -1;
      } else if (bot.state !== 'move') {
        approach(bot, {
          x: charge.x + 4 * (Math.random() - 0.5),
          z: charge.z + 4 * (Math.random() - 0.5),
        });
      }
      return;
    }
    if (bot.team === 'V' && bot.hasSpike && bot.state !== 'plant') {
      const destination = api.spikeSite();
      if (distanceTo(bot, destination) < destination.r * 0.7) {
        bot.state = 'plant';
        bot.plantProgress = 0;
      } else if (bot.state !== 'move' || bot.path.length === 0 || !bot.pathAvoidsMid) {
        approach(bot, destination, [4, 5]);
      }
      return;
    }
    if (bot.investigate && bot.state !== 'move' && bot.state !== 'hold') {
      approach(bot, bot.investigate);
    }
  }

  function faceTarget(bot) {
    const targetPosition = chestPosOf(bot.target, tmpV2);
    const position = bot.mover.body.position;
    const deltaX = targetPosition.x - position.x;
    const deltaZ = targetPosition.z - position.z;
    bot.mover.body.yaw = Math.atan2(-deltaX, -deltaZ);
    return Math.max(0.001, Math.hypot(deltaX, deltaZ));
  }

  const movement = { x: 0, z: 0, speed: BOT_SPEED };
  function duel(bot, seconds) {
    const distance = faceTarget(bot);
    const heading = bot.mover.body.yaw;
    const forwardX = -Math.sin(heading);
    const forwardZ = -Math.cos(heading);
    if (distance > 16 || distance < 5) {
      const direction = distance > 16 ? 1 : -1;
      movement.x = forwardX * direction;
      movement.z = forwardZ * direction;
    } else {
      const lateral = 0.5 * Math.sin(0.9 * api.time() + 2.1 * bot.id);
      movement.x = -forwardZ * lateral;
      movement.z = forwardX * lateral;
    }
    movement.speed = BOT_SPEED * 0.55;
    combatFire(bot, bot.target, distance, seconds);
  }

  function followRoute(bot, seconds) {
    const waypoint = bot.path[bot.pathIndex];
    const goal = waypoint < 0 ? bot.finalPoint : null;
    const actor = bot.mover.body;
    const dx = (goal ? goal.x : WAYPOINTS[waypoint][0]) - actor.position.x;
    const dz = (goal ? goal.z : WAYPOINTS[waypoint][1]) - actor.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.7) {
      bot.pathIndex += 1;
      if (bot.pathIndex >= bot.path.length) {
        bot.path.length = 0;
        if (bot.holdNode < 0) bot.investigate = null;
        bot.state = 'hold';
      }
    } else {
      movement.x = dx / distance;
      movement.z = dz / distance;
      actor.yaw = Math.atan2(-movement.x, -movement.z);
    }
    if (bot.hasSpike && bot.target) {
      combatFire(bot, bot.target, faceTarget(bot), seconds);
    }
  }

  function workObjective(bot, seconds) {
    if (bot.state === 'plant') {
      bot.plantProgress += seconds;
      api.botPlanting(bot, bot.plantProgress / MAP.plantTime);
      if (bot.plantProgress < MAP.plantTime) return;
      api.spikePlantedBy(bot);
      bot.hasSpike = false;
    } else {
      bot.defuseProgress += seconds;
      api.botDefusing(bot, bot.defuseProgress / MAP.defuseTime);
      if (bot.defuseProgress < MAP.defuseTime) return;
      api.spikeDefusedBy(bot);
    }
    bot.state = 'hold';
  }

  function updateBotWeapon(bot, seconds) {
    const gun = bot.weapon;
    gun.cooldown = Math.max(0, gun.cooldown - seconds);
    if (gun.reloadLeft <= 0) return;
    gun.reloadLeft = Math.max(0, gun.reloadLeft - seconds);
    if (gun.reloadLeft === 0) gun.mag = gun.def.mag;
  }

  function updateBotMesh(bot, seconds) {
    bot.damageFlash = Math.max(0, bot.damageFlash - seconds);
    bot.mesh.cloth.emissive.setRGB(2.2 * bot.damageFlash, 0, 0);
    const actor = bot.mover.body;
    const model = bot.mesh.group;
    model.position.copy(actor.position);
    model.rotation.y = actor.yaw;
    if (bot.mover.groundSpeed() > 0.5) {
      model.position.y += 0.05 * Math.abs(Math.sin(9 * api.time() + bot.id));
    }
  }

  function stepBot(bot, seconds) {
    if (bot.alive === false) return;
    perceive(bot, seconds);
    objectiveOrders(bot);
    movement.x = 0;
    movement.z = 0;
    movement.speed = BOT_SPEED;
    if (bot.state === 'engage' && bot.target !== null) {
      duel(bot, seconds);
    } else if (bot.state === 'plant' || bot.state === 'defuse') {
      workObjective(bot, seconds);
    } else if (bot.state === 'move' && bot.path.length > 0) {
      followRoute(bot, seconds);
    } else if (bot.state === 'hold') {
      bot.mover.body.yaw += 0.35 * seconds * Math.sin(0.5 * api.time() + 1.7 * bot.id);
    }
    bot.mover.step(seconds, movement.x, movement.z, movement.speed, false, false);
    updateBotWeapon(bot, seconds);
    updateBotMesh(bot, seconds);
  }

  function hearShot(pos, shooterTeam) {
    for (const bot of bots) {
      if (bot.team === shooterTeam || !bot.alive) continue;
      if (bot.state === 'engage' || bot.state === 'plant' || bot.state === 'defuse') continue;
      if (distanceTo(bot, pos) >= 26) continue;
      bot.investigate = { x: pos.x, z: pos.z };
      if (bot.state === 'hold') {
        setDestination(bot, pos.x, pos.z);
        bot.state = 'move';
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
      aliveHitMeshes.length = 0;
      for (const bot of bots) {
        if (!bot.alive) continue;
        aliveHitMeshes.push(bot.mesh.head, bot.mesh.torso);
      }
      return aliveHitMeshes;
    },
  };
}
