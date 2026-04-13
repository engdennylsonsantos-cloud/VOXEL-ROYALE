import * as THREE from "three";

const metalMat = new THREE.MeshStandardMaterial({ color: 0x858b93, roughness: 0.38, metalness: 0.92 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.58, metalness: 0.58 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x6f4b2b, roughness: 0.86, metalness: 0.04 });
const gripMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.9, metalness: 0.04 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x5aa6d6, roughness: 0.08, metalness: 0.2 });
const redMat = new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0x660000, roughness: 0.15, metalness: 0 });

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  return mesh;
}

function buildM9(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.16, 0.22, 0.72, metalMat, 0.06, -0.01, -0.28));
  g.add(box(0.075, 0.075, 0.96, metalMat, 0.06, 0.03, -0.82));
  g.add(box(0.14, 0.18, 0.55, darkMat, 0.06, 0.03, -0.18));
  g.add(box(0.08, 0.07, 0.18, darkMat, 0.06, -0.16, -0.14));
  g.add(box(0.12, 0.30, 0.14, gripMat, 0.04, -0.24, -0.05, 0.08, 0, 0));
  g.add(box(0.04, 0.07, 0.04, metalMat, 0.06, 0.13, -0.52));
  g.add(box(0.08, 0.07, 0.04, metalMat, 0.06, 0.13, -0.08));
  return g;
}

function buildGlock17(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.16, 0.20, 0.68, darkMat, 0.06, -0.01, -0.24));
  g.add(box(0.07, 0.07, 0.92, metalMat, 0.06, 0.03, -0.78));
  g.add(box(0.14, 0.17, 0.50, darkMat, 0.06, 0.03, -0.14));
  g.add(box(0.13, 0.30, 0.13, darkMat, 0.04, -0.24, -0.05));
  g.add(box(0.06, 0.06, 0.04, metalMat, 0.06, 0.12, -0.50));
  g.add(box(0.08, 0.06, 0.04, metalMat, 0.06, 0.12, -0.08));
  return g;
}

function buildDeagle(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.20, 0.26, 0.80, metalMat, 0.07, -0.01, -0.30));
  g.add(box(0.09, 0.09, 1.10, metalMat, 0.07, 0.04, -0.90));
  g.add(box(0.17, 0.22, 0.60, darkMat, 0.07, 0.04, -0.22));
  g.add(box(0.16, 0.35, 0.16, darkMat, 0.06, -0.25, -0.05));
  g.add(box(0.06, 0.08, 0.04, metalMat, 0.07, 0.16, -0.60));
  g.add(box(0.10, 0.08, 0.04, metalMat, 0.07, 0.16, -0.08));
  g.add(box(0.12, 0.12, 0.14, darkMat, 0.07, 0.04, -1.50));
  return g;
}

function buildAK47(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.16, 0.20, 1.20, darkMat, 0.04, 0.00, -0.60));
  g.add(box(0.06, 0.06, 1.30, metalMat, 0.04, 0.02, -1.55));
  g.add(box(0.14, 0.16, 0.52, woodMat, 0.04, -0.08, 0.26));
  g.add(box(0.10, 0.35, 0.16, darkMat, 0.04, -0.24, -0.46));
  g.add(box(0.10, 0.35, 0.16, darkMat, 0.04, -0.30, -0.32));
  g.add(box(0.14, 0.12, 0.48, woodMat, 0.04, -0.10, -0.84));
  g.add(box(0.04, 0.10, 0.04, metalMat, 0.04, 0.15, -1.90));
  g.add(box(0.12, 0.06, 0.04, metalMat, 0.04, 0.14, -0.06));
  return g;
}

function buildM4A1(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.14, 0.18, 1.10, darkMat, 0.04, 0.00, -0.55));
  g.add(box(0.06, 0.06, 1.20, metalMat, 0.04, 0.02, -1.40));
  g.add(box(0.12, 0.12, 0.50, darkMat, 0.04, -0.05, 0.22));
  g.add(box(0.14, 0.18, 0.22, darkMat, 0.04, -0.05, 0.48));
  g.add(box(0.10, 0.30, 0.14, darkMat, 0.04, -0.22, -0.42));
  g.add(box(0.14, 0.12, 0.50, darkMat, 0.04, -0.08, -0.82));
  const rdot = new THREE.Group();
  rdot.position.set(0.04, 0.18, -0.30);
  rdot.add(box(0.10, 0.10, 0.14, darkMat));
  rdot.add(box(0.07, 0.07, 0.08, glassMat, 0, 0, -0.10));
  rdot.add(box(0.02, 0.02, 0.02, redMat, 0, 0, -0.10));
  g.add(rdot);
  return g;
}

