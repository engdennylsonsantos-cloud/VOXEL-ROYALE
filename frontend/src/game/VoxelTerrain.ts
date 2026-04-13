import { createNoise2D } from "simplex-noise";
import * as THREE from "three";
import { TerrainTextures } from "./TerrainTextures";

// ── Constantes globais do mundo ─────────────────────────────────────────────
const WORLD_SIZE       = 512;
const CHUNK_SIZE       = 32;
const BLOCK_SIZE       = 1;
const BASE_HEIGHT      = 3;
const HEIGHT_VARIATION = 6;
const STONE_DEPTH      = 1;
const WATER_LEVEL      = 2;

export const WORLD_MIN_Y = -10;
export const WORLD_MAX_Y =  50;

// ── Golpes necessários por tipo (estilo Minecraft) ──────────────────────────
const BLOCK_HITS: Record<string, number> = {
  grass: 3,
  dirt:  5,
  stone: 9,
  wood:  4,
  leaf:  1,
  planks: 4,
  brick: 7,
  iron: 12,
  wool_blue: 2,
};

// ── Drop por tipo ───────────────────────────────────────────────────────────
const BLOCK_DROP: Record<string, { itemId: string; itemLabel: string }> = {
  grass: { itemId: "grass_block", itemLabel: "Bloco de Grama"   },
  dirt:  { itemId: "dirt_block",  itemLabel: "Bloco de Terra"   },
  stone: { itemId: "stone_block", itemLabel: "Bloco de Pedra"   },
  wood:  { itemId: "wood_log",    itemLabel: "Tronco de Madeira" },
  leaf:  { itemId: "leaf_block",  itemLabel: "Folhas"           },
  planks: { itemId: "planks",     itemLabel: "Tábuas de Madeira" },
  brick:  { itemId: "brick",      itemLabel: "Blocos de Tijolo" },
  iron:   { itemId: "iron",       itemLabel: "Cubo de Ferro" },
  wool_blue: { itemId: "wool_blue", itemLabel: "Lã Azul" },
};

type ChunkData = {
  key:     string;
  group:   THREE.Group;
  targets: THREE.Object3D[];
  treeBoxes: TreeBlockBox[];
};

export type BreakResult =
  | { hit: true; broken: false; hitsLeft: number; blockCenter: THREE.Vector3 }
  | { hit: true; broken: true;  itemId: string; itemLabel: string; dropPos: THREE.Vector3 }
  | null;

export type TreeBlockBox = {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
  isLeaf: boolean;
  isStructure?: boolean;
};

export class VoxelTerrain {
  static hitsRequired(blockType: string): number {
    return BLOCK_HITS[blockType] ?? 2;
  }

  readonly group      = new THREE.Group();
  readonly spawnPoint: THREE.Vector3;
  readonly worldSize  = WORLD_SIZE;
  readonly waterLevel = WATER_LEVEL;
  readonly chunkSize  = CHUNK_SIZE;

  private viewRadius      = 3;
  private chunksPerUpdate = 1;

  private readonly noise2D;
  private readonly activeChunks         = new Map<string, ChunkData>();
  private readonly raycastTargetsCache: THREE.Object3D[] = [];
  private readonly pendingChunkKeys:    string[]          = [];
  private readonly queuedChunkKeys      = new Set<string>();
  /** Blocos individualmente removidos: key = "${gridX}:${gridZ}:${centerY}" */
  private readonly removedBlocks        = new Set<string>();
  private readonly blockHits            = new Map<string, number>();
  private readonly trunkMaterial        = TerrainTextures.createTrunkMaterial();
  private readonly leafMaterial         = TerrainTextures.createLeafMaterial();

  // Novos materiais para blocos de construção
  private readonly planksMaterials  = TerrainTextures.createPlanksMaterialSet();
  private readonly brickMaterials   = TerrainTextures.createBrickMaterialSet();
  private readonly ironMaterials    = TerrainTextures.createIronMaterialSet();
  private readonly woolBlueMaterials = TerrainTextures.createWoolBlueMaterialSet();

  private readonly treeBoxes: TreeBlockBox[] = [];
  private readonly _towerGX: number[] = [];
  private readonly _towerGZ: number[] = [];
  /** Blocos colocados manualmente: key = "x:z:y" -> blockType */
  private readonly placedBlocksByChunk  = new Map<string, Map<string, string>>();

