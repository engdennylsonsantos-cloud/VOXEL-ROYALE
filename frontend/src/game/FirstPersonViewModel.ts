import * as THREE from "three";
import type { WeaponDef } from "./WeaponDefs";

// ── Materiais compartilhados ────────────────────────────────────────────────
const skinMat   = new THREE.MeshStandardMaterial({ color: 0xf1c5a2, roughness: 0.9 });
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x2f3f63, roughness: 1   });
const metalMat  = new THREE.MeshStandardMaterial({ color: 0x1e2228, roughness: 0.55, metalness: 0.65 });
const darkMat   = new THREE.MeshStandardMaterial({ color: 0x2d333b, roughness: 0.75, metalness: 0.4  });
const gripMat   = new THREE.MeshStandardMaterial({ color: 0x3a2d22, roughness: 0.95 });
const woodMat   = new THREE.MeshStandardMaterial({ color: 0x7a5c3a, roughness: 0.9  });
const lightMat  = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.6, metalness: 0.3  });
const redMat    = new THREE.MeshStandardMaterial({ color: 0xcc2200, roughness: 0.6  });
const greenMat  = new THREE.MeshStandardMaterial({ color: 0x22cc44, roughness: 0.8, emissive: 0x22cc44, emissiveIntensity: 0.6 });
const glassMat  = new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0.1 });

type ToolId = "pickaxe" | string; // qualquer weaponId

export class FirstPersonViewModel {
  readonly root     = new THREE.Group();
  readonly muzzle   = new THREE.Object3D();

  private readonly weaponPivot      = new THREE.Group();
  private readonly rightHandPivot   = new THREE.Group();
  private readonly leftHandPivot    = new THREE.Group();
  private readonly pickaxeGroup     = new THREE.Group();
  private readonly weaponGroups: Map<string, THREE.Group> = new Map();
  private readonly muzzleOffsets:   Map<string, THREE.Vector3> = new Map();
  private currentToolId: ToolId = "m9";

  // ── Estado de animação ──────────────────────────────────────────────────
  private recoil       = 0;
  private aimAlpha     = 0;
  private flash        = 0;
  private swingAngle   = 0;
  private reloadPhase  = 0;    // 0→1 ciclo de recarga
  private isReloading  = false;
  private jamPhase     = 0;
  private isJammed     = false;

  private readonly muzzleFlash : THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly muzzleFlashH: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly muzzleLight : THREE.PointLight;

  // Overlay de scope (sniper)
  private readonly scopeOverlay: HTMLDivElement;