function buildMP5(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.14, 0.18, 0.90, darkMat, 0.04, 0.00, -0.44));
  g.add(box(0.06, 0.06, 1.00, metalMat, 0.04, 0.02, -1.10));
  g.add(box(0.13, 0.10, 0.44, darkMat, 0.04, -0.12, 0.18));
  g.add(box(0.09, 0.26, 0.12, darkMat, 0.04, -0.20, -0.36));
  g.add(box(0.14, 0.10, 0.34, darkMat, 0.04, -0.08, -0.72));
  return g;
}

function buildUZI(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.16, 0.22, 0.64, darkMat, 0.05, 0.00, -0.30));
  g.add(box(0.06, 0.06, 0.70, metalMat, 0.05, 0.02, -0.82));
  g.add(box(0.10, 0.34, 0.12, darkMat, 0.05, -0.24, -0.18));
  g.add(box(0.12, 0.22, 0.14, darkMat, 0.04, -0.16, 0.08));
  return g;
}

function buildSPAS12(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.20, 0.24, 0.90, darkMat, 0.04, 0.00, -0.44));
  g.add(box(0.08, 0.08, 1.20, metalMat, 0.04, 0.04, -1.20));
  g.add(box(0.06, 0.06, 0.98, metalMat, 0.04, -0.08, -1.10));
  g.add(box(0.14, 0.16, 0.48, darkMat, 0.04, -0.04, 0.24));
  g.add(box(0.14, 0.28, 0.14, darkMat, 0.04, -0.22, -0.06));
  g.add(box(0.18, 0.16, 0.38, darkMat, 0.04, -0.06, -0.90));
  return g;
}

function buildAWP(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.14, 0.18, 1.60, darkMat, 0.04, 0.00, -0.80));
  g.add(box(0.05, 0.05, 1.80, metalMat, 0.04, 0.04, -1.90));
  g.add(box(0.14, 0.20, 0.60, woodMat, 0.04, -0.06, 0.30));
  g.add(box(0.09, 0.22, 0.12, darkMat, 0.04, -0.17, -0.50));
  const scope = new THREE.Group();
  scope.position.set(0.04, 0.22, -0.70);
  scope.add(box(0.12, 0.12, 0.70, darkMat));
  scope.add(box(0.08, 0.08, 0.12, glassMat, 0, 0, -0.40));
  scope.add(box(0.08, 0.08, 0.12, glassMat, 0, 0, 0.40));
  g.add(scope);
  g.add(box(0.04, 0.14, 0.04, metalMat, -0.04, -0.20, -1.60));
  g.add(box(0.04, 0.14, 0.04, metalMat, 0.12, -0.20, -1.60));
  return g;
}

function buildM1Garand(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.16, 0.22, 1.60, woodMat, 0.04, -0.02, -0.80));
  g.add(box(0.14, 0.18, 0.70, metalMat, 0.04, 0.04, -0.35));
  g.add(box(0.055, 0.055, 1.60, metalMat, 0.04, 0.06, -1.60));
  g.add(box(0.10, 0.12, 0.18, metalMat, 0.04, 0.16, -0.25));
  g.add(box(0.04, 0.10, 0.04, metalMat, 0.04, 0.16, -2.30));
  g.add(box(0.12, 0.08, 0.04, metalMat, 0.04, 0.15, -0.06));
  return g;
}

export function createRemoteWeaponModel(weaponId: string): THREE.Group | null {
  switch (weaponId) {
    case "m9": return buildM9();
    case "glock17": return buildGlock17();
    case "deagle": return buildDeagle();
    case "ak47": return buildAK47();
    case "m4a1": return buildM4A1();
    case "mp5": return buildMP5();
    case "uzi": return buildUZI();
    case "spas12":
    case "escopeta": return buildSPAS12();
    case "awp": return buildAWP();
    case "m1garand": return buildM1Garand();
    default: return null;
  }
}