  constructor() {
    this.group.name = "VoxelTerrain";
    this.noise2D    = createNoise2D(this.createSeededRandom(1337));
    this.computeTowerPositions();
    this.spawnPoint = new THREE.Vector3(0, this.getSurfaceHeightAt(0, 0) + 4, 0);
    this.buildOcean();
    this.buildLODMap();
    this.update(this.spawnPoint);
  }

  get raycastTargets(): THREE.Object3D[] { return this.raycastTargetsCache; }
  setViewRadius(r: number):       void   { this.viewRadius      = r; }
  setChunksPerUpdate(n: number):  void   { this.chunksPerUpdate = n; }

  // ── Atualização de chunks ───────────────────────────────────────────────
  update(playerPosition: THREE.Vector3): void {
    const pcx = Math.floor((playerPosition.x + WORLD_SIZE * 0.5) / CHUNK_SIZE);
    const pcz = Math.floor((playerPosition.z + WORLD_SIZE * 0.5) / CHUNK_SIZE);
    const desired = new Set<string>();

    for (let oz = -this.viewRadius; oz <= this.viewRadius; oz++) {
      for (let ox = -this.viewRadius; ox <= this.viewRadius; ox++) {
        if (ox * ox + oz * oz > this.viewRadius * this.viewRadius) continue;
        const cx = pcx + ox; const cz = pcz + oz;
        if (cx < 0 || cz < 0 || cx >= WORLD_SIZE / CHUNK_SIZE || cz >= WORLD_SIZE / CHUNK_SIZE) continue;
        const key = `${cx}:${cz}`;
        desired.add(key);
        if (!this.activeChunks.has(key) && !this.queuedChunkKeys.has(key)) {
          this.pendingChunkKeys.push(key);
          this.queuedChunkKeys.add(key);
        }
      }
    }

    let built = 0;
    while (this.pendingChunkKeys.length > 0 && built < this.chunksPerUpdate) {
      const key = this.pendingChunkKeys.shift(); if (!key) break;
      this.queuedChunkKeys.delete(key);
      if (!desired.has(key) || this.activeChunks.has(key)) continue;
      const [cx, cz] = key.split(":").map(Number);
      const chunk = this.createChunk(cx, cz);
      this.activeChunks.set(key, chunk);
      this.group.add(chunk.group);
      built++;
    }

    for (const [key, chunk] of this.activeChunks.entries()) {
      if (desired.has(key)) continue;
      this.group.remove(chunk.group);
      this.activeChunks.delete(key);
    }

    for (let i = this.pendingChunkKeys.length - 1; i >= 0; i--) {
      if (!desired.has(this.pendingChunkKeys[i])) {
        this.queuedChunkKeys.delete(this.pendingChunkKeys[i]);
        this.pendingChunkKeys.splice(i, 1);
      }
    }
    this.refreshRaycastTargets();
  }

  // ── Altura de superfície ────────────────────────────────────────────────

  /** Altura bruta sem considerar blocos removidos (usada na geração de chunks). */
  private computeRawHeight(x: number, z: number): number {
    const cx = THREE.MathUtils.clamp(x, -WORLD_SIZE * 0.5, WORLD_SIZE * 0.5 - 1);
    const cz = THREE.MathUtils.clamp(z, -WORLD_SIZE * 0.5, WORLD_SIZE * 0.5 - 1);
    const nx = cx / (WORLD_SIZE * 0.5);
    const nz = cz / (WORLD_SIZE * 0.5);
    const radial     = Math.sqrt(nx * nx + nz * nz);
    const islandMask = Math.max(0, 1 - radial * 1.05);
    const primary    = this.noise2D(nx * 2.4, nz * 2.4) * 0.95;
    const detail     = this.noise2D(nx * 7.8, nz * 7.8) * 0.28;
    const ridge      = Math.abs(this.noise2D(nx * 4.1, nz * 4.1)) * 0.85;
    const plateau    = islandMask * 7.5;
    const shaped     = BASE_HEIGHT + plateau + (primary + detail + ridge * 0.55) * HEIGHT_VARIATION;
    return THREE.MathUtils.clamp(Math.round(shaped), WATER_LEVEL, WORLD_MAX_Y);
  }

