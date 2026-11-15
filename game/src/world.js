// Kestrel Yard: an original three-lane industrial yard, 40 x 32 m.
// Attackers spawn south, defenders north. Two spike sites: A "Crane" (west)
// and B "Silo" (east), joined by west / mid / east lanes and connectors.
// Every solid is a collider for movement and a surface bullets stop on.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP = {
  bounds: { minX: -20, maxX: 20, minZ: -16, maxZ: 16 },
  siteA: { name: 'Crane', x: -13.5, z: -9.5, r: 5.2 },
  siteB: { name: 'Silo', x: 13.5, z: -9.5, r: 5.2 },
  attackerSpawn: { x: 0, z: 13.5, yaw: 0 },
  defenderSpawn: { x: 0, z: -13.5, yaw: Math.PI },
  roundTime: 100,
  buyTime: 12,
  plantTime: 3.5,
  spikeTime: 35,
  defuseTime: 5,
};

// Waypoint graph bots navigate on (BFS). [x, z] per node.
export const WAYPOINTS = [
  [0, 13.5], [-6, 13], [6, 13], [0, 8], [0, 0], [0, -8],
  [-14, 8], [-16, 0], [-16, -8], [14, 8], [16, 0], [16, -8],
  [-9, -6], [-13.5, -9.5], [-17, -12], [9, -6], [13.5, -9.5], [17, -12],
  [0, -13.5], [-8, -13], [8, -13], [-7, 2], [7, 2], [-5, 3], [5, 3],
];
export const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 6], [2, 9], [1, 3], [2, 3],
  [3, 4], [3, 21], [3, 22], [3, 23], [3, 24],
  [4, 5], [4, 21], [4, 22], [4, 23], [4, 24],
  [5, 12], [5, 15], [5, 18], [5, 19], [5, 20],
  [6, 7], [7, 8], [8, 13], [8, 14], [8, 12],
  [9, 10], [10, 11], [11, 16], [11, 17], [11, 15],
  [12, 13], [13, 14], [15, 16], [16, 17],
  [18, 19], [18, 20], [19, 12], [20, 15], [19, 8], [20, 11],
  [21, 6], [21, 23], [22, 9], [22, 24], [21, 4], [22, 4],
  [12, 5], [15, 5], [6, 1], [9, 2],
];

