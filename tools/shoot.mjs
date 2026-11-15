// Screenshot helper: drives the Hatch Chromium build over CDP (it needs the
// Hatch WebGL domain-policy flags and its --screenshot mode writes nothing
// in this environment). Usage:
//   CHROME=/opt/meta-chromium/chrome node tools/shoot.mjs <url> <out.jpg> [width height]
// Waits for window.__shotReady (set by game/src/main.js after staging),
// then captures a JPEG screenshot. Node 22+ (built-in WebSocket).
import { execFile, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const chrome = process.env.CHROME || '/opt/meta-chromium/chrome';
const [url, out, w = '1280', h = '800'] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node tools/shoot.mjs <url> <out.jpg> [width height]');
  process.exit(2);
}

mkdirSync(new URL('../.cache/', import.meta.url), { recursive: true });
const policy = 'hatch-webgl-all-origins-v1\n';
writeFileSync(new URL('../.cache/webgl-policy.txt', import.meta.url), policy);
const sha = createHash('sha256').update(policy).digest('hex');

const port = 9333;
const child = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-proxy-server',
  '--allow-file-access-from-files',
  '--use-angle=swiftshader-webgl',
  `--user-data-dir=${fileURLToPath(new URL('../.cache/chrome-shoot/', import.meta.url))}`,
  `--remote-debugging-port=${port}`,
  `--hatch-webgl-allowed-domains-file=${fileURLToPath(new URL('../.cache/webgl-policy.txt', import.meta.url))}`,
  `--hatch-webgl-allowed-domains-sha256=${sha}`,
  '--window-size=1280,800',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const data = await res.json();
      return data.webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('CDP did not come up');
}

let id = 0;
const pending = new Map();
let ws;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function main() {
  const browserWs = await getWsUrl();
  ws = new WebSocket(browserWs);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const sendT = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ sessionId, id: mid, method, params }));
  });
  await sendT('Page.enable');
  await sendT('Runtime.enable');
  await sendT('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false });
  await sendT('Page.navigate', { url });
  // wait for the game to stage its frame and set window.__shotReady
  let ready = false;
  for (let i = 0; i < 120; i += 1) {
    const { result } = await sendT('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true });
    if (result && result.value) {
      ready = true;
      break;
    }
    await sleep(250);
  }
  if (!ready) {
    const { result } = await sendT('Runtime.evaluate', { expression: 'document.title + " | " + (window.__shotError || "no __shotReady")', returnByValue: true });
    throw new Error(`shot never became ready: ${result?.value}`);
  }
  await sleep(300);
  const shot = await sendT('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`wrote ${out}`);
  child.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message);
  child.kill();
  process.exit(1);
});
