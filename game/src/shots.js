// Deterministic screenshot staging: ?shot=start|play|plant|end&seed=N builds
// one frozen, representative frame per name — the same frames the dossier's
// screenshots come from. Everything here is the game's own code and state;
// no mock scene is ever rendered.
import * as THREE from 'three';
import { WEAPONS, createWeaponState } from './weapons.js';
import { MAP } from './world.js';

function placeBot(bot, x, z, yaw, hold = true) {
  bot.mover.teleport(x, z, yaw);
  bot.mover.body.velocity.set(0, 0, 0);
  bot.state = hold ? 'hold' : 'move';
  bot.holdNode = -1;
  bot.target = null;
  bot.path = [];
  bot.investigate = null;
  bot.mesh.group.position.set(x, 0, z);
  bot.mesh.group.rotation.y = yaw;
}

function giveLoadout(game, player, primaryId, money, frag = 0, smoke = 0) {
  game.state.primaryId = primaryId;
  player.weapon = createWeaponState(WEAPONS[primaryId]);
  player.sidearm = createWeaponState(WEAPONS.p9);
  game.state.grenades = { frag, smoke };
  game.state.money = money;
}

export function stageShot(name, ctx) {
  const { game, bots, player, hud, aimAt, shootAt, settle } = ctx;
  const S = game.state;
  const vBots = bots.bots.filter((b) => b.team === 'V');
  const jBots = bots.bots.filter((b) => b.team === 'J');
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  hud.hideOverlay();
  hud.hideBanner();
  hud.showBuy(false);

  if (name === 'start') {
    // Buy phase at the Vanguard spawn, looking down mid; buy menu open.
    S.phase = 'buy';
    S.phaseTime = 11;
    S.round = 1;
    S.scoreV = 0;
    S.scoreJ = 0;
    giveLoadout(game, player, 'p9', 800, 0, 0);
    player.weapon = createWeaponState(WEAPONS.p9);
    player.sidearm = null;
    player.mover.teleport(0, 13.5, 0);
    // squad spreads wide of the player so nobody blocks the camera
    vBots.forEach((b, i) => placeBot(b, [-7, -4, 4, 7][i], 11.6 + (i % 2) * 0.9, 0));
    jBots.forEach((b, i) => placeBot(b, -6 + i * 3, -13, Math.PI));
    settle(15);
    aimAt(V3(0, 1.6, -8));
    hud.showBuy(true);
    hud.refreshBuy(800, { p9: true });
    hud.setHint('Press B to close the buy menu — round starts in 0:11');
  } else if (name === 'play') {
    // Mid-round firefight in mid lane: one headshot kill, one hit, tracer live.
    S.phase = 'live';
    S.phaseTime = 87;
    S.round = 3;
    S.scoreV = 1;
    S.scoreJ = 1;
    giveLoadout(game, player, 'ar77', 3250, 1, 1);
    player.mover.teleport(0, 6.5, 0);
    placeBot(jBots[0], -1.5, -2, Math.PI);
    placeBot(jBots[1], 2.5, -4.5, Math.PI);
    placeBot(jBots[2], 14, -6, Math.PI);
    placeBot(jBots[3], -14, -6, Math.PI);
    placeBot(jBots[4], 0, -12, Math.PI);
    placeBot(vBots[0], -3.2, 2.5, 0);
    placeBot(vBots[1], 3.4, 3.2, 0);
    placeBot(vBots[2], -6, 8, 0);
    placeBot(vBots[3], 6, 8, 0);
    settle(10);
    // headshot the first Jackal, then tag the second
    const head = V3(jBots[0].mover.body.position.x, 1.56, jBots[0].mover.body.position.z);
    aimAt(head);
    shootAt(head);
    settle(8);
    const chest = V3(jBots[1].mover.body.position.x, 1.2, jBots[1].mover.body.position.z);
    aimAt(chest);
    shootAt(chest);
    settle(2);
    hud.setHint('');
  } else if (name === 'plant') {
    // Spike planted at Crane (A); a Jackal is defusing, Vanguard closes in.
    S.phase = 'live';
    S.phaseTime = 27.3;
    S.round = 4;
    S.scoreV = 2;
    S.scoreJ = 1;
    S.spike.state = 'planted';
    S.spike.site = 'A';
    // spike + defuser on the clear east edge of the site, past the crate stack
    // the charge sits on open asphalt so its ring and beacon read, with the
    // defuser a step behind it rather than standing on top of it
    S.spike.pos.set(-9.5, 0, -6.2);
    S.spike.timer = 27.3;
    giveLoadout(game, player, 'ar77', 3550, 0, 1);
    // west-lane vantage: clear sightline down the lane to the defusing Jackal
    player.mover.teleport(-16, -2, 0);
    // the defuser kneels just past the charge, so the spike device itself
    // stays visible beside him instead of hiding behind his body
    placeBot(jBots[0], -8.9, -8.1, Math.PI / 2);
    jBots[0].state = 'defuse';
    jBots[0].defuseProgress = 1.6;
    placeBot(jBots[1], -10.5, -12.5, Math.PI / 2);
    placeBot(jBots[2], 13.5, -9.5, Math.PI);
    placeBot(jBots[3], 0, -8, Math.PI);
    placeBot(jBots[4], 16, -8, Math.PI);
    placeBot(vBots[0], -17.8, -4.2, 0);
    placeBot(vBots[1], -17.5, -8.5, 0);
    placeBot(vBots[2], 0, 8, 0);
    placeBot(vBots[3], 6, 8, 0);
    settle(10);
    // aim low on the defuser so the planted spike device sits in frame too
    aimAt(V3(-9.5, 0.9, -7.5));
    hud.setHint('');
  } else if (name === 'end') {
    // Round won: banner over the yard, score 3–2.
    S.phase = 'over';
    S.phaseTime = 4.0;
    S.round = 5;
    S.scoreV = 3;
    S.scoreJ = 2;
    S.roundWinner = 'V';
    S.roundReason = 'Spike detonated';
    giveLoadout(game, player, 'ar77', 6100, 1, 0);
    player.mover.teleport(2, 11, 0);
    // Rook stands close to the camera axis so his nameplate stays in frame;
    // Wick holds the east lane so his tag no longer stacks on Vex's.
    placeBot(vBots[0], -1, 8, 0);
    placeBot(vBots[1], 5, 8, 0);
    placeBot(vBots[2], -6, 6, 0);
    placeBot(vBots[3], 8, 10, 0);
    placeBot(jBots[0], 0, -4, Math.PI);
    // the rest of the Jackals hold spread positions: none of them may sit
    // on the camera's sightline behind Vex, or their nameplates stack.
    placeBot(jBots[1], -7, -10, Math.PI);
    placeBot(jBots[2], -11, -6, Math.PI);
    placeBot(jBots[3], 10, -11, Math.PI);
    placeBot(jBots[4], 7, -9, Math.PI);
    settle(10);
    aimAt(V3(-2, 1.4, -6));
    hud.showBanner('ROUND WON', 'Spike detonated — Vanguard takes round 5', true);
    hud.setHint('');
  }

  // sync the HUD to the staged state
  hud.setScore(S.scoreV, S.scoreJ, S.round);
  hud.setMoney(S.money);
  hud.setHealth(S.playerHp, S.playerArmor);
  hud.setAmmo(player.weapon.mag, player.weapon.reserve, player.weapon.def.name);
  hud.setGrenades(S.grenades.frag, S.grenades.smoke);
  const timer = S.phase === 'buy' ? S.phaseTime : S.spike.state === 'planted' ? S.spike.timer : S.phaseTime;
  hud.setTimer(timer, S.spike.state === 'planted');
  if (S.spike.state === 'planted') hud.setSpike('planted', S.spike.timer);
  else if (name === 'plant') hud.setSpike('planted', S.spike.timer);
  else hud.setSpike('none');
}