function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const g = canvas.getContext('2d');
  g.fillStyle = '#262a31';
  g.fillRect(0, 0, 1024, 1024);
  // asphalt speckle
  for (let i = 0; i < 9000; i += 1) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.12)';
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  // concrete slabs
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  for (let x = 0; x <= 1024; x += 128) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, x); g.lineTo(1024, x); g.stroke();
  }
  // painted lane guides (map coords: x -20..20 -> px 0..1024, z -16..16 -> py 0..1024)
  const px = (x) => (x + 20) / 40 * 1024;
  const pz = (z) => (z + 16) / 32 * 1024;
  g.strokeStyle = 'rgba(240,168,48,0.5)';
  g.lineWidth = 5;
  g.setLineDash([28, 22]);
  g.beginPath(); g.moveTo(px(0), pz(14)); g.lineTo(px(0), pz(-8)); g.stroke();
  g.beginPath(); g.moveTo(px(-17), pz(13)); g.lineTo(px(-17), pz(-10)); g.stroke();
  g.beginPath(); g.moveTo(px(17), pz(13)); g.lineTo(px(17), pz(-10)); g.stroke();
  g.setLineDash([]);
  // hazard chevrons at both sites
  function hazard(cx, cz, r) {
    g.save();
    g.translate(px(cx), pz(cz));
    g.strokeStyle = 'rgba(224,120,48,0.85)';
    g.lineWidth = 7;
    const n = 10;
    for (let i = 0; i < n; i += 1) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 0.5) / n) * Math.PI * 2;
      g.beginPath();
      g.moveTo(Math.cos(a0) * r * 2.56, Math.sin(a0) * r * 3.2);
      g.lineTo(Math.cos(a1) * r * 2.56, Math.sin(a1) * r * 3.2);
      g.stroke();
    }
    g.restore();
  }
  hazard(-13.5, -9.5, 40);
  hazard(13.5, -9.5, 40);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  const mat = {
    ground: new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0.02 }),
    wall: new THREE.MeshStandardMaterial({ color: PALETTE.surface, roughness: 0.9, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: PALETTE.hairline, roughness: 0.85, metalness: 0.1 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x8a4a28, roughness: 0.8, metalness: 0.15 }),
    teal: new THREE.MeshStandardMaterial({ color: 0x2e6f66, roughness: 0.8, metalness: 0.15 }),
    amber: new THREE.MeshStandardMaterial({ color: 0x9a7a2e, roughness: 0.8, metalness: 0.15 }),
    silo: new THREE.MeshStandardMaterial({ color: 0x6d7278, roughness: 0.55, metalness: 0.45 }),
    accent: new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.6, metalness: 0.1, emissive: 0x531f08, emissiveIntensity: 0.7 }),
  };

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(rt, rb, h, x, y, z, material, segments = 18) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segments), mat[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const r = Math.max(rt, rb);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - r, y - h / 2, z - r), new THREE.Vector3(x + r, y + h / 2, z + r)));
    shootables.push(mesh);
    return mesh;
  }

  // Ground + perimeter (open sky so the dusk sun reaches the yard).
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(41, 33), mat.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(new THREE.Box3(new THREE.Vector3(-20.5, -0.5, -16.5), new THREE.Vector3(20.5, 0, 16.5)));
  box(41, 5, 0.6, 0, 2.5, -16.3, 'wall');
  box(41, 5, 0.6, 0, 2.5, 16.3, 'wall');
  box(0.6, 5, 33, -20.3, 2.5, 0, 'wall');
  box(0.6, 5, 33, 20.3, 2.5, 0, 'wall');

  // Mid: stacked containers form the central wall with a gap (mid doors).
  box(6, 2.6, 2.4, -6.4, 1.3, -2, 'rust');
  box(6, 2.6, 2.4, 6.4, 1.3, -2, 'teal');
  box(5, 2.6, 2.4, -6.4, 3.9, -2, 'amber');
  box(5, 2.6, 2.4, 6.4, 3.9, -2, 'teal');
  // mid crates to crouch behind
  box(1.4, 1.1, 1.4, -2.6, 0.55, 4.5, 'dark');
  box(1.4, 1.1, 1.4, 2.6, 0.55, 4.5, 'dark');
  box(1.2, 0.8, 1.2, 0, 0.4, -5.5, 'dark');

  // West lane cover
  box(2.4, 2.6, 6, -17.5, 1.3, 4, 'teal');
  box(1.6, 1.1, 1.6, -14.5, 0.55, -1, 'dark');
  box(1.6, 1.1, 1.6, -16.5, 0.55, -5.5, 'dark');
  box(3, 1.2, 1.2, -11, 0.6, 6.5, 'rust');
  // East lane cover (mirrored)
  box(2.4, 2.6, 6, 17.5, 1.3, 4, 'rust');
  box(1.6, 1.1, 1.6, 14.5, 0.55, -1, 'dark');
  box(1.6, 1.1, 1.6, 16.5, 0.55, -5.5, 'dark');
  box(3, 1.2, 1.2, 11, 0.6, 6.5, 'teal');

  // Site A "Crane": gantry crane + crate stacks + barrels.
  box(0.8, 7, 0.8, -17.5, 3.5, -12.5, 'dark');
  box(0.8, 7, 0.8, -10.5, 3.5, -12.5, 'dark');
  box(8.6, 0.9, 1.1, -14, 7.2, -12.5, 'amber');
  box(1.6, 0.9, 1.1, -14, 6.4, -12.5, 'dark');
  box(2.2, 1.1, 2.2, -15.5, 0.55, -7, 'dark');
  box(2.2, 1.1, 2.2, -11.5, 0.55, -7, 'dark');
  box(2.2, 1.1, 2.2, -13.5, 1.65, -7, 'rust');
  box(3.4, 1.1, 1.4, -16.5, 0.55, -11, 'teal');
  cylinder(0.55, 0.55, 1.3, -10.8, 0.65, -11.5, 'rust');
  cylinder(0.55, 0.55, 1.3, -16.8, 0.65, -6.2, 'amber');
  // site A marker pylon
  box(0.5, 3.4, 0.5, -13.5, 1.7, -13.8, 'accent', false);

  // Site B "Silo": twin silos + pipe rack + crates.
  cylinder(2.1, 2.1, 7.5, 15.5, 3.75, -12.5, 'silo');
  cylinder(2.1, 2.1, 6.2, 11.2, 3.1, -13.5, 'silo');
  box(6.5, 0.7, 0.7, 13.4, 5.6, -12.8, 'dark');
  box(2.2, 1.1, 2.2, 11.5, 0.55, -7, 'dark');
  box(2.2, 1.1, 2.2, 15.5, 0.55, -7, 'dark');
  box(2.2, 1.1, 2.2, 13.5, 1.65, -7, 'teal');
  box(3.4, 1.1, 1.4, 16.5, 0.55, -11, 'rust');
  cylinder(0.55, 0.55, 1.3, 10.8, 0.65, -11.5, 'amber');
  cylinder(0.55, 0.55, 1.3, 16.8, 0.65, -6.2, 'rust');
  box(0.5, 3.4, 0.5, 13.5, 1.7, -13.8, 'accent', false);

  // Attacker-side cover near spawn + defender-side blocks.
  box(2.6, 1.1, 1.4, -3.5, 0.55, 10.5, 'dark');
  box(2.6, 1.1, 1.4, 3.5, 0.55, 10.5, 'dark');
  box(2.6, 1.1, 1.4, -8, 0.55, -11, 'dark');
  box(2.6, 1.1, 1.4, 8, 0.55, -11, 'dark');

  // Floodlight poles (visual + light anchors). The lamp glow comes from the
  // point lights at the sites; no emissive box, so nothing floats white.
  const poles = [[-9, 6], [9, 6], [-9, -4], [9, -4]];
  for (const [x, z] of poles) {
    box(0.25, 6.5, 0.25, x, 3.25, z, 'dark', false);
  }

  // Distant skyline silhouettes outside the walls, for depth.
  const skyline = new THREE.Group();
  for (let i = 0; i < 14; i += 1) {
    const a = (i / 14) * Math.PI * 2;
    const r = 55 + (i % 3) * 12;
    const h = 14 + ((i * 37) % 22);
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(8 + (i % 4) * 3, h, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 1 }),
    );
    b.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    skyline.add(b);
  }
  scene.add(skyline);

  // Lighting: low dusk sun, cool sky fill, warm floods at the sites.
  const hemi = new THREE.HemisphereLight(0x8fa3c0, 0x2a2118, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc98a, 2.7);
  sun.position.set(24, 26, 18);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const floodA = new THREE.PointLight(0xffd9a0, 30, 22, 1.6);
  floodA.position.set(-13.5, 6.4, -9.5);
  scene.add(floodA);
  const floodB = new THREE.PointLight(0xffd9a0, 30, 22, 1.6);
  floodB.position.set(13.5, 6.4, -9.5);
  scene.add(floodB);

  return { colliders, shootables, group };
}
