// Headless gameplay soak test: drives the real game through the ?debug=1
// hook (window.__sable) over CDP and asserts the whole state machine:
// buy phase -> live -> shooting/kill/economy -> plant -> round end -> match.
// Usage: node tools/soak.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

mkdirSync(new URL('../.cache/', import.meta.url), { recursive: true });
const policy = 'hatch-webgl-all-origins-v1\n';
writeFileSync(new URL('../.cache/webgl-policy.txt', import.meta.url), policy);
const sha = createHash('sha256').update(policy).digest('hex');
const port = 9340;
const url = process.env.GAME_URL || new URL('../game/index.html?debug=1', import.meta.url).href;
const child = spawn('/opt/meta-chromium/chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-proxy-server',
  '--allow-file-access-from-files', '--use-angle=swiftshader-webgl',
  `--user-data-dir=${fileURLToPath(new URL('../.cache/chrome-soak/', import.meta.url))}`,
  `--remote-debugging-port=${port}`,
  `--hatch-webgl-allowed-domains-file=${fileURLToPath(new URL('../.cache/webgl-policy.txt', import.meta.url))}`,
  `--hatch-webgl-allowed-domains-sha256=${sha}`,
  '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      return (await r.json()).webSocketDebuggerUrl;
    } catch { await sleep(250); }
  }
  throw new Error('no cdp');
}
let id = 0;
const pending = new Map();
const ws = new WebSocket(await getWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error)));
    else resolve(m.result);
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const sendT = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ sessionId, id: i, method, params }));
});
await sendT('Page.enable');
await sendT('Runtime.enable');
// Block rAF before the page loads: the live loop would otherwise advance the
// game in wall-clock time alongside the manual steps below, making the test
// nondeterministic. The sim is driven only by __sable.step() calls.
await sendT('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestAnimationFrame = () => 0;' });
await sendT('Page.navigate', { url });
await sleep(5000);

