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

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  // wishX/wishZ: world-space desired direction (already normalised or zero).
  // speed in m/s, crouch + jump flags. Fixed-step only.
  function step(dt, wishX, wishZ, speed, crouch, jump) {
    if (crouch && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!crouch && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const accel = body.onGround ? 42 : 9;
    const blend = Math.min(1, (accel * dt) / Math.max(0.1, speed));
    body.velocity.x += (wishX * speed - body.velocity.x) * blend;
    body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
    if (body.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - 9 * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (jump && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
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
    },
  };
}

export function createPlayer(colliders, spawn) {
  const mover = createMover(colliders, spawn);
  const body = mover.body;
  const WALK_SPEED = 5.4;
  const CROUCH_SPEED = 2.5;

  function look(dx, dy, sensitivity = 0.0021) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  // keys: input.state.keys. speedScale: weapon weight / scoped slowdown.
  function step(dt, keys, speedScale = 1) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wishX = -sin * forward + cos * strafe;
      wishZ = -cos * forward - sin * strafe;
      const len = Math.hypot(wishX, wishZ) || 1;
      wishX /= len;
      wishZ /= len;
    }
    const walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = (crouching ? CROUCH_SPEED : WALK_SPEED) * (walking ? 0.55 : 1) * speedScale;
    mover.step(dt, wishX, wishZ, speed, crouching, keys.has('Space'));
  }

  return { mover, ...mover, step, look, recoil };
}
