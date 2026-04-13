import * as THREE from "three";

const DROP_BOB_SPEED  = 2.0;   // Hz do balanceio
const DROP_BOB_AMP    = 0.10;  // amplitude metros
const DROP_ROT_SPEED  = 1.8;   // rad/s
const DROP_DESPAWN    = 90;    // segundos
const PICKUP_RADIUS   = 1.5;

/** Cor canônica de cada itemId para o mini-cubo de drop */
const DROP_COLORS: Record<string, number> = {
  grass_block: 0x58a032,
  dirt_block:  0x8b5e3c,
  stone_block: 0x7a7a7a,
  wood_log:    0x7a5c3a,
  leaf_block:  0x3a8020,
  // armas (cor metálica genérica)
  m9:       0x2a2a2a,
  glock17:  0x2a2a2a,
  deagle:   0x444433,
  ak47:     0x2a2a20,
  m4a1:     0x1e2228,
  mp5:      0x222222,
  uzi:      0x1a1a1a,
  spas12:   0x3a2a20,
  awp:      0x2a3030,
  m1garand: 0x4a3a28,
};

type ItemDrop = {
  mesh:      THREE.Mesh;
  groundY:   number;     // Y do solo → base do balanceio
  itemId:    string;
  itemLabel: string;
  bobPhase:  number;     // offset de fase aleatório
  life:      number;     // tempo restante
};

export class ItemDropSystem {
  private readonly drops: ItemDrop[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /** Spawna um drop flutuante na posição indicada. */
  spawnDrop(position: THREE.Vector3, itemId: string, itemLabel: string): void {
    const isWeapon = !itemId.includes("block") && !itemId.includes("log");
    const geo      = isWeapon 
        ? new THREE.BoxGeometry(0.7, 0.2, 0.05) // Slot format para armas
        : new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const color    = DROP_COLORS[itemId] ?? 0xffffff;
    const mat      = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: isWeapon ? 0.4 : 0 });
    const mesh     = new THREE.Mesh(geo, mat);

    const groundY = position.y;
    mesh.position.set(position.x, groundY + DROP_BOB_AMP + 0.25, position.z);
    mesh.castShadow = true;
    this.scene.add(mesh);

    this.drops.push({
      mesh,
      groundY,
      itemId,
      itemLabel,
      bobPhase: Math.random() * Math.PI * 2,
      life: DROP_DESPAWN,
    });
  }

  /** Atualiza posição e rotação de todos os drops. */
  update(delta: number, elapsed: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= delta;

      // Balanceio vertical
      d.mesh.position.y = d.groundY + 0.25 + Math.sin(elapsed * DROP_BOB_SPEED + d.bobPhase) * DROP_BOB_AMP;

      // Rotação
      d.mesh.rotation.y += DROP_ROT_SPEED * delta;

      // Despawn
      if (d.life <= 0) {
        this.remove(i);
      }
    }
  }

  /**
   * Retorna o drop mais próximo do jogador (se houver algum) sem apagá-lo.
   */
  getNearbyDrop(playerPos: THREE.Vector3): { index: number; itemId: string; itemLabel: string } | null {
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      const dx = d.mesh.position.x - playerPos.x;
      const dz = d.mesh.position.z - playerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= PICKUP_RADIUS) {
        return { index: i, itemId: d.itemId, itemLabel: d.itemLabel };
      }
    }
    return null;
  }

  removeDrop(index: number): void {
    const d = this.drops[index];
    if (!d) return;
    this.scene.remove(d.mesh);
    d.mesh.geometry.dispose();
    (d.mesh.material as THREE.Material).dispose();
    this.drops.splice(index, 1);
  }

  private remove(index: number): void {
    this.removeDrop(index);
  }
}