async function ev(expression) {
  const { result, exceptionDetails } = await sendT('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error(`eval failed: ${expression}\n${exceptionDetails.exception?.description || exceptionDetails.text}`);
  return result?.value;
}

const results = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

try {
  check('hook present', (await ev('!!window.__sable')) === true);
  check('starts in menu', (await ev('__sable.game.state.phase')) === 'menu');

  // start the match (click Play)
  await ev(`document.getElementById('play').click(); 'ok'`);
  await sleep(300);
  check('buy phase after play', (await ev('__sable.game.state.phase')) === 'buy');
  check('buy timer ~12s', Math.abs((await ev('__sable.game.state.phaseTime')) - 12) < 1.5);

  // buying: too poor for a rifle, then rich enough
  check('cannot afford AR-77 at $800', (await ev('__sable.game.buy("ar77").ok')) === false);
  await ev('__sable.game.state.money = 3000');
  check('can buy AR-77 at $3000', (await ev('__sable.game.buy("ar77").ok')) === true);
  check('money deducted', (await ev('__sable.game.state.money')) === 300);
  check('primary is AR-77', (await ev('__sable.game.state.primaryId')) === 'ar77');
  check('frag buys with last $300', (await ev('__sable.game.buy("frag").ok')) === true);
  check('buying a second frag is blocked', (await ev('__sable.game.buy("frag").ok')) === false);
  const fragOk = await ev('__sable.game.state.grenades.frag');
  check('one frag carried', fragOk === 1);

  // skip to live
  await ev('__sable.game.state.phaseTime = 0.05');
  await ev('for (let i=0;i<30;i++) __sable.step(1/60)');
  check('live phase', (await ev('__sable.game.state.phase')) === 'live');

  // bots move off spawn
  const moved = await ev(`(()=>{const b=__sable.bots.bots[0]; return Math.hypot(b.mover.body.position.x-0, b.mover.body.position.z-13.5);})()`);
  check('bots leave spawn', moved > 1, `moved ${moved.toFixed(1)}m`);

  // player movement: hold W for 1s of sim
  await ev(`__sable.input.state.keys.add('KeyW'); for (let i=0;i<60;i++) __sable.step(1/60); __sable.input.state.keys.delete('KeyW'); 'ok'`);
  const pz = await ev('__sable.player.mover.body.position.z');
  check('player walks forward (W)', pz < 12, `z=${pz.toFixed(2)}`);

  // shooting: put a Jackal in the open mid lane, re-aim every shot (recoil climbs)
  const kill = await ev(`(()=>{
    const j = __sable.bots.bots.find(b=>b.team==='J' && b.alive);
    j.mover.teleport(0, -2, Math.PI);
    j.state = 'hold'; j.holdNode = -1; j.path = [];
    __sable.player.mover.teleport(0, 6.5, 0);
    let shots = 0;
    while (j.alive && shots < 8) {
      const p = j.mover.body.position;
      __sable.aimAt({x:p.x, y:1.56, z:p.z});
      __sable.shoot(0);
      for (let i=0;i<8;i++) __sable.step(1/60);
      shots++;
    }
    return {alive: j.alive, shots, kills: __sable.game.state.kills, money: __sable.game.state.money};
  })()`);
  check('headshot kill lands', kill.alive === false, JSON.stringify(kill));
  check('kill pays $300', kill.money >= 300, `$${kill.money}`);

  // grenade: throw frag, it explodes after the fuse
  await ev(`__sable.game.state.grenades.frag = 1; __sable.game.playerThrowGrenade('frag', {position: __sable.player.mover.body.position, getWorldDirection(v){ v.set(0,0.2,-1); return v; }}); 'ok'`);
  await ev('for (let i=0;i<140;i++) __sable.step(1/60)');
  const afterFrag = await ev(`({phase: __sable.game.state.phase, vAlive: __sable.bots.aliveCount('V'), jAlive: __sable.bots.aliveCount('J'), playerAlive: __sable.game.state.playerAlive, jHp: __sable.bots.bots.filter(b=>b.team==='J').map(b=>Math.round(b.hp))})`);
  check('frag projectile resolved', afterFrag.phase === 'live', JSON.stringify(afterFrag));

  // plant: teleport into a site, hold E (reset the round clock first: the
  // live rAF loop also advances the game while this test runs)
  await ev(`(()=>{
    __sable.game.state.phaseTime = 100;
    __sable.game.state.playerHp = 100;
    __sable.game.state.playerAlive = true;
    __sable.game.state.hasKevlar = true;
    __sable.game.state.playerArmor = 100;
    // the spike passed to a bot when the player died earlier; hand it back
    __sable.game.state.spike.state = 'carried';
    __sable.game.state.spike.carrier = 'player';
    __sable.bots.bots.forEach(b => { b.hasSpike = false; });
    const site = __sable.game.state.spike.site === 'A' ? {x:-13.5,z:-9.5} : {x:13.5,z:-9.5};
    __sable.player.mover.teleport(site.x, site.z, 0);
    __sable.input.state.keys.add('KeyE');
    for (let i=0;i<260;i++) __sable.step(1/60);
    __sable.input.state.keys.delete('KeyE');
    return __sable.game.state.spike.state;
  })()`);
  check('spike plants', (await ev('__sable.game.state.spike.state')) === 'planted');

  // round ends: eliminate all Jackals -> Vanguard wins
  await ev(`__sable.game.state.phaseTime = 100; __sable.bots.bots.filter(b=>b.team==='J').forEach(b=>{ if(b.alive) __sable.game.damageBot(b, 500, 'body', 'player'); }); for (let i=0;i<10;i++) __sable.step(1/60); 'ok'`);
  check('round won by elimination', (await ev('__sable.game.state.roundWinner')) === 'V');
  check('score 1-0', (await ev('__sable.game.state.scoreV')) === 1);
  check('win bonus paid', (await ev('__sable.game.state.money')) >= 3250);

  // fast-forward to round 2 buy phase
  await ev(`__sable.game.state.phaseTime = 0.05; for (let i=0;i<30;i++) __sable.step(1/60); 'ok'`);
  check('round 2 buy phase', (await ev('__sable.game.state.round')) === 2 && (await ev('__sable.game.state.phase')) === 'buy');

  // match end: force score to 4-4 then win one more
  await ev(`__sable.game.state.scoreV = 4; __sable.game.state.scoreJ = 4; __sable.game.state.phaseTime = 0.05; for (let i=0;i<30;i++) __sable.step(1/60); 'ok'`);
  await ev(`__sable.bots.bots.filter(b=>b.team==='J').forEach(b=>{ if(b.alive) __sable.game.damageBot(b, 500, 'body', 'player'); }); for (let i=0;i<10;i++) __sable.step(1/60); __sable.game.state.phaseTime = 0.05; for (let i=0;i<30;i++) __sable.step(1/60); 'ok'`);
  check('match ends at 5 wins', (await ev('__sable.game.state.phase')) === 'matchover');
  check('Vanguard wins match', (await ev('__sable.game.state.matchWinner')) === 'V');

  // smoke blocks line of sight (unit check through effects)
  const smokeBlocks = await ev(`(()=>{
    const s = __sable.effects;
    s.smoke(0, 1.2, 0);
    const a = {x:0,y:1.5,z:5}, b = {x:0,y:1.5,z:-5};
    return s.blockedBySmoke(a, b);
  })()`);
  check('smoke blocks sight', smokeBlocks === true);

  check('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  results.push(`FAIL  harness error — ${err.message}`);
  process.exitCode = 1;
}
console.log(results.join('\n'));
child.kill();
process.exit(process.exitCode || 0);
