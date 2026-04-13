import * as THREE from "three";
import { VoxelTerrain } from "./VoxelTerrain";

const zombieGreen = new THREE.MeshStandardMaterial({ color: 0x4a7a40, roughness: 0.8 });
const zombieClothes = new THREE.MeshStandardMaterial({ color: 0x3d708f, roughness: 0.9 });
const zombiePants = new THREE.MeshStandardMaterial({ color: 0x443377, roughness: 0.9 });

const wolfFur = new THREE.MeshStandardMaterial({ color: 0x3d3024, roughness: 0.9 });
const wolfSkin = new THREE.MeshStandardMaterial({ color: 0x1f1710, roughness: 1.0 });

export interface IMob {
  group: THREE.Group;
  hp: number;
  isDead: boolean;
  deathTimer: number;
  takeDamage(amount: number, part: string): void;
  getRaycastTargets(): THREE.Object3D[];
  update(delta: number, playerPos: THREE.Vector3, terrain: VoxelTerrain, onPlayerDamaged: (dmg: number) => void): void;
}

export class Zombie implements IMob {
  group = new THREE.Group();
  head: THREE.Mesh;
  body: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  
  hp = 100;
  isDead = false;
  speed = 3.2; // Reduzido (Antes 4.2). Zumbi mais lento.
  private attackCooldown = 0;
  deathTimer = 0;

  private walkCycle = 0;
  private readonly raycastMeshes: THREE.Mesh[] = [];