  /**
   * Altura pura do terreno, SEM árvores nem estruturas.
   * Usada pelos mobs para que eles andem no chão e contornem obstáculos
   * em vez de subir/descer por cima dos troncos.
   */
  getGroundHeightAt(x: number, z: number): number {
    const rawH = this.computeRawHeight(x, z);
    const gx   = Math.floor(THREE.MathUtils.clamp(x + WORLD_SIZE * 0.5, 0, WORLD_SIZE - 1));
    const gz   = Math.floor(THREE.MathUtils.clamp(z + WORLD_SIZE * 0.5, 0, WORLD_SIZE - 1));

    let maxH = WATER_LEVEL;
    let h    = rawH;
    while (h > WATER_LEVEL) {
      if (!this.removedBlocks.has(`${gx}:${gz}:${h - 0.5}`)) {
        maxH = Math.max(maxH, h);
        break;
      }
      h -= 1;
    }
    return maxH; // apenas terreno, sem caixas de árvore/estrutura
  }

  /**
   * Altura efetiva da superfície.
   * @param excludeTreeBlocks  Se true, ignora troncos/folhas/estruturas e retorna
   *                           apenas a altura do terreno natural. Usado para física
   *                           do player (escalada manual por Space).
   */
  getSurfaceHeightAt(x: number, z: number, excludeTreeBlocks = false): number {
    const rawH = this.computeRawHeight(x, z);
    const gx = Math.floor(THREE.MathUtils.clamp(x + WORLD_SIZE * 0.5, 0, WORLD_SIZE - 1));
    const gz = Math.floor(THREE.MathUtils.clamp(z + WORLD_SIZE * 0.5, 0, WORLD_SIZE - 1));

    let maxH = WATER_LEVEL;

    // 1. Terreno Natural
    let h = rawH;
    while (h > WATER_LEVEL) {
      if (!this.removedBlocks.has(`${gx}:${gz}:${h - 0.5}`)) {
        maxH = Math.max(maxH, h);
        break;
      }
      h -= 1;
    }

    // 2. Blocos de árvore/estrutura — pula se excludeTreeBlocks (evita auto-climb)
    if (!excludeTreeBlocks) {
      const pos = new THREE.Vector3(x, 100, z);
      const boxes = this.getTreeBoxesNear(pos, 2);
      for (const b of boxes) {
        if (b.isStructure) continue;
        if (x + 0.1 >= b.minX && x - 0.1 <= b.maxX && z + 0.1 >= b.minZ && z - 0.1 <= b.maxZ) {
          if (b.maxY > maxH) maxH = b.maxY;
        }
      }
    }

    return maxH;
  }

  // ── Caixas de colisão de troncos ────────────────────────────────────────
  getTreeBoxesNear(pos: THREE.Vector3, radius: number): TreeBlockBox[] {
    const r2 = (radius + 1) * (radius + 1);
    return this.treeBoxes.filter(b => {
      const cx = (b.minX + b.maxX) * 0.5 - pos.x;
      const cz = (b.minZ + b.maxZ) * 0.5 - pos.z;
      return cx * cx + cz * cz < r2;
    });
  }

  // ── Quebrar bloco de terreno (instanciado) ─────────────────────────────
  /**
   * blockCenter já é o centro exato do bloco, calculado com face-normal correction.
   * Garante que apenas ESSE bloco é removido — nenhum bloco "cai".
   */
  breakBlockAt(blockCenter: THREE.Vector3, _blockType: string): BreakResult {
    const gridX = Math.floor(blockCenter.x + WORLD_SIZE * 0.5);
    const gridZ = Math.floor(blockCenter.z + WORLD_SIZE * 0.5);
    if (gridX < 0 || gridZ < 0 || gridX >= WORLD_SIZE || gridZ >= WORLD_SIZE) return null;

    const worldX = gridX - WORLD_SIZE * 0.5 + 0.5;
    const worldZ = gridZ - WORLD_SIZE * 0.5 + 0.5;
    const rawH   = this.computeRawHeight(worldX, worldZ);
    if (rawH <= WATER_LEVEL) return null;

    // Chave única para este bloco exato
    const blockKey = `${gridX}:${gridZ}:${blockCenter.y}`;

    // Bloco já removido? Não faz nada.
    if (this.removedBlocks.has(blockKey)) return null;

    // Determina tipo com base na profundidade relativa à altura bruta
    const depth = rawH - blockCenter.y; // 0.5→grass, 1.5→dirt, 2.5+→stone
    let actualType: string;
    if      (depth < 1.0) actualType = "grass";
    else if (depth < 2.0) actualType = "dirt";
    else                  actualType = "stone";

    // Contagem de golpes
    const required = BLOCK_HITS[actualType] ?? 1;
    const current  = (this.blockHits.get(blockKey) ?? 0) + 1;
    if (current < required) {
      this.blockHits.set(blockKey, current);
      return { hit: true, broken: false, hitsLeft: required - current, blockCenter };
    }

    // Quebrado: registra bloco removido e reconstrói o chunk
    this.blockHits.delete(blockKey);
    this.removedBlocks.add(blockKey);
    this.rebuildChunkAtWorld(worldX, worldZ);

    const drop    = BLOCK_DROP[actualType] ?? BLOCK_DROP["grass"];
    const dropPos = new THREE.Vector3(worldX, blockCenter.y, worldZ);
    return { hit: true, broken: true, ...drop, dropPos };
  }

