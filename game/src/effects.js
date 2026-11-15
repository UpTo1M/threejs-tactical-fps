// Visual effects, pooled so the hot loop allocates nothing: tracers,
// impact sparks, muzzle flash, explosions and smoke clouds. Smoke also
// answers line-of-sight questions for the bots.
import * as THREE from 'three';

const MAX_PARTICLES = 512;
const MAX_TRACERS = 32;
const MAX_CLOUDS = 6;

export function createEffects(scene, camera) {
  // --- impact sparks: one Points cloud, fixed buffers ---
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pCol = new Float32Array(MAX_PARTICLES * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);
  const pVel = new Float32Array(MAX_PARTICLES * 3);
  const pLife = new Float32Array(MAX_PARTICLES);
  let pNext = 0;

  // --- tracers: pooled lines ---
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tNext = 0;

  // --- muzzle flash: plane + light on the camera ---
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
  flash.position.set(0.3, -0.2, -0.85);
  camera.add(flash);
  const flashLight = new THREE.PointLight(0xffb85e, 0, 9, 1.8);
  flashLight.position.set(0.3, -0.2, -0.6);
  camera.add(flashLight);
  let flashLife = 0;

  // --- explosion flash spheres ---
  const booms = [];
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xff8c2e, transparent: true, opacity: 0, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    const light = new THREE.PointLight(0xff7a1e, 0, 26, 1.5);
    scene.add(light);
    booms.push({ mesh, light, life: 0, max: 1 });
  }
  let bNext = 0;

  // --- smoke clouds: pooled translucent spheres ---
  const clouds = [];
  for (let i = 0; i < MAX_CLOUDS; i += 1) {
    const group = new THREE.Group();
    const puffs = [];
    for (let j = 0; j < 7; j += 1) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0, roughness: 1, depthWrite: false }),
      );
      group.add(puff);
      puffs.push(puff);
    }
    group.visible = false;
    scene.add(group);
    clouds.push({ group, puffs, life: 0, max: 12, x: 0, y: 0, z: 0, r: 0, seed: i * 7 });
  }
  let cNext = 0;

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  function burstParticles(origin, count, color, speed = 4) {
    for (let n = 0; n < count; n += 1) {
      const i = pNext;
      pNext = (pNext + 1) % MAX_PARTICLES;
      pPos[i * 3] = origin.x;
      pPos[i * 3 + 1] = origin.y;
      pPos[i * 3 + 2] = origin.z;
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      pVel[i * 3] = Math.cos(a) * Math.cos(b) * s;
      pVel[i * 3 + 1] = Math.abs(Math.sin(b)) * s + 1.2;
      pVel[i * 3 + 2] = Math.sin(a) * Math.cos(b) * s;
      pCol[i * 3] = color.r;
      pCol[i * 3 + 1] = color.g;
      pCol[i * 3 + 2] = color.b;
      pLife[i] = 0.35 + Math.random() * 0.4;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  function addTracer(from, to) {
    // A non-finite endpoint would poison the line's bounding sphere; drop it loudly.
    if (!Number.isFinite(from.x + from.y + from.z + to.x + to.y + to.z)) {
      return;
    }
    const t = tracers[tNext];
    tNext = (tNext + 1) % MAX_TRACERS;
    const attr = t.line.geometry.attributes.position;
    attr.array[0] = from.x; attr.array[1] = from.y; attr.array[2] = from.z;
    attr.array[3] = to.x; attr.array[4] = to.y; attr.array[5] = to.z;
    attr.needsUpdate = true;
    t.line.visible = true;
    t.line.material.opacity = 0.9;
    t.life = 0.07;
  }

  function muzzle() {
    flashLife = 0.05;
    flashMat.opacity = 0.55;
    flash.rotation.z = Math.random() * Math.PI;
    flash.scale.setScalar(0.6 + Math.random() * 0.25);
    flashLight.intensity = 14;
  }

  function explosion(pos, radius = 5) {
    const b = booms[bNext];
    bNext = (bNext + 1) % booms.length;
    b.mesh.position.copy(pos);
    b.mesh.scale.setScalar(0.4);
    b.mesh.visible = true;
    b.light.position.copy(pos);
    b.light.position.y += 1;
    b.light.intensity = 90;
    b.life = 0.55;
    b.max = radius;
    burstParticles(pos, 90, new THREE.Color(0xffa040), 9);
    burstParticles(pos, 40, new THREE.Color(0x555049), 5);
  }

  function smoke(x, y, z) {
    const c = clouds[cNext];
    cNext = (cNext + 1) % MAX_CLOUDS;
    c.x = x; c.y = Math.max(0.9, y); c.z = z;
    c.life = 12;
    c.max = 12;
    c.group.visible = true;
    for (let j = 0; j < c.puffs.length; j += 1) {
      const puff = c.puffs[j];
      const a = (j / c.puffs.length) * Math.PI * 2 + c.seed;
      puff.position.set(Math.cos(a) * 1.1, 0.4 + (j % 3) * 0.7, Math.sin(a) * 1.1);
      puff.scale.setScalar(1.4);
      puff.material.opacity = 0.55;
    }
  }

  // Does segment a->b cross any live smoke cloud? (sphere test per puff.)
  function blockedBySmoke(a, b) {
    for (const c of clouds) {
      if (c.life <= 0) continue;
      tmpA.set(c.x - a.x, c.y - a.y, c.z - a.z);
      tmpB.set(b.x - a.x, b.y - a.y, b.z - a.z);
      const lenSq = tmpB.lengthSq() || 1;
      let t = tmpA.dot(tmpB) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const dx = a.x + tmpB.x * t - c.x;
      const dy = a.y + tmpB.y * t - c.y;
      const dz = a.z + tmpB.z * t - c.z;
      if (dx * dx + dy * dy + dz * dz < 2.6 * 2.6) return true;
    }
    return false;
  }

  function step(dt) {
    // particles
    let dirty = false;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (pLife[i] <= 0) continue;
      dirty = true;
      pLife[i] -= dt;
      if (pLife[i] <= 0) {
        pPos[i * 3 + 1] = -100;
        continue;
      }
      pVel[i * 3 + 1] -= 9 * dt;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pPos[i * 3 + 1] < 0.03) {
        pPos[i * 3 + 1] = 0.03;
        pVel[i * 3 + 1] *= -0.3;
      }
    }
    if (dirty) pGeo.attributes.position.needsUpdate = true;
    // tracers
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) t.line.visible = false;
    }
    // muzzle
    if (flashLife > 0) {
      flashLife -= dt;
      if (flashLife <= 0) {
        flashMat.opacity = 0;
        flashLight.intensity = 0;
      }
    }
    // explosions
    for (const b of booms) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const k = 1 - Math.max(0, b.life) / 0.55;
      b.mesh.scale.setScalar(0.4 + k * b.max);
      b.mesh.material.opacity = Math.max(0, 0.55 - k * 0.55);
      b.light.intensity = Math.max(0, 90 * (1 - k));
      if (b.life <= 0) {
        b.mesh.visible = false;
        b.light.intensity = 0;
      }
    }
    // smoke
    for (const c of clouds) {
      if (c.life <= 0) continue;
      c.life -= dt;
      const age = 1 - c.life / c.max;
      const grow = Math.min(1, age * 3);
      const fade = c.life < 3 ? c.life / 3 : 1;
      for (let j = 0; j < c.puffs.length; j += 1) {
        const puff = c.puffs[j];
        puff.scale.setScalar((1.4 + grow * 1.6) * (0.8 + (j % 3) * 0.25));
        puff.material.opacity = 0.5 * fade;
        puff.position.y += Math.sin(age * 6 + j) * dt * 0.15;
      }
      if (c.life <= 0) c.group.visible = false;
    }
  }

  return { step, burstParticles, addTracer, muzzle, explosion, smoke, blockedBySmoke };
}
