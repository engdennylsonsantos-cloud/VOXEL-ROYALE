import * as THREE from "three";
import { WEAPONS, type WeaponDef } from "./WeaponDefs";

// ── Configuração ────────────────────────────────────────────────────────────
const DROP_ALTITUDE       = 180;     // y de lançamento
const DROP_FALL_SPEED     = 12;      // m/s de queda (com paraquedas)
const SMOKE_INTERVAL      = 0.08;    // s entre partículas de fumaça
const SMOKE_LIFETIME      = 4.0;     // s que a fumaça dura
const SMOKE_RISE_SPEED    = 3.5;     // m/s para cima
const CRATE_SIZE          = 0.8;     // tamanho do caixote
const PICKUP_RADIUS       = 3.0;     // distância de interação
const LANDED_SMOKE_RATE   = 0.14;    // s entre partículas de fumaça parado

// Para testes: todas as armas em CADA drop
const ALL_WEAPON_IDS = Object.keys(WEAPONS);

type SmokeParticle = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
};

type AirdropCrate = {
  group:        THREE.Group;           // paraquedas + caixote
  crate:        THREE.Mesh;
  chute:        THREE.Mesh;
  chuteLines:   THREE.LineSegments;
  position:     THREE.Vector3;
  landed:       boolean;
  smokeTimer:   number;
  particles:    SmokeParticle[];
  items:        WeaponDef[];           // armas dentro do caixote
  id:           number;
};

// Geometrias compartilhadas
const CRATE_GEO  = new THREE.BoxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE);
const CRATE_MAT  = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9 });
const CRATE_STRAPS: THREE.MeshStandardMaterial[] = [
  new THREE.MeshStandardMaterial({ color: 0xCCAA44, roughness: 0.8 }),
];
const SMOKE_GEO  = new THREE.SphereGeometry(0.25, 5, 5);

export class AirdropSystem {
  private readonly crates:  AirdropCrate[]  = [];
  private crateIdCounter = 0;

  // ── UI de seleção ──────────────────────────────────────────────────────
  private readonly uiOverlay:   HTMLDivElement;
  private readonly uiList:      HTMLDivElement;
  private activeCrate:          AirdropCrate | null = null;
  private selectedIndex         = 0;

  // Callbacks
  onPickupItem?: (def: WeaponDef) => void;

  constructor(
    private readonly scene:  THREE.Scene,
    private readonly getSurfaceHeight: (x: number, z: number) => number,
  ) {
    // ── UI ────────────────────────────────────────────────────────────────
    this.uiOverlay = document.createElement("div");
    Object.assign(this.uiOverlay.style, {
      position:        "absolute",
      top:             "50%",
      left:            "50%",
      transform:       "translate(-50%, -50%)",
      width:           "340px",
      padding:         "20px 24px",
      background:      "rgba(10,14,18,0.92)",
      border:          "1px solid rgba(255,255,255,0.18)",
      borderRadius:    "14px",
      backdropFilter:  "blur(14px)",
      color:           "#f4f1e8",
      fontFamily:      "inherit",
      display:         "none",
      zIndex:          "100",
      pointerEvents:   "auto",
    });

    const title = document.createElement("div");
    Object.assign(title.style, {
      fontSize:     "1.1rem",
      fontWeight:   "700",
      marginBottom: "12px",
      letterSpacing:"0.05em",
      textTransform:"uppercase",
    });
    title.textContent = "📦 Caixote de Suprimentos";

    const hint = document.createElement("div");
    Object.assign(hint.style, {
      fontSize:     "0.78rem",
      color:        "rgba(255,255,255,0.55)",
      marginBottom: "14px",
    });
    hint.textContent = "↑↓ Navegar  •  E Pegar  •  Ctrl+E Pegar tudo  •  Enter/Esc Fechar";

    this.uiList = document.createElement("div");
    Object.assign(this.uiList.style, {
      display:       "flex",
      flexDirection: "column",
      gap:           "6px",
      maxHeight:     "320px",
      overflowY:     "auto",
    });

    this.uiOverlay.append(title, hint, this.uiList);
    document.body.appendChild(this.uiOverlay);

    // Teclado
    window.addEventListener("keydown", (e) => this.handleKey(e));
  }

