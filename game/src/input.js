// Accumulate browser input until the next fixed simulation tick.
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

  function reset() {
    state.keys.clear();
    state.pressed.clear();
    state.firing = false;
    state.firingAlt = false;
    state.lookX = 0;
    state.lookY = 0;
  }

  function keyDown(event) {
    const { code, repeat } = event;
    if (code === 'Space') event.preventDefault();
    if (repeat) return;
    state.keys.add(code);
    state.pressed.add(code);
  }
  function keyUp(event) {
    state.keys.delete(event.code);
  }
  function mouseButton(event) {
    const down = event.type === 'mousedown';
    if (down && !state.locked) return;
    switch (event.button) {
      case 0: state.firing = down; break;
      case 2: state.firingAlt = down; break;
    }
  }
  function mouseLook({ movementX, movementY }) {
    if (state.locked) {
      state.lookX += movementX;
      state.lookY += movementY;
    }
  }
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('mousedown', mouseButton);
  window.addEventListener('mouseup', mouseButton);
  window.addEventListener('mousemove', mouseLook);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) reset();
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) reset();
    onLockChange(state.locked);
  });

  const lookSample = { x: 0, y: 0 };
  let spareEdges = new Set();

  return {
    state,
    requestLock() {
      try {
        const request = canvas.requestPointerLock();
        request?.catch(() => {});
      } catch {
        // Browser automation may have no user activation; a later click retries.
      }
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      lookSample.x = state.lookX;
      lookSample.y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return lookSample;
    },
    takePressed() {
      const consumed = state.pressed;
      spareEdges.clear();
      state.pressed = spareEdges;
      spareEdges = consumed;
      return consumed;
    },
  };
}