  constructor(public position: THREE.Vector3) {
    this.group.position.copy(position);

    // Corpo
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.25), zombieClothes);
    this.body.position.y = 1.125; // pernas(0.75) + body/2(0.375)
    this.body.castShadow = true;
    
    // Cabeça
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), zombieGreen);
    this.head.position.y = 1.75; // bodyTop(1.5) + head/2(0.25)
    this.head.castShadow = true;

    // Braço Esquerdo
    const lArmGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
    lArmGeo.translate(0, -0.25, 0); 
    this.leftArm = new THREE.Mesh(lArmGeo, zombieGreen);
    this.leftArm.position.set(0.375, 1.375, 0); // ombro
    this.leftArm.castShadow = true;

    // Braço Direito
    const rArmGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
    rArmGeo.translate(0, -0.25, 0); 
    this.rightArm = new THREE.Mesh(rArmGeo, zombieGreen);
    this.rightArm.position.set(-0.375, 1.375, 0); // ombro
    this.rightArm.castShadow = true;

    // Perna Esquerda
    const lLegGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
    lLegGeo.translate(0, -0.375, 0);
    this.leftLeg = new THREE.Mesh(lLegGeo, zombiePants);
    this.leftLeg.position.set(0.125, 0.75, 0);
    this.leftLeg.castShadow = true;

    // Perna Direita
    const rLegGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
    rLegGeo.translate(0, -0.375, 0);
    this.rightLeg = new THREE.Mesh(rLegGeo, zombiePants);
    this.rightLeg.position.set(-0.125, 0.75, 0);
    this.rightLeg.castShadow = true;

    // Hitbox parts
    this.head.userData = { isMob: true, part: "head", dummy: this };
    this.body.userData = { isMob: true, part: "body", dummy: this };
    this.leftArm.userData = { isMob: true, part: "arm", dummy: this };
    this.rightArm.userData = { isMob: true, part: "arm", dummy: this };
    this.leftLeg.userData = { isMob: true, part: "leg", dummy: this };
    this.rightLeg.userData = { isMob: true, part: "leg", dummy: this };

    this.raycastMeshes.push(this.head, this.body, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg);
    this.group.add(this.body, this.head, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg);
  }

  getRaycastTargets(): THREE.Object3D[] {
    return this.isDead ? [] : this.raycastMeshes;
  }

  takeDamage(amount: number, part: string) {
    if (this.isDead) return;
    let actualDamage = amount;
    
    if (part === "head") actualDamage = 999;
    
    this.hp -= actualDamage;
    
    if (this.hp <= 0) {
      this.die();
    } else {
      // Dano: pisca de vermelho escuro
      for (const mesh of this.raycastMeshes) {
        (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x550000);
      }
      setTimeout(() => {
        if (!this.isDead) {
          for (const mesh of this.raycastMeshes) {
            (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
          }
        }
      }, 150);
    }
  }

  die() {
    this.isDead = true;
    this.deathTimer = 0; // Inicia a contagem pra desaparecer
    
    // Animação de explodir/desmontar
    for (const mesh of this.raycastMeshes) {
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mat.color.multiplyScalar(0.4);
      mat.emissive.setHex(0x000000);
      mesh.material = mat;

      // Velocidade do estilhaço
      mesh.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 5 + 3,
        (Math.random() - 0.5) * 6
      );
      mesh.userData.rotVel = new THREE.Vector3(
        Math.random() * 10 - 5,
        Math.random() * 10 - 5,
        Math.random() * 10 - 5
      );
    }
  }

  update(delta: number, playerPos: THREE.Vector3, terrain: VoxelTerrain, onPlayerDamaged: (dmg: number) => void) {
    if (this.isDead) {
      this.deathTimer += delta;

      // Faz os pedaços caírem fisicamente ao chão e pararem
      for (const mesh of this.raycastMeshes) {
        if (mesh.userData.vel) {
          mesh.position.addScaledVector(mesh.userData.vel, delta);
          mesh.rotation.x += mesh.userData.rotVel.x * delta;
          mesh.rotation.y += mesh.userData.rotVel.y * delta;
          mesh.rotation.z += mesh.userData.rotVel.z * delta;
          
          mesh.userData.vel.y -= 25 * delta; // Gravidade local na peça

          // Base de colisão com o chão (y = 0 é a base do grupo, que segue o terreno)
          if (mesh.position.y <= 0) {
             mesh.position.y = 0;
             mesh.userData.vel.set(0, 0, 0);
             mesh.userData.rotVel.set(0, 0, 0);
          }
        }
      }
      return;
    }

    if (this.attackCooldown > 0) this.attackCooldown -= delta;

    // Movement toward player (ignoring Y for direction)
    const dir = new THREE.Vector3(playerPos.x - this.group.position.x, 0, playerPos.z - this.group.position.z);
    const distXZ = dir.length();
    const distY = Math.abs(playerPos.y - this.group.position.y);
    
    // Zumbis buscam ativamente o player a uma grande distância
    if (distXZ < 180) {
      if (distXZ > 1.3 || distY > 2.0) {
        // Se movendo e buscando
        dir.normalize();
        this.group.position.x += dir.x * this.speed * delta;
        this.group.position.z += dir.z * this.speed * delta;
        
        // Face the player: angle in XZ plane
        this.group.rotation.y = Math.atan2(dir.x, dir.z);
        this.walkCycle += delta * 12.0;

        // Animação forte dos braços para frente e para trás
        const armSwing = Math.sin(this.walkCycle) * 0.6;
        this.leftArm.rotation.x = -Math.PI / 2 + armSwing;
        this.rightArm.rotation.x = -Math.PI / 2 - armSwing;

        // Animação forte das pernas
        const legSwing = Math.sin(this.walkCycle) * 0.8;
        this.leftLeg.rotation.x = legSwing;
        this.rightLeg.rotation.x = -legSwing;
      } else {
        // Atacando
        this.walkCycle += delta * 18.0; // Animação rápida de ataque
        this.group.rotation.y = Math.atan2(dir.x, dir.z); // Continua olhando para o player

        const attackSwing = Math.sin(this.walkCycle) * 0.8;
        this.leftArm.rotation.x = -Math.PI / 2 + Math.max(0, attackSwing) * 1.5;
        this.rightArm.rotation.x = -Math.PI / 2 + Math.max(0, attackSwing) * 1.5;

        // Pernas param ao atacar
        this.leftLeg.rotation.x = 0;
        this.rightLeg.rotation.x = 0;

        // Dá dano no player se o cooldown zerar
        if (this.attackCooldown <= 0) {
          onPlayerDamaged(20);
          this.attackCooldown = 1.0;
        }
      }
    } else {
      // Idle se o player estiver muito longe
      this.walkCycle = 0;
      this.leftArm.rotation.x = -Math.PI / 2;
      this.rightArm.rotation.x = -Math.PI / 2;
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
    }

    // getGroundHeightAt ignora árvores e estruturas: mob anda no chão real
    const groundH = terrain.getGroundHeightAt(this.group.position.x, this.group.position.z);
    this.group.position.y = THREE.MathUtils.lerp(this.group.position.y, groundH, delta * 15);
  }
}

export class Werewolf implements IMob {
  group = new THREE.Group();
  head: THREE.Mesh;
  snout: THREE.Mesh;
  body: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  
  hp = 180;
  isDead = false;
  speed = 4.8; // Um pouco mais rápido que zumbis, mas fugível
  private attackCooldown = 0;
  deathTimer = 0;

  private walkCycle = 0;
  private readonly raycastMeshes: THREE.Mesh[] = [];

