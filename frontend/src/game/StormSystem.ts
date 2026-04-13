import * as THREE from "three";

export class StormSystem {
  private readonly stormMaterial: THREE.MeshStandardMaterial;
  private readonly stormCylinder: THREE.Mesh;
  
  private phase: "waiting" | "shrinking" | "paused" = "waiting";
  private phaseTimer = 0;
  
  private currentCenter: THREE.Vector3;
  private currentRadius: number;
  private targetCenter: THREE.Vector3;
  private targetRadius: number;
  private startCenter: THREE.Vector3;
  private startRadius: number;
  
  public isActive = false;
  public stormStage = 0; // Fases da tempestade
  public isFinal = false;

  constructor(private scene: THREE.Scene, private worldSize: number) {
    this.currentCenter = new THREE.Vector3(0, 50, 0);
    this.currentRadius = worldSize; // Inicia fora do mapa
    this.targetCenter = new THREE.Vector3(0, 50, 0);
    this.targetRadius = worldSize;
    this.startCenter = new THREE.Vector3(0, 50, 0);
    this.startRadius = worldSize;

    this.stormMaterial = new THREE.MeshStandardMaterial({
      color: 0x9922ff,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const geo = new THREE.CylinderGeometry(1, 1, 300, 48, 1, true); // Cilindro aberto sem tampas
    this.stormCylinder = new THREE.Mesh(geo, this.stormMaterial);
    this.stormCylinder.visible = false;
    this.scene.add(this.stormCylinder);
  }

  start() {
    this.isActive = true;
    this.stormCylinder.visible = true;
    this.phase = "waiting";
    this.phaseTimer = 20; // 20s de espera após o pouso
    
    // Configura círculo base envolvendo o mapa inteiro
    this.currentRadius = this.worldSize * 0.7; // Ex: começa cobrindo o mapa principal
    this.currentCenter.set(0, 50, 0);
    this.setNewTarget();
    this.updateMesh();
  }

  private setNewTarget() {
    this.stormStage++;
    this.startCenter.copy(this.currentCenter);
    this.startRadius = this.currentRadius;

    // Se chegar ao estágio 5, é a zona final! (30 metros)
    if (this.stormStage >= 5) {
      this.targetRadius = 15;
      this.isFinal = true;
    } else {
      this.targetRadius = Math.max(15, this.currentRadius * 0.5); 
    }

    const angle = Math.random() * Math.PI * 2;
    const maxOffset = Math.max(0, this.currentRadius - this.targetRadius);
    const r = Math.random() * maxOffset;
    
    this.targetCenter.set(
      this.currentCenter.x + Math.cos(angle) * r,
      50,
      this.currentCenter.z + Math.sin(angle) * r
    );
  }

  update(delta: number, playerPos: THREE.Vector3, onDamage: (dmg: number) => void) {
    if (!this.isActive) return;

    this.stormCylinder.rotation.y += delta * 0.15; // Furacão girando

    if (this.phase === "waiting") {
      this.phaseTimer -= delta;
      if (this.phaseTimer <= 0) {
        this.phase = "shrinking";
        this.phaseTimer = 60; // 60s para diminuir
      }
    } else if (this.phase === "shrinking") {
      this.phaseTimer -= delta;
      const t = 1.0 - Math.max(0, this.phaseTimer) / 60;
      
      this.currentRadius = THREE.MathUtils.lerp(this.startRadius, this.targetRadius, t);
      this.currentCenter.lerpVectors(this.startCenter, this.targetCenter, t);
      
      if (this.phaseTimer <= 0) {
        if (this.isFinal) {
           this.phase = "paused";
           this.phaseTimer = 9999; // Fica final!
        } else {
           this.phase = "paused";
           this.phaseTimer = 30; // Fica parada 30s
        }
      }
    } else if (this.phase === "paused") {
      this.phaseTimer -= delta;
      if (this.phaseTimer <= 0 && !this.isFinal) {
        this.setNewTarget();
        this.phase = "shrinking";
        this.phaseTimer = 60;
      }
    }

    this.updateMesh();

    // Calcula se está no gás
    const dist = Math.hypot(playerPos.x - this.currentCenter.x, playerPos.z - this.currentCenter.z);
    if (dist > this.currentRadius) {
      onDamage(8 * delta); // 8 de dano por segundo no gás
    }
  }

  private updateMesh() {
    this.stormCylinder.scale.set(this.currentRadius, 1, this.currentRadius);
    this.stormCylinder.position.copy(this.currentCenter);
  }

  get currentState() {
    if (!this.isActive) return null;
    return {
      currentCenter: this.currentCenter,
      currentRadius: this.currentRadius,
      targetCenter: this.targetCenter,
      targetRadius: this.targetRadius,
      phase: this.phase
    };
  }
}
