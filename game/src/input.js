// Keyboard + mouse input with pointer lock. One shared state object; the
// simulation reads it, the renderer never does.
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    firingAlt: false, // right mouse: scope / aim
    locked: false,
    lookX: 0,
    lookY: 0,
    pressed: new Set(), // keys pressed since last takePressed() (edge events)
  };

  function onKeyDown(event) {
    if (event.repeat) return;
    state.keys.add(event.code);
    state.pressed.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) {
    state.keys.delete(event.code);
  }
  function onMouseDown(event) {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.firingAlt = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.firingAlt = false;
  }
  function onMouseMove(event) {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  }
  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      state.keys.clear();
      state.pressed.clear();
      state.firing = false;
      state.firingAlt = false;
    }
    onLockChange(state.locked);
  }
  function onContextMenu(event) {
    event.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    state,
    requestLock() {
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch {
        // headless / no user gesture: the game still runs without the lock
      }
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    takePressed() {
      const pressed = state.pressed;
      state.pressed = new Set();
      return pressed;
    },
  };
}