  constructor(public position: THREE.Vector3) {
    this.group.position.copy(position);

    // Corpo alongado e inclinado
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.4), wolfFur);
    this.body.position.set(0, 1.2, 0.2); 
    this.body.rotation.x = 0.3; // Corcunda
    this.body.castShadow = true;
    
    // Cabeça
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), wolfFur);
    this.head.position.set(0, 1.75, 0.4); 
    this.head.rotation.x = -0.2;
    this.head.castShadow = true;

    // Focinho
    this.snout = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.4), wolfSkin);
    this.snout.position.set(0, 0, 0.45);
    this.snout.castShadow = true;
    this.head.add(this.snout);

    // Braços grandes com garras escondidas
    const lArmGeo = new THREE.BoxGeometry(0.25, 0.85, 0.25);
    lArmGeo.translate(0, -0.3, 0); 
    this.leftArm = new THREE.Mesh(lArmGeo, wolfSkin);
    this.leftArm.position.set(0.45, 1.5, 0.2); 
    this.leftArm.castShadow = true;

    const rArmGeo = new THREE.BoxGeometry(0.25, 0.85, 0.25);
    rArmGeo.translate(0, -0.3, 0); 
    this.rightArm = new THREE.Mesh(rArmGeo, wolfSkin);
    this.rightArm.position.set(-0.45, 1.5, 0.2); 
    this.rightArm.castShadow = true;

    // Pernas grossas
    const lLegGeo = new THREE.BoxGeometry(0.3, 0.8, 0.3);
    lLegGeo.translate(0, -0.4, 0);
    this.leftLeg = new THREE.Mesh(lLegGeo, wolfFur);
    this.leftLeg.position.set(0.2, 0.8, 0);
    this.leftLeg.castShadow = true;

    const rLegGeo = new THREE.BoxGeometry(0.3, 0.8, 0.3);
    rLegGeo.translate(0, -0.4, 0);
    this.rightLeg = new THREE.Mesh(rLegGeo, wolfFur);
    this.rightLeg.position.set(-0.2, 0.8, 0);
    this.rightLeg.castShadow = true;

    this.head.userData = { isMob: true, part: "head", dummy: this };
    this.body.userData = { isMob: true, part: "body", dummy: this };
    this.leftArm.userData = { isMob: true, part: "arm", dummy: this };
    this.rightArm.userData = { isMob: true, part: "arm", dummy: this };
    this.leftLeg.userData = { isMob: true, part: "leg", dummy: this };
    this.rightLeg.userData = { isMob: true, part: "leg", dummy: this };

    this.raycastMeshes.push(this.head, this.body, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg);
    this.group.add(this.body, this.head, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg);
  }

  getRaycastTargets(): THREE.Object3D[] {
    return this.isDead ? [] : this.raycastMeshes;
  }

  takeDamage(amount: number, part: string) {
    if (this.isDead) return;
    let actualDamage = amount;
    if (part === "head") actualDamage = 999;
    
    this.hp -= actualDamage;
    if (this.hp <= 0) {
      this.die();
    } else {
      for (const mesh of this.raycastMeshes) {
        (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x550000);
      }
      setTimeout(() => {
        if (!this.isDead) {
          for (const mesh of this.raycastMeshes) {
            (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
          }
        }
      }, 150);
    }
  }

  die() {
    this.isDead = true;
    this.deathTimer = 0;
    for (const mesh of this.raycastMeshes) {
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mat.color.multiplyScalar(0.4);
      mat.emissive.setHex(0x000000);
      mesh.material = mat;

      mesh.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 8, Math.random() * 6 + 4, (Math.random() - 0.5) * 8
      );
      mesh.userData.rotVel = new THREE.Vector3(
        Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5
      );
    }
  }

  update(delta: number, playerPos: THREE.Vector3, terrain: VoxelTerrain, onPlayerDamaged: (dmg: number) => void) {
    if (this.isDead) {
      this.deathTimer += delta;
      for (const mesh of this.raycastMeshes) {
        if (mesh.userData.vel) {
          mesh.position.addScaledVector(mesh.userData.vel, delta);
          mesh.rotation.x += mesh.userData.rotVel.x * delta;
          mesh.rotation.y += mesh.userData.rotVel.y * delta;
          mesh.rotation.z += mesh.userData.rotVel.z * delta;
          mesh.userData.vel.y -= 25 * delta;
          if (mesh.position.y <= 0) {
             mesh.position.y = 0;
             mesh.userData.vel.set(0, 0, 0);
             mesh.userData.rotVel.set(0, 0, 0);
          }
        }
      }
      return;
    }

    if (this.attackCooldown > 0) this.attackCooldown -= delta;

    const dir = new THREE.Vector3(playerPos.x - this.group.position.x, 0, playerPos.z - this.group.position.z);
    const distXZ = dir.length();
    const distY = Math.abs(playerPos.y - this.group.position.y);
    
    if (distXZ < 250) { // Sente de mais longe
      if (distXZ > 1.8 || distY > 2.5) {
        dir.normalize();
        this.group.position.x += dir.x * this.speed * delta;
        this.group.position.z += dir.z * this.speed * delta;
        this.group.rotation.y = Math.atan2(dir.x, dir.z);
        this.walkCycle += delta * 18.0;

        // Corrida animalesca (quase quadrúpede)
        const armSwing = Math.sin(this.walkCycle) * 0.9;
        this.leftArm.rotation.x = -Math.PI / 4 + armSwing;
        this.rightArm.rotation.x = -Math.PI / 4 - armSwing;

        const legSwing = Math.sin(this.walkCycle) * 1.2;
        this.leftLeg.rotation.x = legSwing;
        this.rightLeg.rotation.x = -legSwing;
      } else {
        this.walkCycle += delta * 25.0; // Pulo/ataque agressivo
        this.group.rotation.y = Math.atan2(dir.x, dir.z);

        const attackSwing = Math.sin(this.walkCycle) * 1.2;
        this.leftArm.rotation.x = -Math.PI / 2 + Math.max(0, attackSwing) * 1.8;
        this.rightArm.rotation.x = -Math.PI / 2 + Math.max(0, attackSwing) * 1.8;
        this.leftLeg.rotation.x = 0;
        this.rightLeg.rotation.x = 0;

        if (this.attackCooldown <= 0) {
          onPlayerDamaged(25); // Dano pesado de 25
          this.attackCooldown = 1.1; // Bate um pouco mais devagar que o zumbi para compensar a velocidade
        }
      }
    }

    // getGroundHeightAt ignora árvores e estruturas: mob anda no chão real
    const groundH = terrain.getGroundHeightAt(this.group.position.x, this.group.position.z);
    this.group.position.y = THREE.MathUtils.lerp(this.group.position.y, groundH, delta * 15);
  }
}

