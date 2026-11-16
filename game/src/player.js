// Movement: a capsule approximated by an AABB, resolved one axis at a time
// against the world's colliders, so a wall never swallows a body. The same
// mover drives the player and every bot; only the wish direction differs.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const GRAVITY = 20;
const JUMP_SPEED = 6.4;

export function createMover(colliders, spawn) {
  const body = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: spawn.yaw ?? 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
  const probe = new THREE.Box3();

  function obstacleAt(position, height, inset = 0) {
    probe.min.set(position.x - RADIUS, position.y + inset, position.z - RADIUS);
    probe.max.set(position.x + RADIUS, position.y + height - inset, position.z + RADIUS);
    for (let i = 0; i < colliders.length; i++) {
      if (colliders[i].intersectsBox(probe)) return colliders[i];
    }
    return null;
  }

  function updateStance(crouch, seconds) {
    const blockedAbove = obstacleAt(body.position, STAND_HEIGHT, 0.02) !== null;
    body.crouching = crouch || (blockedAbove && body.crouching);
    body.height = body.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
    const desiredEye = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye = THREE.MathUtils.lerp(body.eye, desiredEye, Math.min(seconds * 12, 1));
  }

  function moveHorizontal(axis, seconds) {
    const start = body.position[axis];
    const travel = seconds * body.velocity[axis];
    body.position[axis] = start + travel;
    if (obstacleAt(body.position, body.height, 0.04)) {
      body.position[axis] = start;
      body.velocity[axis] = 0;
    }
  }

  function moveVertical(seconds) {
    const p = body.position;
    const v = body.velocity;
    p.y += seconds * v.y;
    body.onGround = false;
    const surface = obstacleAt(p, body.height);
    if (surface) {
      const descending = v.y <= 0;
      p.y = descending ? surface.max.y : surface.min.y - body.height;
      body.onGround = descending;
      v.y = 0;
    }
    if (p.y < 0) {
      p.y = 0;
      v.y = 0;
      body.onGround = true;
    }
    v.y = Math.max(v.y, -30);
  }

  // Wish direction is normalized by the caller. Axis separation permits
  // sliding along a wall without pushing the capsule into the corner.
  function step(dt, wishX, wishZ, speed, crouch, jump) {
    updateStance(crouch, dt);
    const velocity = body.velocity;
    const acceleration = body.onGround ? 42 : 9;
    const weight = Math.min(dt * acceleration / Math.max(speed, 0.1), 1);
    velocity.x = THREE.MathUtils.lerp(velocity.x, wishX * speed, weight);
    velocity.z = THREE.MathUtils.lerp(velocity.z, wishZ * speed, weight);
    const stationary = wishX === 0 && wishZ === 0;
    if (stationary && body.onGround) {
      const friction = Math.max(1 - dt * 9, 0);
      velocity.x *= friction;
      velocity.z *= friction;
    }
    if (jump && body.onGround) {
      velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    velocity.y -= dt * GRAVITY;
    moveHorizontal('x', dt);
    moveHorizontal('z', dt);
    moveVertical(dt);
  }

  return {
    body,
    step,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    teleport(x, z, yaw) {
      body.position.set(x, 0, z);
      body.velocity.set(0, 0, 0);
      if (yaw !== undefined) body.yaw = yaw;
      body.pitch = 0;
      body.onGround = true;
      body.crouching = false;
      body.height = STAND_HEIGHT;
      body.eye = STAND_EYE;
    },
  };
}

export function createPlayer(colliders, spawn) {
  const mover = createMover(colliders, spawn);
  const { body } = mover;
  const clampPitch = (angle) => Math.min(1.45, Math.max(-1.45, angle));

  function look(dx, dy, sensitivity = 0.0021) {
    body.yaw -= sensitivity * dx;
    body.pitch = clampPitch(body.pitch - sensitivity * dy);
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = clampPitch(body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys, speedScale = 1) {
    const crouch = keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight');
    const walk = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
    const sideways = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    const sine = Math.sin(body.yaw);
    const cosine = Math.cos(body.yaw);
    const x = sideways * cosine - forward * sine;
    const z = -sideways * sine - forward * cosine;
    const normalizer = Math.hypot(x, z) || 1;
    const stanceSpeed = crouch ? 2.5 : 5.4;
    const speed = stanceSpeed * speedScale * (walk ? 0.55 : 1);
    mover.step(dt, x / normalizer, z / normalizer, speed, crouch, keys.has('Space'));
  }

  return { ...mover, mover, look, recoil, step };
}