  placeBlockAt(position: THREE.Vector3, blockType: string): boolean {
    const gx = Math.floor(position.x + WORLD_SIZE * 0.5);
    const gz = Math.floor(position.z + WORLD_SIZE * 0.5);
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const cKey = `${cx}:${cz}`;

    let chunkMap = this.placedBlocksByChunk.get(cKey);
    if (!chunkMap) {
      chunkMap = new Map();
      this.placedBlocksByChunk.set(cKey, chunkMap);
    }

    const bKey = `${gx}:${gz}:${position.y}`;
    if (chunkMap.has(bKey)) return false; // Já ocupado

    chunkMap.set(bKey, blockType);
    this.rebuildChunkAtWorld(position.x, position.z);
    return true;
  }

  // ── Quebrar bloco de árvore (mesh individual) ──────────────────────────
  breakTreeBlock(mesh: THREE.Mesh): BreakResult {
    const blockType = (mesh.userData.blockType as string) ?? "wood";
    const required  = BLOCK_HITS[blockType] ?? 1;
    const uuid      = mesh.uuid;
    const current   = (this.blockHits.get(uuid) ?? 0) + 1;

    if (current < required) {
      this.blockHits.set(uuid, current);
      return { hit: true, broken: false, hitsLeft: required - current, blockCenter: mesh.position.clone() };
    }

    this.blockHits.delete(uuid);

    // Registra como quebrado para que em recarregamentos de chunk a folha continue apagada
    const bx = mesh.position.x;
    const by = mesh.position.y;
    const bz = mesh.position.z;
    this.removedBlocks.add(`${bx}:${bz}:${by}`);

    // Remove dos targets e da colisão fisicamente
    const uuidStr = mesh.uuid;
    for (const chunk of this.activeChunks.values()) {
       const tIdx = chunk.targets.findIndex(t => t.uuid === uuidStr);
       if (tIdx !== -1) chunk.targets.splice(tIdx, 1);

       const bIdx = chunk.treeBoxes.findIndex(b => Math.abs((b.minX + b.maxX)*0.5 - bx) < 0.1 && Math.abs((b.minY + b.maxY)*0.5 - by) < 0.1 && Math.abs((b.minZ + b.maxZ)*0.5 - bz) < 0.1);
       if (bIdx !== -1) chunk.treeBoxes.splice(bIdx, 1);
    }

    mesh.removeFromParent();
    mesh.visible = false;
    mesh.geometry.dispose();

    this.refreshRaycastTargets();

    const drop    = BLOCK_DROP[blockType] ?? BLOCK_DROP["wood"];
    const dropPos = mesh.position.clone();
    return { hit: true, broken: true, ...drop, dropPos };
  }

