import * as THREE from "three";
import { createRemoteWeaponModel } from "./RemoteWeaponModels";

type Limb = {
  pivot: THREE.Group;
  joint: THREE.Group;
  upper: THREE.Mesh;
  lower: THREE.Mesh;
};

export class PlayerAvatar {
  readonly root = new THREE.Group();
  readonly headAnchor = new THREE.Object3D();
  readonly hitboxes: THREE.Mesh[] = [];
  
  public isDead = false;
  private deathTimer = 0;
  private sessionId = "";

  private readonly visual = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly leftArm: Limb;
  private readonly rightArm: Limb;
  private readonly leftLeg: Limb;
  private readonly rightLeg: Limb;
  private readonly rightHandAnchor = new THREE.Group();
  private readonly weaponPivot = new THREE.Group();
  private readonly weaponRoot = new THREE.Group();
  private weaponModel: THREE.Group | null = null;
  private currentWeaponId = "";
  private weaponVisible = false;

  constructor() {
    this.root.name = "PlayerAvatar";
    this.visual.scale.setScalar(2 / 3.19);
    this.visual.position.y = 0.24;
    this.visual.rotation.y = Math.PI;
    this.root.add(this.visual);

    const skin  = new THREE.MeshStandardMaterial({ color: 0xf0c9a4 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x3d6fd6 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x374151 });

    // ── Tronco ───────────────────────────────────────────────────────────────
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.45), shirt);
    torso.position.set(0, 1.45, 0);
    torso.castShadow = true;
    torso.userData = { isPlayer: true, part: "body", dummy: this };
    this.visual.add(torso);
    this.hitboxes.push(torso);

    // ── Cabeça ───────────────────────────────────────────────────────────────
    this.headPivot.position.set(0, 2.46, 0);
    this.visual.add(this.headPivot);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.72), skin);
    head.castShadow = true;
    head.userData = { isPlayer: true, part: "head", dummy: this };
    this.headPivot.add(head);
    this.hitboxes.push(head);

    // ── Cabelo ───────────────────────────────────────────────────────────────
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x2e1a0e }); // castanho escuro
    // Topo
    const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.16, 0.76), hairMat);
    hairTop.position.set(0, 0.40, 0);
    this.headPivot.add(hairTop);
    // Laterais
    const hairSideL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.72), hairMat);
    hairSideL.position.set(0.40, 0.10, 0);
    this.headPivot.add(hairSideL);
    const hairSideR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.72), hairMat);
    hairSideR.position.set(-0.40, 0.10, 0);
    this.headPivot.add(hairSideR);
    // Fundo
    const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.60, 0.08), hairMat);
    hairBack.position.set(0, 0.10, 0.40);
    this.headPivot.add(hairBack);
    // Franja (frente)
    const hairFringe = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.14, 0.08), hairMat);
    hairFringe.position.set(0, 0.30, -0.40);
    this.headPivot.add(hairFringe);

    // ── Olhos (esclera + íris + reflexo) ─────────────────────────────────────
    const scleraMat  = new THREE.MeshStandardMaterial({ color: 0xfbf5ee }); // branco levemente creme
    const irisMat    = new THREE.MeshStandardMaterial({ color: 0x1a0d00 }); // íris escura
    const pupilMat   = new THREE.MeshStandardMaterial({ color: 0x060303 }); // pupila preta
    const glintMat   = new THREE.MeshStandardMaterial({ color: 0xffffff }); // brilhinho de luz

    // Olho esquerdo (em espaço local do headPivot: X positivo = lado esquerdo do avatar)
    this._buildEye(this.headPivot, scleraMat, irisMat, pupilMat, glintMat,  0.17,  0.08);
    // Olho direito
    this._buildEye(this.headPivot, scleraMat, irisMat, pupilMat, glintMat, -0.17,  0.08);

    // ── Boca ─────────────────────────────────────────────────────────────────
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x3d1008 });
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.05), mouthMat);
    mouth.position.set(0, -0.14, -0.365);
    this.headPivot.add(mouth);

    this.headAnchor.position.set(0, 0.12, 0.08);
    this.headPivot.add(this.headAnchor);

    // ── Membros ───────────────────────────────────────────────────────────────
    this.leftArm = this.createLimb({
      size: new THREE.Vector3(0.28, 1.15, 0.28),
      position: new THREE.Vector3(0.55, 1.95, 0),
      material: shirt,
      isArm: true
    });
    this.rightArm = this.createLimb({
      size: new THREE.Vector3(0.28, 1.15, 0.28),
      position: new THREE.Vector3(-0.55, 1.95, 0),
      material: shirt,
      isArm: true
    });
    this.leftLeg = this.createLimb({
      size: new THREE.Vector3(0.38, 1.2, 0.38),
      position: new THREE.Vector3(0.24, 0.83, 0),
      material: pants
    });
    this.rightLeg = this.createLimb({
      size: new THREE.Vector3(0.38, 1.2, 0.38),
      position: new THREE.Vector3(-0.24, 0.83, 0),
      material: pants
    });

    // ── Arma ─────────────────────────────────────────────────────────────────
    this.weaponPivot.position.set(0, 2.02, 0);
    this.visual.add(this.weaponPivot);

    this.weaponRoot.position.set(0, -1.0, 0);
    this.weaponRoot.rotation.x = -Math.PI / 2;
    this.weaponRoot.rotation.y = 0;
    this.weaponRoot.rotation.z = 0;
    this.weaponPivot.add(this.weaponRoot);

    this.setWeaponType("m9");
    this.setWeaponVisible(false);
  }

  setSessionId(id: string) {
    this.sessionId = id;
    for (const mesh of this.hitboxes) {
      mesh.userData.sessionId = id;
    }
  }

  /** Lista de objetos que voam ao morrer (preenchida em die()) */
  private readonly deathPieces: THREE.Object3D[] = [];

  die() {
    this.isDead = true;
    this.deathTimer = 0;
    this.setWeaponVisible(false);
    this.deathPieces.length = 0;

    // ── Peças a desmontar ────────────────────────────────────────────────
    // 1) Cabeça inteira (headPivot = cabeça + cabelo + olhos + boca)
    // 2) Torso (hitboxes[0])
    // 3) Braços e pernas (hitboxes[2..N], os upper/lower de cada membro)
    const pieces: THREE.Object3D[] = [
      this.headPivot,        // grupo inteiro — cabeça + cabelo + olhos
      this.hitboxes[0],      // torso
      ...this.hitboxes.slice(2), // braços e pernas (pula hitbox[1] = head mesh pura dentro do pivot)
    ];

    for (const obj of pieces) {
      if (!obj.parent) continue;

      // Captura posição/quaternion no mundo antes de reparentar
      const worldPos  = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      obj.getWorldPosition(worldPos);
      obj.getWorldQuaternion(worldQuat);

      // Reparenta para root para que possa cair livremente
      this.root.add(obj);
      obj.position.copy(worldPos).sub(this.root.position);
      obj.quaternion.copy(worldQuat);

      // Escurece/empavonado de sangue
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = (child.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiplyScalar(0.4);
          mat.emissive.setHex(0x550000);
          child.material = mat;
        }
      });

      // Velocidade de explosão aleatória
      obj.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 5 + 3,
        (Math.random() - 0.5) * 8
      );
      obj.userData.rotVel = new THREE.Vector3(
        Math.random() * 8 - 4,
        Math.random() * 8 - 4,
        Math.random() * 8 - 4
      );

      this.deathPieces.push(obj);
    }
  }

  updateDead(delta: number) {
    if (!this.isDead) return;
    this.deathTimer += delta;

    for (const obj of this.deathPieces) {
      if (!obj.userData.vel) continue;

      obj.position.addScaledVector(obj.userData.vel, delta);
      obj.rotation.x += obj.userData.rotVel.x * delta;
      obj.rotation.y += obj.userData.rotVel.y * delta;
      obj.rotation.z += obj.userData.rotVel.z * delta;

      obj.userData.vel.y -= 25 * delta; // gravidade

      if (obj.position.y <= 0) {
        obj.position.y = 0;
        obj.userData.vel.set(0, 0, 0);
        obj.userData.rotVel.set(0, 0, 0);
      }
    }
  }

  /** Constrói um olho em camadas: esclera → íris → pupila → reflexo de luz */
  private _buildEye(
    parent: THREE.Object3D,
    scleraMat: THREE.MeshStandardMaterial,
    irisMat: THREE.MeshStandardMaterial,
    pupilMat: THREE.MeshStandardMaterial,
    glintMat: THREE.MeshStandardMaterial,
    x: number,
    y: number
  ): void {
    const baseZ = -0.362; // ligeiramente na frente da face

    // Esclera (branco do olho)
    const sclera = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.04), scleraMat);
    sclera.position.set(x, y, baseZ - 0.000);
    parent.add(sclera);

    // Íris colorida (marrom-escuro)
    const iris = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.025), irisMat);
    iris.position.set(x, y, baseZ - 0.026);
    parent.add(iris);

    // Pupila preta (bem pequena no centro)
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.056, 0.02), pupilMat);
    pupil.position.set(x, y, baseZ - 0.042);
    parent.add(pupil);

    // Brilhinho de reflexo de luz (canto superior esquerdo do olho)
    const glint = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.018), glintMat);
    glint.position.set(x + 0.028, y + 0.024, baseZ - 0.054);
    parent.add(glint);
  }

  setWeaponVisible(visible: boolean): void {
    this.weaponVisible = visible;
    this.weaponRoot.visible = visible;
  }

  setWeaponType(weaponId: string): void {
    if (weaponId === this.currentWeaponId) return;
    this.currentWeaponId = weaponId;
    this.weaponModel?.removeFromParent();
    this.weaponModel = null;
    this.weaponModel = createRemoteWeaponModel(weaponId);
    if (!this.weaponModel) return;
    this.weaponModel.scale.setScalar(1.0);
    this.weaponRoot.add(this.weaponModel);
  }

  /**
   * @param aiming  true quando o jogador está mirando (botão direito do mouse).
   *                Faz os braços subirem até a altura dos olhos (ADS visível para outros).
   */
  animateWalk(speedFactor: number, elapsedTime: number, pitch = 0, reloading = false, aiming = false, delta = 0.016): void {
    const moving     = speedFactor > 0.1;
    const swing      = moving ? Math.sin(elapsedTime * 10) * 0.65 * speedFactor : 0;
    const cosSwing   = moving ? Math.cos(elapsedTime * 10) * 0.65 * speedFactor : 0;
    const baseSettle = moving ? 0.18 : 0.12;
    const settle     = 1 - Math.pow(1 - baseSettle, delta * 60);
    const aimPitch   = THREE.MathUtils.clamp(pitch, -1.45, 1.45);

    // Pivô da arma: mantém a lógica original para o barrel apontar para a cruzeta
    const D = 15;
    const targetWorldY    = 1.8 + D * Math.tan(aimPitch);
    const dy              = targetWorldY - 1.506;
    const trueWeaponPitch = Math.atan2(dy, D);
    const baseWeaponPitch = (Math.PI / 2) + trueWeaponPitch;

    // ── Braços em idle (sem arma) ─────────────────────────────────────────────
    let leftArmTarget  = swing * 0.5;
    let rightArmTarget = -swing * 0.5;
    let leftArmZTarget  = 0;
    let rightArmZTarget = 0;
    let leftArmYTarget  = 0;
    let rightArmYTarget = 0;
    // Idle: cotovelos retos (0) — braço pendurado natural
    let leftElbowTarget  = 0.0;
    let rightElbowTarget = 0.0;
    let handPitchTarget  = 0;

    // ── FÓRMULA DOS COTOVELOS ─────────────────────────────────────────────────
    // A mão fica na frente do corpo quando φ + θ ≈ π/2 (90°).
    // Logo: φ_cotovelo ≈ π/2 − θ_ombro
    // φ < 0 quando θ > π/2 (braço levantado) — o antebraço fica apontando para frente.
    const HALF_PI = Math.PI / 2; // ≈ 1.5708

    if (this.weaponVisible) {
      if (reloading) {
        // ── Reload ──
        const reloadTime  = (elapsedTime * 3) % 2.0;
        const reloadState = Math.sin(Math.PI * reloadTime);

        const thetaL = 0.8;
        const thetaR = 0.6 + reloadState * 0.2;
        leftArmTarget  = thetaL + aimPitch;
        rightArmTarget = thetaR + aimPitch;
        
        // Z swing: - for left arm (brings it right/inwards), + for right arm
        leftArmZTarget  = -0.3;
        rightArmZTarget = 0.3;
        // Y roll: + for left arm (elbow out, hand in), - for right arm
        leftArmYTarget  = 0.4;
        rightArmYTarget = -0.4;

        leftElbowTarget  = 1.5;           
        rightElbowTarget = 1.4; 
        handPitchTarget  = 0.18 + aimPitch * 0.22;

      } else if (aiming) {
        // ── ADS — braços acompanham a mira ──
        const thetaL = 1.3 + aimPitch;
        const thetaR = 1.0 + aimPitch;
        leftArmTarget  = thetaL;
        rightArmTarget = thetaR;
        
        leftArmZTarget  = -0.2;
        rightArmZTarget = 0.2;
        leftArmYTarget  = 0.3;
        rightArmYTarget = -0.3;

        leftElbowTarget  = 0.6;   
        rightElbowTarget = 1.4;   
        handPitchTarget  = 0.26 + aimPitch * 0.30;

      } else {
        // ── Postura armada normal ──
        const thetaL = 1.0 + aimPitch;
        const thetaR = 0.7 + aimPitch;
        leftArmTarget  = thetaL;
        rightArmTarget = thetaR;
        
        leftArmZTarget  = -0.3;
        rightArmZTarget = 0.3;
        leftArmYTarget  = 0.4;
        rightArmYTarget = -0.4;

        leftElbowTarget  = 0.8;   
        rightElbowTarget = 1.4;   
        handPitchTarget  = 0.18 + aimPitch * 0.22;
      }
    }

    // ── Pernas e Joelhos ──────────────────────────────────────────────────────
    const leftLegTarget  = this.weaponVisible ? -swing * 0.4 : -swing;
    const rightLegTarget = this.weaponVisible ?  swing * 0.4 :  swing;

    // Joelhos: NEGATIVO = pé vai para trás
    const leftKneeTarget  = -Math.max(0, -leftLegTarget  * 1.5 + cosSwing * 0.5);
    const rightKneeTarget = -Math.max(0, -rightLegTarget * 1.5 - cosSwing * 0.5);

    const headPitchTarget = THREE.MathUtils.clamp(aimPitch * 0.5, -0.72, 0.72);

    if (this.weaponVisible) {
      this.weaponPivot.rotation.x += (baseWeaponPitch - this.weaponPivot.rotation.x) * settle;
      this.weaponPivot.rotation.y += (-this.weaponPivot.rotation.y) * settle;
      const reloadTilt = reloading ? Math.sin(elapsedTime * 6) * 0.15 : 0;
      this.weaponPivot.rotation.z += (Math.sin(elapsedTime * 6) * 0.03 * speedFactor + reloadTilt - this.weaponPivot.rotation.z) * settle;

      // ADS: sobe a arma para a altura dos olhos (visível para quem observa)
      // Normal: Y=2.02 (altura do peito). ADS: Y=2.30 (próximo dos olhos em 2.46)
      const pivotTargetY = aiming ? 2.30 : 2.02;
      this.weaponPivot.position.y += (pivotTargetY - this.weaponPivot.position.y) * settle;
    } else {
      this.weaponPivot.rotation.x += (-this.weaponPivot.rotation.x) * settle;
      this.weaponPivot.position.y += (2.02 - this.weaponPivot.position.y) * settle;
    }

    this.leftArm.pivot.rotation.x  += (leftArmTarget  - this.leftArm.pivot.rotation.x)  * settle;
    this.rightArm.pivot.rotation.x += (rightArmTarget - this.rightArm.pivot.rotation.x) * settle;
    this.leftArm.pivot.rotation.y  += (leftArmYTarget  - this.leftArm.pivot.rotation.y)  * settle;
    this.rightArm.pivot.rotation.y += (rightArmYTarget - this.rightArm.pivot.rotation.y) * settle;
    this.leftArm.pivot.rotation.z  += (leftArmZTarget  - this.leftArm.pivot.rotation.z)  * settle;
    this.rightArm.pivot.rotation.z += (rightArmZTarget - this.rightArm.pivot.rotation.z) * settle;

    // Aplica cotovelos e joelhos (corrigidos)
    this.leftArm.joint.rotation.x  += (leftElbowTarget  - this.leftArm.joint.rotation.x)  * settle;
    this.rightArm.joint.rotation.x += (rightElbowTarget - this.rightArm.joint.rotation.x) * settle;
    this.leftLeg.joint.rotation.x  += (leftKneeTarget   - this.leftLeg.joint.rotation.x)  * settle;
    this.rightLeg.joint.rotation.x += (rightKneeTarget  - this.rightLeg.joint.rotation.x) * settle;

    this.rightHandAnchor.rotation.x += (handPitchTarget - this.rightHandAnchor.rotation.x) * settle;
    this.headPivot.rotation.x       += (headPitchTarget - this.headPivot.rotation.x)       * settle;
    this.leftLeg.pivot.rotation.x   += (leftLegTarget   - this.leftLeg.pivot.rotation.x)   * settle;
    this.rightLeg.pivot.rotation.x  += (rightLegTarget  - this.rightLeg.pivot.rotation.x)  * settle;
  }

  private createLimb(options: {
    size: THREE.Vector3;
    position: THREE.Vector3;
    material: THREE.MeshStandardMaterial;
    isArm?: boolean;
  }): Limb {
    const pivot = new THREE.Group();
    pivot.position.copy(options.position);

    const hj = options.size.y / 2;

    const upperGeo = new THREE.BoxGeometry(options.size.x, hj, options.size.z);
    upperGeo.translate(0, -hj / 2, 0); // Âncora no topo
    const upper = new THREE.Mesh(upperGeo, options.material);
    upper.castShadow = true;
    upper.receiveShadow = true;
    upper.userData = { isPlayer: true, part: options.isArm ? "arm" : "leg", dummy: this };
    pivot.add(upper);

    const joint = new THREE.Group();
    joint.position.set(0, -hj, 0);
    pivot.add(joint);

    const skinMat       = new THREE.MeshStandardMaterial({ color: 0xf0c9a4 });
    const lowerMaterial = options.isArm ? skinMat : options.material;

    const lowerGeo = new THREE.BoxGeometry(options.size.x, hj, options.size.z);
    lowerGeo.translate(0, -hj / 2, 0); // Âncora no topo
    const lower = new THREE.Mesh(lowerGeo, lowerMaterial);
    lower.castShadow = true;
    lower.receiveShadow = true;
    lower.userData = { isPlayer: true, part: options.isArm ? "arm" : "leg", dummy: this };
    joint.add(lower);

    this.hitboxes.push(upper, lower);
    this.visual.add(pivot);
    return { pivot, joint, upper, lower };
  }
}
