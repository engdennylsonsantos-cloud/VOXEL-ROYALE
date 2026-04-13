import * as THREE from "three";

// ── Bala 3D ─────────────────────────────────────────────────────────────────
const BULLET_SPEED  = 360;   // m/s
const BULLET_LIFE   = 0.32;  // segundos até desaparecer

// Geometria cilíndrica orientada pelo eixo Y — será rotacionada para a direção do disparo
const BULLET_BODY_GEO = new THREE.CylinderGeometry(0.022, 0.016, 0.22, 6);
const BULLET_TIP_GEO  = new THREE.SphereGeometry(0.022, 4, 4);

// Material brass/dourado — MeshBasicMaterial para ser visível sem depender de luz
const BULLET_MAT = new THREE.MeshBasicMaterial({ color: 0xe8c840 });
const BULLET_TIP_MAT = new THREE.MeshBasicMaterial({ color: 0xffd060 });

// ── Muzzle flash ────────────────────────────────────────────────────────────
const FLASH_GEO = new THREE.SphereGeometry(0.20, 6, 6);
const FLASH_MAT = new THREE.MeshBasicMaterial({
  color:       0xffcc44,
  transparent: true,
  blending:    THREE.AdditiveBlending,
  depthWrite:  false,
});

// ── Impacto / fagulhas ──────────────────────────────────────────────────────
const IMPACT_GEO = new THREE.PlaneGeometry(0.12, 0.12);

// Eixo base da geometria do cilindro (eixo Y)
const _BULLET_UP = new THREE.Vector3(0, 1, 0);

type Bullet = {
  group:    THREE.Group;
  velocity: THREE.Vector3;
  life:     number;
  mat:      THREE.MeshBasicMaterial;
};

type Flash = {
  mesh: THREE.Mesh;
  life: number;
};

type ImpactMark = {
  mesh:    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  life:    number;
  maxLife: number;
};

export class CombatEffects {
  private readonly bullets: Bullet[]      = [];
  private readonly flashes: Flash[]       = [];
  private readonly impacts: ImpactMark[]  = [];

  constructor(private readonly scene: THREE.Scene, _camera?: THREE.Camera) {}

  spawnProjectile(origin: THREE.Vector3, direction: THREE.Vector3, _speed?: number): void {
    const dir = direction.clone().normalize();

    // Cria a bala como grupo: corpo cilíndrico + ponta esférica
    const body = new THREE.Mesh(BULLET_BODY_GEO, BULLET_MAT.clone());
    const tip  = new THREE.Mesh(BULLET_TIP_GEO,  BULLET_TIP_MAT.clone());
    tip.position.y = 0.12; // topo do cilindro

    const group = new THREE.Group();
    group.add(body, tip);

    // Rotaciona o grupo para alinhar o eixo Y com a direção do tiro
    group.quaternion.setFromUnitVectors(_BULLET_UP, dir);

    // Posição inicial: um pouco à frente da boca do cano (evita clipping)
    group.position.copy(origin).addScaledVector(dir, 0.35);
    this.scene.add(group);

    // Muzzle flash
    const flash = new THREE.Mesh(FLASH_GEO, FLASH_MAT.clone());
    flash.position.copy(origin);
    this.scene.add(flash);
    this.flashes.push({ mesh: flash, life: 0.05 });

    this.bullets.push({
      group,
      velocity: dir.clone().multiplyScalar(BULLET_SPEED),
      life:     BULLET_LIFE,
      mat:      body.material as THREE.MeshBasicMaterial,
    });
  }

  spawnImpact(position: THREE.Vector3, normal: THREE.Vector3): void {
    // Fagulhas
    for (let i = 0; i < 6; i++) {
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.020, 4, 4),
        new THREE.MeshBasicMaterial({
          color:    0xffcc00,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      spark.position
        .copy(position)
        .addScaledVector(normal, 0.04)
        .addScaledVector(
          new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5),
          0.09
        );
      this.scene.add(spark);
      setTimeout(() => this.scene.remove(spark), 200);
    }

    // Marca de impacto (decal plano)
    const mark = new THREE.Mesh(
      IMPACT_GEO,
      new THREE.MeshBasicMaterial({
        color:       0x222222,
        side:        THREE.DoubleSide,
        transparent: true,
        opacity:     0.85,
      })
    );
    mark.position.copy(position).addScaledVector(normal, 0.022);
    mark.lookAt(position.clone().add(normal));
    this.scene.add(mark);
    this.impacts.push({ mesh: mark, life: 12, maxLife: 12 });

    if (this.impacts.length > 40) {
      const old = this.impacts.shift()!;
      this.scene.remove(old.mesh);
      old.mesh.material.dispose();
    }
  }

  update(delta: number): void {
    // ── Balas ──────────────────────────────────────────────────────────────
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.group.position.addScaledVector(b.velocity, delta);
      b.life -= delta;

      // Fade-out nos últimos 20% de vida
      const alpha = Math.max(0, b.life / (BULLET_LIFE * 0.2));
      b.mat.opacity  = Math.min(1, alpha);
      b.mat.transparent = b.mat.opacity < 1;

      if (b.life <= 0) {
        this.scene.remove(b.group);
        // Dispõe materiais clonados para evitar leak
        b.group.traverse(obj => {
          if ((obj as THREE.Mesh).isMesh) {
            ((obj as THREE.Mesh).material as THREE.Material).dispose();
          }
        });
        this.bullets.splice(i, 1);
      }
    }

    // ── Muzzle flash ───────────────────────────────────────────────────────
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= delta;
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, f.life / 0.05);
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        (f.mesh.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
      }
    }

    // ── Marcas de impacto ──────────────────────────────────────────────────
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const imp = this.impacts[i];
      imp.life -= delta;
      imp.mesh.material.opacity = Math.max(0, imp.life / imp.maxLife) * 0.85;
      if (imp.life <= 0) {
        this.scene.remove(imp.mesh);
        imp.mesh.material.dispose();
        this.impacts.splice(i, 1);
      }
    }
  }
}
