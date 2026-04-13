import * as THREE from "three";

const BUBBLE_COUNT   = 24;
const BUBBLE_RISE    = 0.004; // unidades/frame (camera-space)
const BUBBLE_DRIFT   = 0.025;
const BUBBLE_SPREAD_X = 0.9;
const BUBBLE_SPREAD_Y = 0.6;
const BUBBLE_DEPTH_MIN = -0.5;
const BUBBLE_DEPTH_MAX = -1.8;

type Bubble = {
  mesh: THREE.Mesh;
  baseX: number;
  phase: number;
  riseSpeed: number;
};

export class UnderwaterEffect {
  private readonly overlay: HTMLDivElement;
  private readonly bubbleGroup = new THREE.Group();
  private readonly bubbles: Bubble[] = [];
  private isActive = false;
  private elapsed  = 0;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly hud: HTMLElement,
  ) {
    // ── Sobreposição azulada ────────────────────────────────────────────────
    this.overlay = document.createElement("div");
    Object.assign(this.overlay.style, {
      position:       "absolute",
      inset:          "0",
      background:     "rgba(0, 55, 130, 0.40)",
      pointerEvents:  "none",
      display:        "none",
      zIndex:         "6",
      backdropFilter: "blur(1.5px)",
    });
    this.hud.appendChild(this.overlay);

    // ── Grupo de bolhas preso à câmera ──────────────────────────────────────
    this.bubbleGroup.visible = false;
    (this.camera as THREE.Object3D).add(this.bubbleGroup);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xaaddff,
      transparent: true,
      opacity: 0.55,
    });

    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const r    = 0.008 + Math.random() * 0.016;
      const geo  = new THREE.SphereGeometry(r, 5, 5);
      const mesh = new THREE.Mesh(geo, mat.clone());

      const bx = (Math.random() - 0.5) * BUBBLE_SPREAD_X;
      const by = (Math.random() - 0.5) * BUBBLE_SPREAD_Y;
      const bz = BUBBLE_DEPTH_MIN + Math.random() * (BUBBLE_DEPTH_MAX - BUBBLE_DEPTH_MIN);
      mesh.position.set(bx, by, bz);

      this.bubbleGroup.add(mesh);
      this.bubbles.push({
        mesh,
        baseX:     bx,
        phase:     Math.random() * Math.PI * 2,
        riseSpeed: BUBBLE_RISE * (0.6 + Math.random() * 0.8),
      });
    }
  }

  setActive(active: boolean): void {
    if (this.isActive === active) return;
    this.isActive            = active;
    this.overlay.style.display = active ? "block" : "none";
    this.bubbleGroup.visible   = active;
  }

  /**
   * @param delta segundos desde último frame
   * @param moveForward velocidade de avanço normalizada (-1..1); positivo → aproxima bolhas
   */
  update(delta: number, moveForward: number): void {
    if (!this.isActive) return;
    this.elapsed += delta;

    for (const b of this.bubbles) {
      // Sobe
      b.mesh.position.y += b.riseSpeed;

      // Deriva lateral suave
      b.mesh.position.x = b.baseX + Math.sin(this.elapsed * 1.2 + b.phase) * BUBBLE_DRIFT;

      // Efeito parallax: avançar approxima; recuar afasta
      b.mesh.position.z += moveForward * 0.003;

      // Wrap: sai do topo → reinicia embaixo
      if (b.mesh.position.y > BUBBLE_SPREAD_Y * 0.55) {
        const bx = (Math.random() - 0.5) * BUBBLE_SPREAD_X;
        const bz = BUBBLE_DEPTH_MIN + Math.random() * (BUBBLE_DEPTH_MAX - BUBBLE_DEPTH_MIN);
        b.mesh.position.set(bx, -BUBBLE_SPREAD_Y * 0.55, bz);
        b.baseX = bx;
      }
      // Wrap Z
      if (b.mesh.position.z > -0.3)  b.mesh.position.z = BUBBLE_DEPTH_MAX;
      if (b.mesh.position.z < -2.0)  b.mesh.position.z = BUBBLE_DEPTH_MIN;
    }
  }
}
