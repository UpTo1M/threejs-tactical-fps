// Visual effects, pooled so the hot loop allocates nothing: tracers,
// impact sparks, muzzle flash, explosions and smoke clouds. Smoke also
// answers line-of-sight questions for the bots.
import * as THREE from 'three';

const MAX_PARTICLES = 512;
const MAX_TRACERS = 32;
const MAX_CLOUDS = 6;
const SMOKE_RADIUS_SQUARED = 2.6 ** 2;

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
  // Inactive slots start below the floor, just like expired particles.
  for (let index = 1; index < pPos.length; index += 3) pPos[index] = -100;

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

  // --- muzzle flash: textured plane + light on the camera ---
  // A radial star texture, so the flash reads as a burst of light instead
  // of the flat square the plain plane used to be.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 128;
  flashCanvas.height = 128;
  {
    const g = flashCanvas.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.25, 'rgba(255,196,107,0.9)');
    grad.addColorStop(0.6, 'rgba(255,140,60,0.35)');
    grad.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,220,160,0.85)';
    g.fillRect(60, 6, 8, 116);
    g.fillRect(6, 60, 116, 8);
  }
  const flashTex = new THREE.CanvasTexture(flashCanvas);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
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

  function burstParticles(origin, count, color, speed = 4) {
    for (let n = 0; n < count; n++) {
      const slot = pNext;
      pNext = (pNext + 1) % MAX_PARTICLES;
      const offset = slot * 3;
      pGeo.attributes.position.setXYZ(slot, origin.x, origin.y, origin.z);
      const azimuth = Math.random() * (2 * Math.PI);
      const elevation = (Math.random() - 0.5) * Math.PI;
      const velocity = speed * (0.4 + Math.random() * 0.8);
      const horizontal = velocity * Math.cos(elevation);
      pVel[offset] = horizontal * Math.cos(azimuth);
      pVel[offset + 1] = velocity * Math.abs(Math.sin(elevation)) + 1.2;
      pVel[offset + 2] = horizontal * Math.sin(azimuth);
      pGeo.attributes.color.setXYZ(slot, color.r, color.g, color.b);
      pLife[slot] = 0.35 + Math.random() * 0.4;
    }
    pGeo.getAttribute('position').needsUpdate = true;
    pGeo.getAttribute('color').needsUpdate = true;
  }

  function addTracer(from, to) {
    if (!finitePoint(from) || !finitePoint(to)) return;
    const tracer = tracers[tNext];
    tNext = (tNext + 1) % MAX_TRACERS;
    const positions = tracer.line.geometry.attributes.position;
    positions.setXYZ(0, from.x, from.y, from.z);
    positions.setXYZ(1, to.x, to.y, to.z);
    positions.needsUpdate = true;
    tracer.life = 0.07;
    tracer.line.visible = true;
    tracer.line.material.opacity = 0.9;
  }

  function finitePoint(point) {
    return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
  }

  function muzzle() {
    flashLife = 0.05;
    flashMat.opacity = 0.55;
    flash.rotation.z = Math.random() * Math.PI;
    flash.scale.setScalar(0.6 + Math.random() * 0.25);
    flashLight.intensity = 14;
  }

  const fireColor = new THREE.Color(0xffa040);
  const debrisColor = new THREE.Color(0x555049);
  function explosion(pos, radius = 5) {
    const boom = booms[bNext];
    bNext = (bNext + 1) % booms.length;
    boom.life = 0.55;
    boom.max = radius;
    boom.mesh.position.copy(pos);
    boom.mesh.scale.setScalar(0.4);
    boom.mesh.material.opacity = 0.55;
    boom.mesh.visible = true;
    boom.light.position.copy(pos);
    boom.light.position.y += 1;
    boom.light.intensity = 90;
    burstParticles(pos, 90, fireColor, 9);
    burstParticles(pos, 40, debrisColor, 5);
  }

  function smoke(x, y, z) {
    const cloud = clouds[cNext];
    cNext = (cNext + 1) % MAX_CLOUDS;
    Object.assign(cloud, { x, y: Math.max(y, 0.9), z, life: 12, max: 12 });
    cloud.group.position.set(x, cloud.y, z);
    cloud.group.visible = true;
    for (let i = 0; i < cloud.puffs.length; i++) {
      const puff = cloud.puffs[i];
      const phase = cloud.seed + (i / cloud.puffs.length) * (2 * Math.PI);
      puff.position.set(1.1 * Math.cos(phase), 0.4 + 0.7 * (i % 3), 1.1 * Math.sin(phase));
      puff.scale.setScalar(1.4);
      puff.material.opacity = 0.55;
    }
  }

  // Project each cloud centre onto the finite sight segment. This handles
  // an observer inside smoke and zero-length segments without division by 0.
  function blockedBySmoke(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const squaredLength = dx * dx + dy * dy + dz * dz;
    for (const volume of clouds) {
      if (volume.life <= 0) continue;
      const cx = volume.x - a.x;
      const cy = volume.y - a.y;
      const cz = volume.z - a.z;
      const dot = cx * dx + cy * dy + cz * dz;
      const along = squaredLength > 0 ? Math.min(1, Math.max(0, dot / squaredLength)) : 0;
      const ex = dx * along - cx;
      const ey = dy * along - cy;
      const ez = dz * along - cz;
      if (ex * ex + ey * ey + ez * ez < SMOKE_RADIUS_SQUARED) return true;
    }
    return false;
  }

  function stepParticles(dt) {
    let changed = false;
    for (let slot = 0; slot < MAX_PARTICLES; slot++) {
      if (pLife[slot] <= 0) continue;
      changed = true;
      const offset = slot * 3;
      pLife[slot] -= dt;
      if (pLife[slot] <= 0) {
        pPos[offset + 1] = -100;
        continue;
      }
      pVel[offset + 1] -= dt * 9;
      for (let axis = 0; axis < 3; axis++) {
        pPos[offset + axis] += dt * pVel[offset + axis];
      }
      if (pPos[offset + 1] < 0.03) {
        pPos[offset + 1] = 0.03;
        pVel[offset + 1] *= -0.3;
      }
    }
    if (changed) pGeo.attributes.position.needsUpdate = true;
  }

  function stepSmoke(dt) {
    for (const cloud of clouds) {
      if (cloud.life <= 0) continue;
      cloud.life = Math.max(cloud.life - dt, 0);
      const age = 1 - cloud.life / cloud.max;
      const expansion = 1.4 + 1.6 * Math.min(age * 3, 1);
      const opacity = 0.5 * Math.min(cloud.life / 3, 1);
      for (let i = 0; i < cloud.puffs.length; i++) {
        const puff = cloud.puffs[i];
        puff.scale.setScalar(expansion * (0.8 + 0.25 * (i % 3)));
        puff.material.opacity = opacity;
        puff.position.y += dt * 0.15 * Math.sin(age * 6 + i);
      }
      cloud.group.visible = cloud.life > 0;
    }
  }

  function step(dt) {
    stepParticles(dt);
    stepSmoke(dt);
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life = Math.max(0, tracer.life - dt);
      tracer.line.material.opacity = tracer.life / 0.07 * 0.9;
      tracer.line.visible = tracer.life > 0;
    }
    flashLife = Math.max(0, flashLife - dt);
    if (flashLife === 0) {
      flashMat.opacity = 0;
      flashLight.intensity = 0;
    }
    for (const boom of booms) {
      if (boom.life <= 0) continue;
      boom.life = Math.max(0, boom.life - dt);
      const fraction = boom.life / 0.55;
      boom.mesh.scale.setScalar(boom.max * (1 - fraction) + 0.4);
      boom.mesh.material.opacity = fraction * 0.55;
      boom.light.intensity = fraction * 90;
      boom.mesh.visible = boom.life > 0;
    }
  }

  return { step, burstParticles, addTracer, muzzle, explosion, smoke, blockedBySmoke };
}