  constructor() {
    this.root.name = "FirstPersonViewModel";
    this.root.position.set(0.55, -0.52, -1.05);

    // ── Scope overlay ─────────────────────────────────────────────────────
    this.scopeOverlay = document.createElement("div");
    Object.assign(this.scopeOverlay.style, {
      position: "absolute", inset: "0",
      display:  "none",     pointerEvents: "none",
      zIndex:   "10",
      background: "radial-gradient(circle at 50% 50%, transparent 22%, rgba(0,0,0,0.96) 22.5%)",
    });
    // Linha cruzada do scope
    const scopeH = document.createElement("div");
    Object.assign(scopeH.style, {
      position: "absolute", top: "50%", left: "0", right: "0",
      height: "1px", background: "rgba(0,200,0,0.85)", transform: "translateY(-50%)"
    });
    const scopeV = document.createElement("div");
    Object.assign(scopeV.style, {
      position: "absolute", left: "50%", top: "0", bottom: "0",
      width: "1px", background: "rgba(0,200,0,0.85)", transform: "translateX(-50%)"
    });
    this.scopeOverlay.append(scopeH, scopeV);
    document.body.appendChild(this.scopeOverlay);

    // ── Estrutura ─────────────────────────────────────────────────────────
    this.weaponPivot.position.set(0, 0, 0);
    this.root.add(this.weaponPivot);

    // ── Picareta ──────────────────────────────────────────────────────────
    // Cabo: eixo Y (vertical). Cabeça: eixo Z (profundidade) → player vê o PERFIL.
    // Múltiplos blocos angulados simulam o arco real da cabeça.

    // ── Cabo de madeira ───────────────────────────────────────────────────
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.80, 0.075), woodMat);
    handle.position.set(0, 0.00, 0.03);
    this.pickaxeGroup.add(handle);

    // Empunhadura (base mais grossa onde a mão aperta)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.22, 0.10), woodMat);
    grip.position.set(0, -0.33, 0.03);
    this.pickaxeGroup.add(grip);

    // ── Colar metálico (junção cabo → cabeça) ─────────────────────────────
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.15), metalMat);
    collar.position.set(0, 0.42, 0.00);
    this.pickaxeGroup.add(collar);

    // ── Corpo central da cabeça (eixo Z = perfil visível pelo player) ─────
    const headBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.46), darkMat);
    headBody.position.set(0, 0.48, -0.08);
    this.pickaxeGroup.add(headBody);

    // Arco superior da cabeça (simula a curvatura convexa do topo da cabeça)
    const archFwd = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.14), darkMat);
    archFwd.position.set(0, 0.555, -0.28);
    archFwd.rotation.x = -0.32;
    this.pickaxeGroup.add(archFwd);

    const archBck = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.12), darkMat);
    archBck.position.set(0, 0.555, 0.20);
    archBck.rotation.x = 0.30;
    this.pickaxeGroup.add(archBck);

    // ── Bico de ataque (ponta dianteira) — 4 segmentos em arco descendente ─
    // O bico curva para baixo e para frente, eixo -Z/-Y
    const bico1 = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.13, 0.17), metalMat);
    bico1.position.set(0, 0.43, -0.36);
    bico1.rotation.x = 0.30;
    this.pickaxeGroup.add(bico1);

    const bico2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.15), metalMat);
    bico2.position.set(0, 0.34, -0.51);
    bico2.rotation.x = 0.60;
    this.pickaxeGroup.add(bico2);

    const bico3 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.12), metalMat);
    bico3.position.set(0, 0.22, -0.62);
    bico3.rotation.x = 0.90;
    this.pickaxeGroup.add(bico3);

    const bico4 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.08), metalMat);
    bico4.position.set(0, 0.10, -0.70);
    bico4.rotation.x = 1.15;   // ponta final, quase vertical = bico afiado
    this.pickaxeGroup.add(bico4);

    // ── Talão (ponta traseira) — 3 segmentos, arco menor e obtuso ─────────
    const heel1 = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.14), metalMat);
    heel1.position.set(0, 0.44, 0.26);
    heel1.rotation.x = -0.35;
    this.pickaxeGroup.add(heel1);

    const heel2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.10, 0.12), metalMat);
    heel2.position.set(0, 0.35, 0.38);
    heel2.rotation.x = -0.65;
    this.pickaxeGroup.add(heel2);

    const heel3 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.09), metalMat);
    heel3.position.set(0, 0.24, 0.46);
    heel3.rotation.x = -0.90;
    this.pickaxeGroup.add(heel3);

    // Inclinação natural de empunhadura (leve tilt para a mão direita)
    this.pickaxeGroup.rotation.z =  0.12;
    this.pickaxeGroup.rotation.x = -0.06;

    this.pickaxeGroup.visible = false;
    this.weaponPivot.add(this.pickaxeGroup);

    // ── Modelos de armas ──────────────────────────────────────────────────
    this.weaponGroups.set("m9",       this.buildM9());
    this.weaponGroups.set("glock17",  this.buildGlock17());
    this.weaponGroups.set("deagle",   this.buildDeagle());
    this.weaponGroups.set("ak47",     this.buildAK47());
    this.weaponGroups.set("m4a1",     this.buildM4A1());
    this.weaponGroups.set("mp5",      this.buildMP5());
    this.weaponGroups.set("uzi",      this.buildUZI());
    this.weaponGroups.set("spas12",   this.buildSPAS12());
    this.weaponGroups.set("escopeta", this.weaponGroups.get("spas12")!);
    this.weaponGroups.set("awp",      this.buildAWP());
    this.weaponGroups.set("m1garand", this.buildM1Garand());

    // ── Ponto de boca de fogo por arma ─────────────────────────────────────
    // (x, y, z) no espaço local do weaponPivot — ponta dianteira do cano de cada arma
    this.muzzleOffsets.set("m9",       new THREE.Vector3(0.06, 0.03, -1.34));
    this.muzzleOffsets.set("glock17",  new THREE.Vector3(0.06, 0.03, -1.28));
    this.muzzleOffsets.set("deagle",   new THREE.Vector3(0.07, 0.04, -1.62));
    this.muzzleOffsets.set("ak47",     new THREE.Vector3(0.04, 0.02, -2.25));
    this.muzzleOffsets.set("m4a1",     new THREE.Vector3(0.04, 0.02, -2.05));
    this.muzzleOffsets.set("mp5",      new THREE.Vector3(0.04, 0.02, -1.64));
    this.muzzleOffsets.set("uzi",      new THREE.Vector3(0.05, 0.02, -1.20));
    this.muzzleOffsets.set("spas12",   new THREE.Vector3(0.04, 0.04, -1.88));
    this.muzzleOffsets.set("escopeta", new THREE.Vector3(0.04, 0.04, -1.88));
    this.muzzleOffsets.set("awp",      new THREE.Vector3(0.04, 0.04, -2.82));
    this.muzzleOffsets.set("m1garand", new THREE.Vector3(0.04, 0.06, -2.44));

    // Adiciona o muzzle uma única vez ao weaponPivot (não ao grupo da arma,
    // para evitar que seja reparentado ao trocar de arma)
    this.weaponPivot.add(this.muzzle);
    this.muzzle.position.copy(this.muzzleOffsets.get("m9")!);

    // Flash
    this.muzzleFlash = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.28, 0.30),
      new THREE.MeshBasicMaterial({ color: 0xffee44, transparent: true, opacity: 0 })
    );
    this.muzzleFlash.position.set(0, 0, -0.20);
    this.muzzle.add(this.muzzleFlash);

    this.muzzleFlashH = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.06, 0.30),
      new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0 })
    );
    this.muzzleFlashH.position.set(0, 0, -0.20);
    this.muzzle.add(this.muzzleFlashH);

    this.muzzleLight = new THREE.PointLight(0xff9900, 0, 7);
    this.muzzleLight.position.set(0, 0, -0.3);
    this.muzzle.add(this.muzzleLight);

    // Adiciona todos os grupos de arma ao pivot
    for (const [, g] of this.weaponGroups) {
      g.visible = false;
      this.weaponPivot.add(g);
    }

    // ── Braços ────────────────────────────────────────────────────────────
    this.rightHandPivot.position.set(0.2, -0.2, -0.12);
    this.rightHandPivot.add(this.createArm(false));
    this.leftHandPivot.position.set(-0.25, -0.09, -0.52);
    this.leftHandPivot.rotation.z = -0.25;
    this.leftHandPivot.rotation.x = -0.3;
    this.root.add(this.rightHandPivot, this.leftHandPivot);
    this.leftHandPivot.add(this.createArm(true));

    // Mostrar M9 por padrão
    this.setTool("m9");
  }

  // ── Loop de atualização ─────────────────────────────────────────────────
  update(elapsedTime: number, movementSpeed: number, aiming: boolean, sprinting: boolean, weaponDef: WeaponDef | null): void {
    const bobS  = sprinting ? 0.024 : 0.012;
    const bobSp = sprinting ? 12    : 8;
    const bob  = movementSpeed > 0.08 ? Math.sin(elapsedTime * bobSp) * bobS * movementSpeed : 0;
    const sway = movementSpeed > 0.08 ? Math.cos(elapsedTime * (bobSp - 2)) * bobS * 0.85 * movementSpeed : 0;

    const isSniper = weaponDef?.sightType === "scope";

    this.aimAlpha   = THREE.MathUtils.lerp(this.aimAlpha, aiming ? 1 : 0, 0.18);
    this.recoil     = THREE.MathUtils.lerp(this.recoil, 0, this.recoil > 0.5 ? 0.32 : 0.22);
    this.flash      = THREE.MathUtils.lerp(this.flash,  0, 0.22);
    this.swingAngle = THREE.MathUtils.lerp(this.swingAngle, 0, 0.18);

    // Scope overlay para sniper
    if (isSniper) {
      this.scopeOverlay.style.display = aiming ? "block" : "none";
    } else {
      this.scopeOverlay.style.display = "none";
    }

    if (this.currentToolId === "pickaxe") {
      // Cabeça no eixo Z → player vê o perfil da picareta.
      // rotation.y ≈ 0 (sem giro lateral), rotation.x suave para não expor o topo.
      // Swing: rotation.x vai para negativo (levanta) → volta ao positivo (bate).
      this.root.position.x  = THREE.MathUtils.lerp(0.28 + sway, 0.08, this.aimAlpha);
      this.root.position.y  = THREE.MathUtils.lerp(-0.68 + bob, -0.52, this.aimAlpha);
      this.root.position.z  = -0.90;
      this.weaponPivot.rotation.x = 0.10 + this.swingAngle;   // quase plano em repouso
      this.weaponPivot.rotation.y = -0.06;                    // quase reto (perfil)
      this.weaponPivot.position.z = -this.swingAngle * 0.07;
      return;
    }

    // ── Posição base / mira ────────────────────────────────────────────────
    // Ao mirar: centraliza na tela alinhando a mira perfeitamente na horizontal
    let targetX = -0.04; // default offset para a maioria das armas (M4, AK, etc)
    if (this.currentToolId === "m9" || this.currentToolId === "glock17") targetX = -0.06;
    else if (this.currentToolId === "deagle") targetX = -0.07;
    else if (this.currentToolId === "uzi") targetX = -0.05;

    this.root.position.x = THREE.MathUtils.lerp(0.55 + sway, targetX, this.aimAlpha);
    this.root.position.y = THREE.MathUtils.lerp(-0.52 + bob, -0.26,  this.aimAlpha);
    this.root.position.z = THREE.MathUtils.lerp(-1.05,        -0.72,  this.aimAlpha);

    // ── Recoil: rotação para CIMA (positivo X) ──────────────────────────
    let rx = -0.06 + this.recoil * 0.50;
    let ry = -0.04 + this.recoil * 0.04;
    let pz = this.recoil * 0.10;

    // ── Recarga ────────────────────────────────────────────────────────────
    if (this.isReloading && weaponDef) {
      const cycle = this.reloadPhase;
      if (cycle < 0.35) {
        rx -= cycle / 0.35 * 0.8;        // desce para recarregar
        pz += cycle / 0.35 * 0.2;
      } else if (cycle < 0.65) {
        rx -= 0.8;                        // pente saiu/entrou
      } else {
        const t = (cycle - 0.65) / 0.35;
        rx -= (1 - t) * 0.8;
      }
    }

    // ── Engalhamento: abana arma ────────────────────────────────────────
    if (this.isJammed) {
      rx += Math.sin(elapsedTime * 18) * 0.15;
      ry += Math.cos(elapsedTime * 22) * 0.08;
    }

    this.weaponPivot.rotation.x = rx;
    this.weaponPivot.rotation.y = ry;
    this.weaponPivot.position.z = pz;
    this.rightHandPivot.rotation.x = -0.5 - this.recoil * 0.25;
    this.leftHandPivot.rotation.x  = -0.38 - this.recoil * 0.10;

    // Flash
    const fo = this.flash;
    this.muzzleFlash.material.opacity  = fo;
    this.muzzleFlashH.material.opacity = fo * 0.80;
    const fs = 0.6 + this.flash * 1.8;
    this.muzzleFlash.scale.set(1, fs, fs);
    this.muzzleFlashH.scale.set(fs, 1, fs);
    this.muzzleLight.intensity = this.flash * 5.5;
  }

  triggerFire(): void {
    this.recoil = Math.min(1, this.recoil + 0.85);
    this.flash  = 1;
  }

  triggerSwing(): void {
    this.swingAngle = -0.9;
  }

  startReload(): void {
    this.isReloading = true;
    this.reloadPhase = 0;
  }

  /** Avança a fase de recarga. Retorna true quando completo. */
  advanceReload(delta: number, reloadTime: number): boolean {
    if (!this.isReloading) return false;
    this.reloadPhase += delta / reloadTime;
    if (this.reloadPhase >= 1) {
      this.isReloading = false;
      this.reloadPhase = 0;
      return true;
    }
    return false;
  }

  startJam(): void   { this.isJammed = true;  }
  clearJam(): void   { this.isJammed = false; }

  setTool(toolId: ToolId): void {
    this.currentToolId = toolId;
    this.pickaxeGroup.visible = false;
    for (const [, g] of this.weaponGroups) g.visible = false;

    if (toolId === "pickaxe") {
      this.pickaxeGroup.visible = true;
      this.scopeOverlay.style.display = "none";
      return;
    }
    const g = this.weaponGroups.get(toolId);
    if (g) g.visible = true;

    // Atualiza a posição da boca de fogo para a arma atual
    const mOff = this.muzzleOffsets.get(toolId);
    if (mOff) this.muzzle.position.copy(mOff);
  }

  // ════════════════════════════════════════════════════════════════════════
  // ── MODELOS DAS 10 ARMAS ─────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════

  // ── M9 Beretta ───────────────────────────────────────────────────────
  private buildM9(): THREE.Group {
    const g = new THREE.Group();
    g.add(this.box(0.16,0.22,0.72, metalMat, 0.06,-0.01,-0.28));
    g.add(this.box(0.075,0.075,0.96, metalMat, 0.06,0.03,-0.82));
    g.add(this.box(0.14,0.18,0.55, darkMat,  0.06,0.03,-0.18));
    g.add(this.box(0.08,0.07,0.18, darkMat,  0.06,-0.16,-0.14));
    g.add(this.box(0.12,0.30,0.14, gripMat,  0.04,-0.24,-0.05, 0.08,0,0));
    g.add(this.box(0.04,0.07,0.04, metalMat, 0.06,0.13,-0.52)); // mira dianteira
    g.add(this.box(0.08,0.07,0.04, metalMat, 0.06,0.13,-0.08)); // mira traseira
    return g;
  }

  // ── Glock 17 ─────────────────────────────────────────────────────────
  private buildGlock17(): THREE.Group {
    const g = new THREE.Group();
    g.add(this.box(0.16,0.20,0.68, darkMat,  0.06,-0.01,-0.24));
    g.add(this.box(0.07,0.07,0.92, metalMat, 0.06, 0.03,-0.78));
    g.add(this.box(0.14,0.17,0.50, darkMat,  0.06, 0.03,-0.14));
    g.add(this.box(0.13,0.30,0.13, darkMat,  0.04,-0.24,-0.05));  // grip polimérico
    g.add(this.box(0.06,0.06,0.04, metalMat, 0.06, 0.12,-0.50));
    g.add(this.box(0.08,0.06,0.04, metalMat, 0.06, 0.12,-0.08));
    return g;
  }

  // ── Desert Eagle ─────────────────────────────────────────────────────
  private buildDeagle(): THREE.Group {
    const g = new THREE.Group();
    // Corpo grande e angular
    g.add(this.box(0.20,0.26,0.80, metalMat, 0.07,-0.01,-0.30));
    g.add(this.box(0.09,0.09,1.10, metalMat, 0.07, 0.04,-0.90));  // cano longo
    g.add(this.box(0.17,0.22,0.60, darkMat,  0.07, 0.04,-0.22));
    g.add(this.box(0.16,0.35,0.16, darkMat,  0.06,-0.25,-0.05));   // cabo grande
    g.add(this.box(0.06,0.08,0.04, metalMat, 0.07, 0.16,-0.60));
    g.add(this.box(0.10,0.08,0.04, metalMat, 0.07, 0.16,-0.08));
    // Compensador na boca
    g.add(this.box(0.12,0.12,0.14, darkMat,  0.07, 0.04,-1.50));
    return g;
  }

  // ── AK-47 ─────────────────────────────────────────────────────────────
  private buildAK47(): THREE.Group {
    const g = new THREE.Group();
    // Receiver
    g.add(this.box(0.16,0.20,1.20, darkMat,  0.04, 0.00,-0.60));
    // Cano
    g.add(this.box(0.06,0.06,1.30, metalMat, 0.04, 0.02,-1.55));
    // Coronha madeira
    g.add(this.box(0.14,0.16,0.52, woodMat,  0.04,-0.08, 0.26));
    // Kabul (pente curvo AK)
    g.add(this.box(0.10,0.35,0.16, darkMat,  0.04,-0.24,-0.46));
    g.add(this.box(0.10,0.35,0.16, darkMat,  0.04,-0.30,-0.32)); // curva pente
    // Guarda mão
    g.add(this.box(0.14,0.12,0.48, woodMat,  0.04,-0.10,-0.84));
    // Mira dianteira (pino)
    g.add(this.box(0.04,0.10,0.04, metalMat, 0.04, 0.15,-1.90));
    // Mira traseira
    g.add(this.box(0.12,0.06,0.04, metalMat, 0.04, 0.14,-0.06));
    return g;
  }

  // ── M4A1 ──────────────────────────────────────────────────────────────
  private buildM4A1(): THREE.Group {
    const g = new THREE.Group();
    g.add(this.box(0.14,0.18,1.10, darkMat,  0.04, 0.00,-0.55));
    g.add(this.box(0.06,0.06,1.20, metalMat, 0.04, 0.02,-1.40));
    // Buffer tube (coronha telescópica)
    g.add(this.box(0.12,0.12,0.50, darkMat,  0.04,-0.05, 0.22));
    g.add(this.box(0.14,0.18,0.22, darkMat,  0.04,-0.05, 0.48)); // cheek riser
    // Pente reto M4
    g.add(this.box(0.10,0.30,0.14, darkMat,  0.04,-0.22,-0.42));
    // Guarda mão
    g.add(this.box(0.14,0.12,0.50, darkMat,  0.04,-0.08,-0.82));
    // Red dot sight
    const rdot = new THREE.Group();
    rdot.position.set(0.04, 0.18, -0.30);
    rdot.add(this.box(0.10,0.10,0.14, darkMat,   0,0,0));
    rdot.add(this.box(0.07,0.07,0.08, glassMat,  0,0,-0.10));
    rdot.add(this.box(0.02,0.02,0.02, redMat,    0,0,-0.10));  // dot
    g.add(rdot);
    return g;
  }

  // ── MP5 ───────────────────────────────────────────────────────────────
  private buildMP5(): THREE.Group {
    const g = new THREE.Group();
    g.add(this.box(0.14,0.18,0.90, darkMat,  0.04, 0.00,-0.44));
    g.add(this.box(0.06,0.06,1.00, metalMat, 0.04, 0.02,-1.10));
    // Coronha dobrável
    g.add(this.box(0.13,0.10,0.44, darkMat,  0.04,-0.12, 0.18));
    // Pente reto compacto
    g.add(this.box(0.09,0.26,0.12, darkMat,  0.04,-0.20,-0.36));
    // Guarda mão curto
    g.add(this.box(0.14,0.10,0.34, darkMat,  0.04,-0.08,-0.72));
    return g;
  }

  // ── UZI ───────────────────────────────────────────────────────────────
  private buildUZI(): THREE.Group {
    const g = new THREE.Group();
    // Corpo quadrado típico
    g.add(this.box(0.16,0.22,0.64, darkMat,  0.05, 0.00,-0.30));
    g.add(this.box(0.06,0.06,0.70, metalMat, 0.05, 0.02,-0.82));
    // Pente reto no meio
    g.add(this.box(0.10,0.34,0.12, darkMat,  0.05,-0.24,-0.18));
    // Cabo traseiro
    g.add(this.box(0.12,0.22,0.14, darkMat,  0.04,-0.16, 0.08));
    return g;
  }

  // ── SPAS-12 ───────────────────────────────────────────────────────────
  private buildSPAS12(): THREE.Group {
    const g = new THREE.Group();
    // Receiver largo de espingarda
    g.add(this.box(0.20,0.24,0.90, darkMat,  0.04, 0.00,-0.44));
    // Cano duplo tubo (espingarda)
    g.add(this.box(0.08,0.08,1.20, metalMat, 0.04, 0.04,-1.20));  // cano principal
    g.add(this.box(0.06,0.06,0.98, metalMat, 0.04,-0.08,-1.10));  // tubo de ação pump
    // Coronha dobrável (dobrada)
    g.add(this.box(0.14,0.16,0.48, darkMat,  0.04,-0.04, 0.24));
    // Pistolet grip
    g.add(this.box(0.14,0.28,0.14, darkMat,  0.04,-0.22,-0.06));
    // Guarda mão pump
    g.add(this.box(0.18,0.16,0.38, darkMat,  0.04,-0.06,-0.90));
    return g;
  }

  // ── AWP (Sniper) ──────────────────────────────────────────────────────
  private buildAWP(): THREE.Group {
    const g = new THREE.Group();
    g.add(this.box(0.14,0.18,1.60, darkMat,  0.04, 0.00,-0.80));
    // Cano muito longo
    g.add(this.box(0.05,0.05,1.80, metalMat, 0.04, 0.04,-1.90));
    // Coronha com cheek riser
    g.add(this.box(0.14,0.20,0.60, woodMat,  0.04,-0.06, 0.30));
    // Pente
    g.add(this.box(0.09,0.22,0.12, darkMat,  0.04,-0.17,-0.50));
    // Mira telescópica grande
    const scope = new THREE.Group();
    scope.position.set(0.04, 0.22, -0.70);
    scope.add(this.box(0.12,0.12,0.70, darkMat,   0, 0,0));
    scope.add(this.box(0.08,0.08,0.12, glassMat,  0, 0,-0.40)); // lente frontal
    scope.add(this.box(0.08,0.08,0.12, glassMat,  0, 0, 0.40)); // lente traseira
    g.add(scope);
    // Bipé
    g.add(this.box(0.04,0.14,0.04, metalMat, -0.04,-0.20,-1.60));
    g.add(this.box(0.04,0.14,0.04, metalMat,  0.12,-0.20,-1.60));
    return g;
  }

  // ── M1 Garand ─────────────────────────────────────────────────────────
  private buildM1Garand(): THREE.Group {
    const g = new THREE.Group();
    // Coronha e caixa de madeira longa
    g.add(this.box(0.16,0.22,1.60, woodMat,  0.04,-0.02,-0.80));
    // Receiver de metal
    g.add(this.box(0.14,0.18,0.70, metalMat, 0.04, 0.04,-0.35));
    // Cano longo
    g.add(this.box(0.055,0.055,1.60, metalMat, 0.04, 0.06,-1.60));
    // En-bloc clip visível no topo
    g.add(this.box(0.10,0.12,0.18, metalMat, 0.04, 0.16,-0.25));
    // Mira dianteira tipo roda
    g.add(this.box(0.04,0.10,0.04, metalMat, 0.04, 0.16,-2.30));
    // Mira traseira peep
    g.add(this.box(0.12,0.08,0.04, metalMat, 0.04, 0.15,-0.06));
    return g;
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  private box(
    w: number, h: number, d: number,
    mat: THREE.Material,
    x = 0, y = 0, z = 0,
    rx = 0, ry = 0, rz = 0
  ): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    return m;
  }

  private createArm(isLeft: boolean): THREE.Group {
    const arm = new THREE.Group();

    // ── Antebraço + manga ────────────────────────────────────────────────
    // Manga: mais longa e levemente afunilada (mais larga em cima)
    arm.add(this.box(0.19, 0.20, 0.18, sleeveMat,  0,  0.22, 0.00));  // parte alta da manga
    arm.add(this.box(0.17, 0.16, 0.17, sleeveMat,  0,  0.04, 0.00));  // parte baixa da manga
    // Punho da manga (detalhe de borda)
    arm.add(this.box(0.18, 0.04, 0.18, sleeveMat,  0, -0.06, 0.00));

    // ── Pulso (pele entre manga e mão) ───────────────────────────────────
    arm.add(this.box(0.13, 0.09, 0.13, skinMat,    0, -0.13, 0.00));

    // ── Palma da mão ─────────────────────────────────────────────────────
    arm.add(this.box(0.155, 0.20, 0.19, skinMat,   0, -0.25, 0.01));

    // Saliência dos nós dos dedos
    arm.add(this.box(0.145, 0.04, 0.05, skinMat,   0, -0.34, 0.10));

    // ── Dedos (4 dedos como bloco, dois segmentos) ───────────────────────
    // Falanges proximais
    arm.add(this.box(0.13, 0.06, 0.16, skinMat,    0, -0.39, 0.07));
    // Falanges médias + distais (levemente curvados para frente)
    arm.add(this.box(0.11, 0.05, 0.13, skinMat,    0, -0.44, 0.17));

    // ── Polegar (separado, rotacionado para fora) ─────────────────────────
    const thumb = new THREE.Group();
    thumb.position.set(isLeft ? -0.09 : 0.09, -0.22, 0.06);
    thumb.rotation.set(-0.15, isLeft ? -0.10 : 0.10, isLeft ? 0.60 : -0.60);   // abre para o lado
    // Falange proximal do polegar
    thumb.add(this.box(0.07, 0.13, 0.07, skinMat, 0,  0.00, 0.00));
    // Falange distal do polegar (leve curva)
    thumb.add(this.box(0.065, 0.10, 0.065, skinMat, 0, -0.11, 0.03));
    arm.add(thumb);

    return arm;
  }
}