  // ── Spawn de drop ───────────────────────────────────────────────────────
  spawnDrop(x: number, z: number): void {
    const id = this.crateIdCounter++;

    // Itens = todas as armas (modo de teste)
    const items: WeaponDef[] = ALL_WEAPON_IDS.map(k => WEAPONS[k]);

    // ── Caixote ──────────────────────────────────────────────────────────
    const crate = new THREE.Mesh(CRATE_GEO, CRATE_MAT.clone());

    // Listras de reforço no caixote
    const strapH = new THREE.Mesh(
      new THREE.BoxGeometry(CRATE_SIZE + 0.01, 0.08, 0.08),
      CRATE_STRAPS[0]
    );
    strapH.position.set(0, 0, CRATE_SIZE / 2);
    crate.add(strapH);
    const strapV = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, CRATE_SIZE + 0.01, 0.08),
      CRATE_STRAPS[0]
    );
    strapV.position.set(0, 0, CRATE_SIZE / 2);
    crate.add(strapV);

    // ── Paraquedas ────────────────────────────────────────────────────────
    const chuteGeo = new THREE.ConeGeometry(1.6, 2.2, 8, 1, true);
    const chuteMat = new THREE.MeshStandardMaterial({
      color:       0xdd3333,
      side:        THREE.DoubleSide,
      roughness:   0.85,
      transparent: true,
      opacity:     0.90,
    });
    const chute = new THREE.Mesh(chuteGeo, chuteMat);
    chute.position.set(0, 2.2, 0);
    chute.rotation.x = Math.PI;

    // Cordas do paraquedas
    const linesMat = new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.7, transparent: true });
    const linesGeo = new THREE.BufferGeometry();
    const lineVerts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const rx = Math.cos(angle) * 1.5;
      const rz = Math.sin(angle) * 1.5;
      // de topo do caixote a borda do paraquedas
      lineVerts.push(0, CRATE_SIZE / 2, 0, rx, 2.2, rz);
    }
    linesGeo.setAttribute("position", new THREE.Float32BufferAttribute(lineVerts, 3));
    const chuteLines = new THREE.LineSegments(linesGeo, linesMat);

    // ── Grupo geral ────────────────────────────────────────────────────────
    const group = new THREE.Group();
    group.add(crate, chute, chuteLines);
    group.position.set(x, DROP_ALTITUDE, z);
    this.scene.add(group);

    const dropEntry: AirdropCrate = {
      group, crate, chute, chuteLines,
      position: group.position,
      landed:      false,
      smokeTimer:  0,
      particles:   [],
      items,
      id,
    };
    this.crates.push(dropEntry);
  }

  // ── Atualização ─────────────────────────────────────────────────────────
  update(delta: number, playerPos: THREE.Vector3): void {
    for (const drop of this.crates) {
      if (!drop.landed) {
        // Queda
        drop.position.y -= DROP_FALL_SPEED * delta;

        // Oscilação lateral do paraquedas
        const t = drop.position.y;
        drop.chute.rotation.z = Math.sin(t * 0.05) * 0.06;
        drop.chute.rotation.x = Math.PI + Math.cos(t * 0.04) * 0.04;

        // Verificar aterrissagem
        const surface = this.getSurfaceHeight(drop.position.x, drop.position.z);
        const landY   = surface + CRATE_SIZE / 2;
        if (drop.position.y <= landY) {
          drop.position.y = landY;
          drop.landed      = true;
          // Paraquedas murcha
          drop.chute.scale.set(0.3, 0.3, 0.3);
          drop.chute.position.set(0.4, 0.5, 0.2);
          drop.chute.rotation.set(0.4, 0.2, 0.8);
          drop.chuteLines.visible = false;
        }
      }

      // Emissão de fumaça
      drop.smokeTimer -= delta;
      if (drop.smokeTimer <= 0) {
        drop.smokeTimer = drop.landed ? LANDED_SMOKE_RATE : SMOKE_INTERVAL;
        this.emitSmoke(drop);
      }

      // Atualiza partículas de fumaça
      for (let i = drop.particles.length - 1; i >= 0; i--) {
        const p = drop.particles[i];
        p.life -= delta;
        p.mesh.position.addScaledVector(p.velocity, delta);
        const alpha = Math.max(0, p.life / p.maxLife);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = alpha * 0.55;
        const s = 1 + (1 - alpha) * 2;
        p.mesh.scale.setScalar(s);
        if (p.life <= 0) {
          this.scene.remove(p.mesh);
          (p.mesh.material as THREE.Material).dispose();
          drop.particles.splice(i, 1);
        }
      }

      // Rotação suave do caixote pousado
      if (drop.landed) {
        drop.crate.rotation.y += delta * 0.4;
      }
    }
  }

  // ── Tenta abrir o caixote mais próximo ──────────────────────────────────
  tryOpenNearby(playerPos: THREE.Vector3): boolean {
    let closest: AirdropCrate | null = null;
    let closestDist = Infinity;

    for (const drop of this.crates) {
      if (!drop.landed || drop.items.length === 0) continue;
      const dist = playerPos.distanceTo(drop.position);
      if (dist < PICKUP_RADIUS && dist < closestDist) {
        closestDist = dist;
        closest     = drop;
      }
    }

    if (!closest) return false;

    this.activeCrate    = closest;
    this.selectedIndex  = 0;
    this.renderUI();
    this.uiOverlay.style.display = "block";
    return true;
  }

  closeUI(): void {
    this.uiOverlay.style.display = "none";
    this.activeCrate             = null;
  }

  get isUIOpen(): boolean {
    return this.uiOverlay.style.display !== "none";
  }

  // ── Teclado ─────────────────────────────────────────────────────────────
  private handleKey(e: KeyboardEvent): void {
    if (!this.activeCrate) return;

    const items = this.activeCrate.items;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, items.length - 1);
      this.renderUI();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.renderUI();
    } else if (e.key === "e" || e.key === "E") {
      if (e.ctrlKey) {
        // Pegar tudo
        e.preventDefault();
        const all = [...items];
        this.activeCrate.items = [];
        for (const def of all) this.onPickupItem?.(def);
        this.closeUI();
      } else {
        // Pegar selecionado
        const def = items[this.selectedIndex];
        if (def) {
          items.splice(this.selectedIndex, 1);
          this.selectedIndex = Math.min(this.selectedIndex, items.length - 1);
          this.onPickupItem?.(def);
          if (items.length === 0) { this.closeUI(); return; }
          this.renderUI();
        }
      }
    } else if (e.key === "Enter" || e.key === "Escape") {
      this.closeUI();
    }
  }

  // ── Renderiza lista da UI ────────────────────────────────────────────────
  private renderUI(): void {
    if (!this.activeCrate) return;
    const items = this.activeCrate.items;

    this.uiList.replaceChildren(
      ...items.map((def, i) => {
        const row = document.createElement("div");
        Object.assign(row.style, {
          padding:      "8px 12px",
          borderRadius: "8px",
          background:   i === this.selectedIndex
            ? "rgba(255,220,80,0.18)"
            : "rgba(255,255,255,0.05)",
          border:       i === this.selectedIndex
            ? "1px solid rgba(255,220,80,0.55)"
            : "1px solid transparent",
          cursor:       "pointer",
          display:      "flex",
          justifyContent: "space-between",
          alignItems:   "center",
          transition:   "background 0.1s",
        });

        const name = document.createElement("span");
        name.textContent = def.name;
        Object.assign(name.style, { fontWeight: "600", fontSize: "0.9rem" });

        const stats = document.createElement("span");
        stats.textContent = `${def.maxAmmo}rds · ${(1 / def.fireCooldown).toFixed(0)}rpm`;
        Object.assign(stats.style, { fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" });

        row.append(name, stats);
        row.addEventListener("click", () => {
          this.selectedIndex = i;
          this.renderUI();
        });
        row.addEventListener("dblclick", () => {
          if (!this.activeCrate) return;
          this.activeCrate.items.splice(i, 1);
          this.selectedIndex = Math.min(this.selectedIndex, this.activeCrate.items.length - 1);
          this.onPickupItem?.(def);
          if (this.activeCrate.items.length === 0) { this.closeUI(); return; }
          this.renderUI();
        });
        return row;
      })
    );
  }

  // ── Emite fumaça ────────────────────────────────────────────────────────
  private emitSmoke(drop: AirdropCrate): void {
    const mat = new THREE.MeshBasicMaterial({
      color:       0xbbbbbb,
      transparent: true,
      opacity:     0.5,
      depthWrite:  false,
    });
    const mesh = new THREE.Mesh(SMOKE_GEO, mat);

    // Posição na parte superior do caixote
    mesh.position.copy(drop.position);
    mesh.position.y += CRATE_SIZE / 2 + 0.2;
    mesh.position.x += (Math.random() - 0.5) * 0.3;
    mesh.position.z += (Math.random() - 0.5) * 0.3;

    const vx = (Math.random() - 0.5) * 0.8;
    const vz = (Math.random() - 0.5) * 0.8;
    const vy = SMOKE_RISE_SPEED + Math.random() * 1.5;

    this.scene.add(mesh);
    drop.particles.push({
      mesh,
      velocity: new THREE.Vector3(vx, vy, vz),
      life:     SMOKE_LIFETIME,
      maxLife:  SMOKE_LIFETIME,
    });
  }

  // ── Limpa todos os drops ─────────────────────────────────────────────────
  dispose(): void {
    for (const drop of this.crates) {
      this.scene.remove(drop.group);
      for (const p of drop.particles) this.scene.remove(p.mesh);
    }
    this.crates.length = 0;
    this.uiOverlay.remove();
  }
}