  // ── Oceano ─────────────────────────────────────────────────────────────
  private buildOcean(): void {
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE * 1.8, WORLD_SIZE * 1.8),
      new THREE.MeshStandardMaterial({
        color: 0x2f7fb8, transparent: true, opacity: 0.88,
        roughness: 0.28, metalness: 0.08,
      })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = WATER_LEVEL + 0.15;
    ocean.receiveShadow = true;
    this.group.add(ocean);
  }

  // ── LOD map ────────────────────────────────────────────────────────────
  private buildLODMap(): void {
    const segments = 128;
    const geo  = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
    const pos  = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i); const vy = pos.getY(i);
      const h  = this.computeRawHeight(vx, -vy);
      const hasTree = this.shouldPlaceTree(vx, -vy, h);
      let r, g, b;
      if      (h <= WATER_LEVEL + 0.1)  { r=47/255;  g=127/255; b=184/255; }
      else if (h <= WATER_LEVEL + 1.2)  { r=200/255; g=176/255; b=106/255; }
      else if (hasTree)                 { r=34/255;  g=90/255;  b=26/255;  }
      else if (h <= 7)                  { r=88/255;  g=158/255; b=58/255;  }
      else if (h <= 11)                 { r=74/255;  g=130/255; b=48/255;  }
      else                              { r=100/255; g=88/255;  b=60/255;  }
      colors[i*3]=r; colors[i*3+1]=g; colors[i*3+2]=b;
      pos.setZ(i, h);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader.replace(
        `#include <worldpos_vertex>`,
        `#include <worldpos_vertex>\n  vWorldPos = (modelMatrix * vec4(position,1.0)).xyz;`
      );
      shader.fragmentShader = `varying vec3 vWorldPos;\n` + shader.fragmentShader.replace(
        `void main() {`,
        `void main() { if (length(cameraPosition.xz - vWorldPos.xz) < 80.0 && cameraPosition.y < 120.0) discard;`
      );
    };

    const lodMesh       = new THREE.Mesh(geo, mat);
    lodMesh.rotation.x  = -Math.PI / 2;
    lodMesh.position.y  = -0.51;
    lodMesh.receiveShadow = true;
    this.group.add(lodMesh);
  }

  // ── Chunk ──────────────────────────────────────────────────────────────
  private createChunk(chunkX: number, chunkZ: number): ChunkData {
    const key   = `${chunkX}:${chunkZ}`;
    const group = new THREE.Group();
    group.name  = `chunk-${key}`;

    const box      = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    const capacity = CHUNK_SIZE * CHUNK_SIZE;

    const grassMesh = new THREE.InstancedMesh(box, TerrainTextures.createGrassMaterialSet(), capacity);
    const dirtMesh  = new THREE.InstancedMesh(box, TerrainTextures.createDirtMaterialSet(),  capacity);
    const stoneMesh = new THREE.InstancedMesh(box, TerrainTextures.createStoneMaterialSet(), capacity * (STONE_DEPTH + 1));
    
    const planksMesh = new THREE.InstancedMesh(box, this.planksMaterials,  capacity / 4);
    const brickMesh  = new THREE.InstancedMesh(box, this.brickMaterials,   capacity / 4);
    const ironMesh   = new THREE.InstancedMesh(box, this.ironMaterials,    capacity / 4);
    const woolMesh   = new THREE.InstancedMesh(box, this.woolBlueMaterials, capacity / 4);

    for (const m of [grassMesh, dirtMesh, stoneMesh, planksMesh, brickMesh, ironMesh, woolMesh]) {
      m.receiveShadow      = true;
      m.userData.breakable = true;
    }
    grassMesh.userData.blockType = "grass";
    dirtMesh.userData.blockType  = "dirt";
    stoneMesh.userData.blockType = "stone";
    planksMesh.userData.blockType = "planks";
    brickMesh.userData.blockType = "brick";
    ironMesh.userData.blockType = "iron";
    woolMesh.userData.blockType = "wool_blue";

    let gc = 0, dc = 0, sc = 0;
    let pc = 0, bc = 0, ic = 0, wc = 0;
    const matrix  = new THREE.Matrix4();
    const targets = [grassMesh, dirtMesh, stoneMesh, planksMesh, brickMesh, ironMesh, woolMesh] as THREE.Object3D[];
    const chunkTreeBoxes: TreeBlockBox[] = [];

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const gx   = chunkX * CHUNK_SIZE + lx;
        const gz   = chunkZ * CHUNK_SIZE + lz;
        const wx   = gx - WORLD_SIZE * 0.5 + 0.5;
        const wz   = gz - WORLD_SIZE * 0.5 + 0.5;
        const rawH = this.computeRawHeight(wx, wz);

        // ── Bloco de topo (grama ou areia perto da água) ─────────────────
        const topY   = rawH - 0.5;
        const topKey = `${gx}:${gz}:${topY}`;
        if (!this.removedBlocks.has(topKey)) {
          matrix.makeTranslation(wx, topY, wz);
          if (rawH <= WATER_LEVEL + 1) { dirtMesh.setMatrixAt(dc++, matrix); }
          else                          { grassMesh.setMatrixAt(gc++, matrix); }
        }

        // ── Bloco de terra ───────────────────────────────────────────────
        const dirtY   = rawH - 1.5;
        const dirtKey = `${gx}:${gz}:${dirtY}`;
        if (!this.removedBlocks.has(dirtKey)) {
          matrix.makeTranslation(wx, dirtY, wz);
          dirtMesh.setMatrixAt(dc++, matrix);
        }

        // ── Camadas de pedra ─────────────────────────────────────────────
        for (let depth = 2; depth <= 1 + STONE_DEPTH; depth++) {
          const stoneY   = rawH - 0.5 - depth;
          const stoneKey = `${gx}:${gz}:${stoneY}`;
          if (!this.removedBlocks.has(stoneKey)) {
            matrix.makeTranslation(wx, stoneY, wz);
            stoneMesh.setMatrixAt(sc++, matrix);
          }
        }

        // ── Árvore ou Torre ────────────────────────────────────────────────
        const hasTower = this.shouldPlaceTower(wx, wz, rawH);
        if (hasTower) {
           this.buildWatchTower(wx, rawH, wz, group, targets, chunkTreeBoxes);
        } else if (this.shouldPlaceTree(wx, wz, rawH)) {
          const treeData = this.createTree(wx, rawH, wz);
          group.add(treeData.group);
          for (const child of treeData.group.children) {
            if ((child as THREE.Mesh).isMesh) targets.push(child);
          }
          chunkTreeBoxes.push(...treeData.boxes);
        }
      }
    }

    // ── Blocos Colocados no Chunk ──────────────────────────────────────
    const placedMap = this.placedBlocksByChunk.get(key);
    if (placedMap) {
      for (const [bKey, blockType] of placedMap.entries()) {
        const [gx, gz, by] = bKey.split(":").map(Number);
        const wx = gx - WORLD_SIZE * 0.5 + 0.5;
        const wz = gz - WORLD_SIZE * 0.5 + 0.5;
        matrix.makeTranslation(wx, by, wz);

        if (blockType === "planks") planksMesh.setMatrixAt(pc++, matrix);
        else if (blockType === "brick") brickMesh.setMatrixAt(bc++, matrix);
        else if (blockType === "iron") ironMesh.setMatrixAt(ic++, matrix);
        else if (blockType === "wool_blue") woolMesh.setMatrixAt(wc++, matrix);
        else if (blockType === "grass") grassMesh.setMatrixAt(gc++, matrix);
        else if (blockType === "dirt") dirtMesh.setMatrixAt(dc++, matrix);
        else if (blockType === "stone") stoneMesh.setMatrixAt(sc++, matrix);

        chunkTreeBoxes.push({
           minX: wx - 0.5, maxX: wx + 0.5,
           minY: by - 0.5, maxY: by + 0.5,
           minZ: wz - 0.5, maxZ: wz + 0.5,
           isLeaf: true
        });
      }
    }

    grassMesh.count = gc; grassMesh.instanceMatrix.needsUpdate = true;
    dirtMesh.count  = dc; dirtMesh.instanceMatrix.needsUpdate  = true;
    stoneMesh.count = sc; stoneMesh.instanceMatrix.needsUpdate  = true;
    planksMesh.count = pc; planksMesh.instanceMatrix.needsUpdate = true;
    brickMesh.count = bc; brickMesh.instanceMatrix.needsUpdate = true;
    ironMesh.count = ic; ironMesh.instanceMatrix.needsUpdate = true;
    woolMesh.count = wc; woolMesh.instanceMatrix.needsUpdate = true;

    group.add(grassMesh, dirtMesh, stoneMesh, planksMesh, brickMesh, ironMesh, woolMesh);
    return { key, group, targets, treeBoxes: chunkTreeBoxes };
  }

  public shouldPlaceTree(worldX: number, worldZ: number, height: number): boolean {
    if (height <= WATER_LEVEL + 1) return false;
    // Limpa toda a vegetação num raio de 10 blocos ao redor de cada torre
    for (let i = 0; i < this._towerGX.length; i++) {
      const tx = this._towerGX[i] - WORLD_SIZE * 0.5 + 0.5;
      const tz = this._towerGZ[i] - WORLD_SIZE * 0.5 + 0.5;
      const dx = worldX - tx; const dz = worldZ - tz;
      if (dx * dx + dz * dz < 100) return false; // raio 10
    }
    const nx = worldX / (WORLD_SIZE * 0.5);
    const nz = worldZ / (WORLD_SIZE * 0.5);
    if (Math.sqrt(nx * nx + nz * nz) > 0.78) return false;
    return this.hash(worldX * 0.35, worldZ * 0.35) > 0.988;
  }

  public shouldPlaceTower(worldX: number, worldZ: number, _height: number): boolean {
    // Compara com as 6 posições pré-calculadas (grid)
    const gx = Math.round(worldX + WORLD_SIZE * 0.5 - 0.5);
    const gz = Math.round(worldZ + WORLD_SIZE * 0.5 - 0.5);
    for (let i = 0; i < this._towerGX.length; i++) {
      if (this._towerGX[i] === gx && this._towerGZ[i] === gz) return true;
    }
    return false;
  }

  /** Retorna as posições mundiais das torres (para o minimapa etc.) */
  public getTowerWorldPositions(): { x: number; z: number }[] {
    return this._towerGX.map((gx, i) => ({
      x: gx - WORLD_SIZE * 0.5 + 0.5,
      z: this._towerGZ[i] - WORLD_SIZE * 0.5 + 0.5,
    }));
  }

  /** Calcula até 6 posições de torre distribuídas no mapa, afastadas entre si */
  private computeTowerPositions(): void {
    const rng   = this.createSeededRandom(9999);
    const TARGET = 6;
    const MIN_DIST = 80;
    const center  = WORLD_SIZE / 2; // 256
    const minR    = 55;
    const maxR    = Math.floor(WORLD_SIZE * 0.37); // ≈189 – zona interior do mapa

    let attempts = 0;
    while (this._towerGX.length < TARGET && attempts < 2000) {
      attempts++;
      const angle = rng() * Math.PI * 2;
      const r     = minR + rng() * (maxR - minR);
      const gx    = Math.round(center + Math.cos(angle) * r);
      const gz    = Math.round(center + Math.sin(angle) * r);

      if (gx < 10 || gz < 10 || gx >= WORLD_SIZE - 10 || gz >= WORLD_SIZE - 10) continue;

      const wx = gx - WORLD_SIZE * 0.5 + 0.5;
      const wz = gz - WORLD_SIZE * 0.5 + 0.5;
      if (this.computeRawHeight(wx, wz) <= WATER_LEVEL + 5) continue; // não em água/praia

      let tooClose = false;
      for (let i = 0; i < this._towerGX.length; i++) {
        const dx = gx - this._towerGX[i];
        const dz = gz - this._towerGZ[i];
        if (dx * dx + dz * dz < MIN_DIST * MIN_DIST) { tooClose = true; break; }
      }
      if (!tooClose) { this._towerGX.push(gx); this._towerGZ.push(gz); }
    }
  }

  // ── Árvore sem sobreposição tronco/folha ──────────────────────────────
  private createTree(x: number, baseHeight: number, z: number): { group: THREE.Group, boxes: TreeBlockBox[] } {
    const tree     = new THREE.Group();
    const boxes: TreeBlockBox[] = [];
    const seed     = this.hash(x * 0.5, z * 0.5);
    const trunkH   = 4 + Math.floor(seed * 3);
    const style    = Math.floor(this.hash(x + 17, z + 29) * 3);

    // Tronco: 1×1×1 (cubo perfeito igual ao bloco de terreno)
    for (let y = 0; y < trunkH; y++) {
      const worldY = baseHeight + y + 0.5;
      const blockKey = `${x}:${z}:${worldY}`;
      if (this.removedBlocks.has(blockKey)) continue;

      const trunk  = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.trunkMaterial);
      trunk.position.set(x, worldY, z);
      trunk.castShadow = trunk.receiveShadow = true;
      trunk.userData.breakable = true;
      trunk.userData.blockType = "wood";
      tree.add(trunk);

      boxes.push({
        minX: x - 0.5, maxX: x + 0.5,
        minY: worldY - 0.5, maxY: worldY + 0.5,
        minZ: z - 0.5, maxZ: z + 0.5,
        isLeaf: false,
      });
    }

    // Folhas: começam 1 acima do topo do tronco
    for (const [ox, oy, oz] of this.getCanopyOffsets(style)) {
      if (ox === 0 && oz === 0 && oy <= 0) continue; // não sobrepor tronco
      const leafOffset = baseHeight + trunkH + oy + 0.5;
      const px = x + ox;
      const pz = z + oz;
      const blockKey = `${px}:${pz}:${leafOffset}`;
      if (this.removedBlocks.has(blockKey)) continue;

      const leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.leafMaterial);
      leaf.position.set(px, leafOffset, pz);
      leaf.castShadow = leaf.receiveShadow = true;
      leaf.userData.breakable = true;
      leaf.userData.blockType = "leaf";
      tree.add(leaf);

      boxes.push({
        minX: px - 0.5, maxX: px + 0.5,
        minY: leafOffset - 0.5, maxY: leafOffset + 0.5,
        minZ: pz - 0.5, maxZ: pz + 0.5,
        isLeaf: true,
      });
    }

    return { group: tree, boxes };
  }

  private getCanopyOffsets(style: number): number[][] {
    if (style === 0) {
      return [
        [-1,0,-1],[-1,0,0],[-1,0,1],
        [ 0,0,-1],[ 0,0,0],[ 0,0,1],
        [ 1,0,-1],[ 1,0,0],[ 1,0,1],
        [-1,1, 0],[ 0,1,-1],[ 0,1,0],[ 0,1,1],[ 1,1,0],
        [ 0,2, 0],
      ];
    }
    if (style === 1) {
      return [
        [-2,0, 0],[ 2,0,0],[ 0,0,-2],[ 0,0, 2],
        [-1,0,-1],[-1,0,0],[-1,0, 1],
        [ 0,0,-1],[ 0,0,0],[ 0,0, 1],
        [ 1,0,-1],[ 1,0,0],[ 1,0, 1],
        [ 0,1, 0],[ 0,2, 0],
      ];
    }
    return [
      [-1,0, 0],[ 1,0,0],[ 0,0,-1],[ 0,0,1],[ 0,0,0],
      [-1,1,-1],[-1,1, 0],[-1,1, 1],
      [ 0,1,-1],[ 0,1, 0],[ 0,1, 1],
      [ 1,1,-1],[ 1,1, 0],[ 1,1, 1],
      [ 0,2, 0],[-1,2, 0],[ 1,2,0],[ 0,2,-1],[ 0,2,1],
      [ 0,3, 0],
    ];
  }

  private buildWatchTower(x: number, y: number, z: number, group: THREE.Group, targets: THREE.Object3D[], boxes: TreeBlockBox[]): void {
    const base     = y;
    const brickMat = this.brickMaterials[0];
    const plankMat = this.planksMaterials[0];

    /** Adiciona um bloco de estrutura: não é usado em física de mobs/jogador */
    const add = (wx: number, wy: number, wz: number, mat: THREE.Material, blockType: string) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      mesh.position.set(wx, wy + 0.5, wz);
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      mesh.userData.breakable  = true;
      mesh.userData.blockType  = blockType;
      group.add(mesh);
      targets.push(mesh);
      boxes.push({
        minX: wx - 0.5, maxX: wx + 0.5,
        minY: wy,       maxY: wy + 1,
        minZ: wz - 0.5, maxZ: wz + 0.5,
        isLeaf: false,
        isStructure: true,   // mobs ignoram esses blocos para altura do terreno
      });
    };

    // ── Paredes ocas de tijolo (3×3 exterior, centro oco), 5 camadas ──────
    for (let wy = 0; wy < 5; wy++) {
      for (let bx = -1; bx <= 1; bx++) {
        for (let bz = -1; bz <= 1; bz++) {
          if (bx === 0 && bz === 0) continue; // interior oco
          add(x + bx, base + wy, z + bz, brickMat, "brick");
        }
      }
    }

    // ── Plataforma de madeira (5×5) no topo ──────────────────────────────
    for (let px = -2; px <= 2; px++) {
      for (let pz = -2; pz <= 2; pz++) {
        add(x + px, base + 5, z + pz, plankMat, "planks");
      }
    }

    // ── Ameias nos 4 cantos da plataforma ────────────────────────────────
    for (const [cx, cz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as [number, number][]) {
      add(x + cx, base + 6, z + cz, brickMat, "brick");
    }
  }

  private refreshRaycastTargets(): void {
    this.raycastTargetsCache.length = 0;
    this.treeBoxes.length = 0;
    for (const chunk of this.activeChunks.values()) {
      this.raycastTargetsCache.push(...chunk.targets);
      this.treeBoxes.push(...chunk.treeBoxes);
    }
  }

  private rebuildChunkAtWorld(worldX: number, worldZ: number): void {
    const cx  = Math.floor((worldX + WORLD_SIZE * 0.5) / CHUNK_SIZE);
    const cz  = Math.floor((worldZ + WORLD_SIZE * 0.5) / CHUNK_SIZE);
    const key = `${cx}:${cz}`;
    const existing = this.activeChunks.get(key);
    if (existing) {
      this.group.remove(existing.group);
      this.activeChunks.delete(key);
    }
    const rebuilt = this.createChunk(cx, cz);
    this.activeChunks.set(key, rebuilt);
    this.group.add(rebuilt.group);
    this.refreshRaycastTargets();
  }

  private hash(x: number, z: number): number {
    const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453123;
    return v - Math.floor(v);
  }

  private createSeededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 0xffffffff;
    };
  }
}