export class MobSystem {
  mobs: IMob[] = [];

  constructor(private scene: THREE.Scene, private terrain: VoxelTerrain) {}

  spawnDummiesNear(playerPos: THREE.Vector3) {
    if (this.mobs.length > 0) return;
    
    for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 30 + Math.random() * 20;
        const offset = new THREE.Vector3(
           Math.cos(angle) * radius,
           0,
           Math.sin(angle) * radius
        );

        const spawnPos = playerPos.clone().add(offset);
        spawnPos.y = this.terrain.getSurfaceHeightAt(spawnPos.x, spawnPos.z);
        if (spawnPos.y > this.terrain.waterLevel) {
            const isWolf = Math.random() < 0.2; // 20% de chance de lobisomem
            const mob = isWolf ? new Werewolf(spawnPos) : new Zombie(spawnPos);
            this.mobs.push(mob);
            this.scene.add(mob.group);
        }
    }
  }

  spawnSingleZombieNear(playerPos: THREE.Vector3) {
    if (this.mobs.length > 25) return; 

    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 30; 
    const spawnPos = playerPos.clone().add(new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist));
    
    spawnPos.y = this.terrain.getSurfaceHeightAt(spawnPos.x, spawnPos.z);
    if (spawnPos.y > this.terrain.waterLevel) {
        const isWolf = Math.random() < 0.3; // 30% ch de ser lobisomem no spawn periódico
        const mob = isWolf ? new Werewolf(spawnPos) : new Zombie(spawnPos);
        this.mobs.push(mob);
        this.scene.add(mob.group);
    }
  }

  update(delta: number, playerPos: THREE.Vector3, onPlayerDamaged: (dmg: number) => void) {
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const z = this.mobs[i];
      z.update(delta, playerPos, this.terrain, onPlayerDamaged);

      // Desaparece após desmontado
      if (z.isDead && z.deathTimer > 10.0) {
        this.scene.remove(z.group);
        
        for(const mesh of z.getRaycastTargets() as THREE.Mesh[]) {
            if(mesh.geometry) mesh.geometry.dispose();
            if(mesh.material) (mesh.material as THREE.Material).dispose();
        }

        this.mobs.splice(i, 1);
      }
    }
  }

  getRaycastTargets(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    for (const z of this.mobs) {
       targets.push(...z.getRaycastTargets());
    }
    return targets;
  }
}
