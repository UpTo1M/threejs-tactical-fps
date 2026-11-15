// HUD: every DOM readout, the buy menu, the killfeed, the minimap and the
// overlays. The simulation never touches the DOM; main.js drains game
// events into these calls.
import { BUY_MENU } from './weapons.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    healthNum: $('health-num'),
    armorNum: $('armor-num'),
    healthFill: $('health-fill'),
    armorFill: $('armor-fill'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    grenades: $('grenades'),
    money: $('money'),
    timer: $('timer'),
    scoreV: $('score-v'),
    scoreJ: $('score-j'),
    roundLabel: $('round-label'),
    killfeed: $('killfeed'),
    spike: $('spike-status'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    buyMenu: $('buy-menu'),
    buyItems: $('buy-items'),
    buyMoney: $('buy-money'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    playBtn: $('play'),
    hint: $('hint'),
    vignette: $('vignette'),
    minimap: $('minimap'),
    scope: $('scope'),
  };
  const mm = el.minimap.getContext('2d');
  let lastMinimap = 0;

  function fmtTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function setHealth(hp, armor) {
    el.healthNum.textContent = Math.max(0, Math.ceil(hp));
    el.armorNum.textContent = Math.max(0, Math.ceil(armor));
    el.healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
    el.armorFill.style.width = `${Math.max(0, Math.min(100, armor))}%`;
    el.healthNum.classList.toggle('low', hp <= 30);
  }

  function setAmmo(mag, reserve, name) {
    el.ammoMag.textContent = mag;
    el.ammoReserve.textContent = `/ ${reserve}`;
    el.ammoMag.parentElement.classList.toggle('empty', mag === 0);
    if (name) el.weaponName.textContent = name;
  }

  function setGrenades(frag, smoke) {
    el.grenades.textContent = `Frag ${frag} · Smoke ${smoke}`;
  }

  function setMoney(money) {
    el.money.textContent = `$${money.toLocaleString('en-US')}`;
    el.buyMoney.textContent = `$${money.toLocaleString('en-US')}`;
  }

  function setTimer(seconds, planted) {
    el.timer.textContent = fmtTime(seconds);
    el.timer.classList.toggle('danger', seconds <= 15 || planted);
  }

  function setScore(v, j, round) {
    el.scoreV.textContent = v;
    el.scoreJ.textContent = j;
    el.roundLabel.textContent = `ROUND ${round} / 9`;
  }

  function setSpike(status, extra) {
    // status: 'carry' | 'planted' | 'defusing' | 'site' | 'none'
    el.spike.hidden = status === 'none';
    if (status === 'carry') el.spike.textContent = `SPIKE — plant at ${extra}`;
    else if (status === 'planted') el.spike.textContent = `SPIKE PLANTED — ${fmtTime(extra)}`;
    else if (status === 'defusing') el.spike.textContent = `⚠ ${extra} IS DEFUSING`;
    else if (status === 'site') el.spike.textContent = `HOLD E — PLANT THE SPIKE`;
  }

  function killfeedAdd(text, good) {
    const div = document.createElement('div');
    div.className = `feed-item${good ? ' good' : ''}`;
    div.textContent = text;
    el.killfeed.prepend(div);
    while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
    setTimeout(() => div.remove(), 6000);
  }

  function hitMarker(kill, holdMs = 90) {
    el.hitmarker.classList.add('on');
    el.hitmarker.classList.toggle('kill', kill);
    clearTimeout(hitMarker._t);
    hitMarker._t = setTimeout(() => el.hitmarker.classList.remove('on', 'kill'), holdMs);
  }

  function damageFlash() {
    el.vignette.classList.add('on');
    setTimeout(() => el.vignette.classList.remove('on'), 180);
  }

  function setCrosshair(gapPx) {
    el.crosshair.style.setProperty('--gap', `${gapPx}px`);
  }

  function showBanner(title, sub, good) {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub;
    el.banner.classList.toggle('good', !!good);
    el.banner.classList.toggle('bad', !good);
    el.banner.hidden = false;
  }

  function hideBanner() {
    el.banner.hidden = true;
  }

  function setHint(text) {
    if (el.hint.textContent !== text) el.hint.textContent = text;
    el.hint.hidden = !text;
  }

  function showOverlay(kind, score) {
    el.overlay.hidden = false;
    if (kind === 'start') {
      el.overlayTitle.textContent = 'SABLE LINE';
      el.overlayCopy.textContent = 'Five versus five. Plant the spike at Crane or Silo — or wipe the Jackals out. First to 5 rounds takes the yard.';
      el.playBtn.textContent = 'Click to play';
    } else if (kind === 'paused') {
      el.overlayTitle.textContent = 'Paused';
      el.overlayCopy.textContent = 'Click to jump back in.';
      el.playBtn.textContent = 'Resume';
    } else if (kind === 'dead') {
      el.overlayTitle.textContent = 'You are down';
      el.overlayCopy.textContent = 'Your squad fights on. Watch the round play out — you redeploy next round.';
      el.playBtn.textContent = 'Spectate';
    } else if (kind === 'match') {
      el.overlayTitle.textContent = score;
      el.overlayCopy.textContent = 'The yard is decided. Play again?';
      el.playBtn.textContent = 'Play again';
    }
  }

  function hideOverlay() {
    el.overlay.hidden = true;
  }

  function onPlay(handler) {
    el.playBtn.addEventListener('click', handler);
  }

  function setScope(on) {
    el.scope.hidden = !on;
    el.crosshair.style.visibility = on ? 'hidden' : 'visible';
  }

  // --- buy menu ---
  let buyHandler = null;
  function buildBuyMenu() {
    el.buyItems.innerHTML = '';
    let key = 1;
    for (const section of BUY_MENU) {
      const h = document.createElement('h3');
      h.textContent = section.section;
      el.buyItems.appendChild(h);
      for (const item of section.items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.dataset.item = item.id;
        row.innerHTML = `<span class="buy-key">${key}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">$${item.price.toLocaleString('en-US')}</span>`;
        row.addEventListener('click', () => {
          if (buyHandler) buyHandler(item.id);
        });
        el.buyItems.appendChild(row);
        key += 1;
      }
    }
  }

  function refreshBuy(money, owned) {
    for (const row of el.buyItems.querySelectorAll('.buy-row')) {
      const id = row.dataset.item;
      const priceEl = row.querySelector('.buy-price');
      const price = Number(priceEl.textContent.replace(/[^0-9]/g, ''));
      row.classList.toggle('owned', !!owned[id]);
      row.classList.toggle('cant', !owned[id] && money < price);
    }
  }

  function showBuy(show) {
    el.buyMenu.hidden = !show;
  }

  function onBuy(handler) {
    buyHandler = handler;
  }

  // --- minimap ---
  function drawMinimap(now, playerPos, playerYaw, bots, spike) {
    if (now - lastMinimap < 120) return;
    lastMinimap = now;
    const W = el.minimap.width;
    const H = el.minimap.height;
    const sx = (x) => ((x + 20) / 40) * W;
    const sz = (z) => ((z + 16) / 32) * H;
    mm.clearRect(0, 0, W, H);
    mm.fillStyle = 'rgba(20,22,26,0.82)';
    mm.fillRect(0, 0, W, H);
    // walls
    mm.strokeStyle = '#454c58';
    mm.lineWidth = 2;
    mm.strokeRect(sx(-20), sz(-16), sx(20) - sx(-20), sz(16) - sz(-16));
    // mid containers
    mm.fillStyle = '#454c58';
    mm.fillRect(sx(-9.4), sz(-3.2), sx(-3.4) - sx(-9.4), sz(-0.8) - sz(-3.2));
    mm.fillRect(sx(3.4), sz(-3.2), sx(9.4) - sx(3.4), sz(-0.8) - sz(-3.2));
    // sites
    for (const [cx, cz, label] of [[-13.5, -9.5, 'A'], [13.5, -9.5, 'B']]) {
      mm.beginPath();
      mm.arc(sx(cx), sz(cz), 13, 0, Math.PI * 2);
      mm.fillStyle = 'rgba(224,120,48,0.25)';
      mm.fill();
      mm.strokeStyle = '#e07830';
      mm.lineWidth = 1.5;
      mm.stroke();
      mm.fillStyle = '#e07830';
      mm.font = '700 11px system-ui, sans-serif';
      mm.textAlign = 'center';
      mm.fillText(label, sx(cx), sz(cz) + 4);
    }
    // spike
    if (spike && spike.state === 'planted') {
      mm.fillStyle = '#f0a830';
      mm.beginPath();
      mm.arc(sx(spike.pos.x), sz(spike.pos.z), 4, 0, Math.PI * 2);
      mm.fill();
    }
    // bots
    for (const b of bots) {
      if (!b.alive) continue;
      mm.fillStyle = b.team === 'V' ? '#3fb8a6' : '#e07830';
      mm.beginPath();
      mm.arc(sx(b.mover.body.position.x), sz(b.mover.body.position.z), 3.2, 0, Math.PI * 2);
      mm.fill();
    }
    // player arrow
    mm.save();
    mm.translate(sx(playerPos.x), sz(playerPos.z));
    mm.rotate(-playerYaw);
    mm.fillStyle = '#e8e4d8';
    mm.beginPath();
    mm.moveTo(0, -6);
    mm.lineTo(4.5, 5);
    mm.lineTo(-4.5, 5);
    mm.closePath();
    mm.fill();
    mm.restore();
  }

  buildBuyMenu();
  return {
    setHealth, setAmmo, setGrenades, setMoney, setTimer, setScore, setSpike,
    killfeedAdd, hitMarker, damageFlash, setCrosshair, showBanner, hideBanner,
    setHint, showOverlay, hideOverlay, onPlay, setScope, showBuy, refreshBuy,
    onBuy, drawMinimap, el,
  };
}
