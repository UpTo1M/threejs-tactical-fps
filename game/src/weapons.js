// Weapons and the buy catalogue. Damage, fire rate, spread and recoil are
// per weapon; spread grows while moving and while firing, and recoil kicks
// the aim up, so stopping to aim pays. All money is in dollars.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    damage: 26, headMult: 4, mag: 12, reserve: 48, reloadTime: 1.5,
    fireInterval: 0.16, auto: false, spread: 0.011, moveSpread: 0.028,
    recoil: 0.006, speed: 5.6, range: 55, sound: 'pistol',
    desc: 'Reliable sidearm. Free, always in your holster.',
  },
  vk9: {
    id: 'vk9', name: 'VK-9 SMG', kind: 'smg', price: 950,
    damage: 24, headMult: 4, mag: 28, reserve: 112, reloadTime: 2.1,
    fireInterval: 0.075, auto: true, spread: 0.016, moveSpread: 0.042,
    recoil: 0.005, speed: 5.6, range: 45, sound: 'smg',
    desc: 'Fast up close, wild at range. 28-round mag.',
  },
  ar77: {
    id: 'ar77', name: 'AR-77 Rifle', kind: 'rifle', price: 2700,
    damage: 33, headMult: 4, mag: 30, reserve: 90, reloadTime: 2.4,
    fireInterval: 0.105, auto: true, spread: 0.009, moveSpread: 0.034,
    recoil: 0.011, speed: 5.1, range: 70, sound: 'rifle',
    desc: 'The all-rounder. Tap-fire at range, spray up close.',
  },
  lancer: {
    id: 'lancer', name: 'Lancer-50 Marksman', kind: 'sniper', price: 4750,
    damage: 95, headMult: 2, mag: 5, reserve: 15, reloadTime: 3.2,
    fireInterval: 1.15, auto: false, spread: 0.001, moveSpread: 0.09,
    recoil: 0.055, speed: 4.6, range: 90, sound: 'sniper', scoped: true,
    desc: 'One shot, one down. Right-click to scope. Slow and heavy.',
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, desc: 'Explodes after a short fuse. 140 damage at the centre.' },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, desc: 'A thick grey cloud for 12 s. Blocks sight — yours and theirs.' },
};

export const GEAR = {
  kevlar: { id: 'kevlar', name: 'Kevlar Vest', price: 650, desc: 'Absorbs half of incoming damage.' },
  kit: { id: 'kit', name: 'Defuse Kit', price: 400, desc: 'Halves spike defuse time (5 s → 2.5 s).' },
};

export const BUY_MENU = [
  { section: 'Rifles & SMGs', items: [WEAPONS.vk9, WEAPONS.ar77, WEAPONS.lancer] },
  { section: 'Grenades', items: [GRENADES.frag, GRENADES.smoke] },
  { section: 'Gear', items: [GEAR.kevlar, GEAR.kit] },
];

// One live weapon instance: ammo, cooldowns, bloom. No allocation per shot.
export function createWeaponState(def) {
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloadLeft: 0,
    bloom: 0, // 0..1 extra spread from sustained fire
    shotsFired: 0,
  };
}

export function weaponStep(w, dt) {
  if (w.cooldown > 0) w.cooldown -= dt;
  if (w.reloadLeft > 0) {
    w.reloadLeft -= dt;
    if (w.reloadLeft <= 0) {
      const need = w.def.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
      w.reloadLeft = 0;
    }
  }
  w.bloom = Math.max(0, w.bloom - dt * 1.6);
}

export function weaponReady(w) {
  return w.cooldown <= 0 && w.reloadLeft <= 0;
}

export function weaponTakeRound(w) {
  if (w.mag <= 0 || w.reloadLeft > 0) return false;
  w.mag -= 1;
  w.cooldown = w.def.fireInterval;
  w.bloom = Math.min(1, w.bloom + (w.def.kind === 'sniper' ? 0.55 : 0.09));
  w.shotsFired += 1;
  return true;
}

export function weaponReload(w) {
  if (w.reloadLeft > 0 || w.mag >= w.def.mag || w.reserve <= 0) return false;
  w.reloadLeft = w.def.reloadTime;
  return true;
}

export function weaponRefill(w) {
  w.mag = w.def.mag;
  w.reserve = w.def.reserve;
  w.cooldown = 0;
  w.reloadLeft = 0;
  w.bloom = 0;
}

// Spread in radians for this shot: base + movement + bloom.
export function weaponSpread(w, groundSpeed, scoped) {
  const d = w.def;
  const move = Math.min(1, groundSpeed / 5.4);
  let spread = d.spread + d.moveSpread * move + d.spread * 2.2 * w.bloom;
  if (scoped) spread *= 0.25;
  return spread;
}
