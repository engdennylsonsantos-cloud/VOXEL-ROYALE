import * as THREE from "three";
import { VoxelTerrain } from "./VoxelTerrain";

const MAP_PX    = 256;   // resolução do canvas do minimapa
const DOT_R     = 3;     // raio do ponto do jogador
const WATER_LVL = 2;

export class MinimapUI {
  private readonly canvas  = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly overlay = document.createElement("canvas");
  private readonly octx: CanvasRenderingContext2D;
  private readonly worldSize: number;
  private readonly scale: number; // world units por pixel
  private readonly rootElement: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly terrain: VoxelTerrain
  ) {
    this.worldSize = terrain.worldSize;
    this.scale     = this.worldSize / MAP_PX;

    this.canvas.width  = MAP_PX;
    this.canvas.height = MAP_PX;
    this.ctx = this.canvas.getContext("2d")!;

    this.overlay.width  = MAP_PX;
    this.overlay.height = MAP_PX;
    this.octx = this.overlay.getContext("2d")!;

    // Contêiner
    this.rootElement = document.createElement("div");
    this.rootElement.className = "minimap-wrap";
    this.rootElement.style.position = "absolute";
    this.rootElement.style.bottom = "20px";
    this.rootElement.style.right = "20px";
    this.rootElement.style.width = "190px";
    this.rootElement.style.height = "190px";
    this.rootElement.style.borderRadius = "10px";
    this.rootElement.style.overflow = "hidden";
    this.rootElement.style.border = "3px solid rgba(255,255,255,0.3)";
    this.rootElement.style.boxShadow = "0 4px 10px rgba(0,0,0,0.5)";
    
    this.canvas.style.position = "absolute";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    
    this.overlay.style.position = "absolute";
    this.overlay.style.width = "100%";
    this.overlay.style.height = "100%";

    this.rootElement.append(this.canvas, this.overlay);
    this.root.append(this.rootElement);

    // Gera o mapa de terreno (puro cálculo, sem geometria)
    this.buildTerrainTexture();
  }

  update(playerPos: THREE.Vector3, stormState?: any): void {
    const octx = this.octx;
    octx.clearRect(0, 0, MAP_PX, MAP_PX);

    if (stormState) {
      // Desenha o círculo de gás atual e pinta as áreas fora dele
      const cw = MAP_PX;
      const cpx = Math.round((stormState.currentCenter.x + this.worldSize * 0.5) / this.scale);
      const cpy = Math.round((stormState.currentCenter.z + this.worldSize * 0.5) / this.scale);
      const cr  = stormState.currentRadius / this.scale;

      // Overlay transparente de fora (Inverse fill path)
      octx.fillStyle = "rgba(120, 0, 200, 0.4)";
      octx.beginPath();
      octx.rect(0, 0, cw, cw);
      octx.arc(cpx, cpy, cr, 0, Math.PI * 2, true);
      octx.fill();

      // Borda do gás
      octx.beginPath();
      octx.arc(cpx, cpy, cr, 0, Math.PI * 2);
      octx.strokeStyle = "rgba(180, 50, 255, 0.8)";
      octx.lineWidth = 3;
      octx.stroke();

      if (stormState.phase !== "paused") {
        // Alvo
        const tpx = Math.round((stormState.targetCenter.x + this.worldSize * 0.5) / this.scale);
        const tpy = Math.round((stormState.targetCenter.z + this.worldSize * 0.5) / this.scale);
        const tr  = stormState.targetRadius / this.scale;

        octx.beginPath();
        octx.arc(tpx, tpy, tr, 0, Math.PI * 2);
        octx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        octx.setLineDash([4, 4]);
        octx.lineWidth = 2;
        octx.stroke();
        octx.setLineDash([]);
        
        // Linha indicando para onde vai (do player? do centro?)
        octx.beginPath();
        octx.moveTo(cpx, cpy);
        octx.lineTo(tpx, tpy);
        octx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        octx.stroke();
      }
    }

    // Ponto do jogador
    const px = Math.round((playerPos.x + this.worldSize * 0.5) / this.scale);
    const py = Math.round((playerPos.z + this.worldSize * 0.5) / this.scale);

    // Círculo branco com borda preta
    octx.beginPath();
    octx.arc(px, py, DOT_R + 1, 0, Math.PI * 2);
    octx.fillStyle = "#000";
    octx.fill();

    octx.beginPath();
    octx.arc(px, py, DOT_R, 0, Math.PI * 2);
    octx.fillStyle = "#fff";
    octx.fill();
  }

  private buildTerrainTexture(): void {
    const ctx   = this.ctx;
    const img   = ctx.createImageData(MAP_PX, MAP_PX);
    const data  = img.data;
    const half  = this.worldSize * 0.5;
    const scale = this.scale;

    for (let py = 0; py < MAP_PX; py++) {
      for (let px = 0; px < MAP_PX; px++) {
        const wx = px * scale - half;
        const wz = py * scale - half;
        const h  = this.terrain.getSurfaceHeightAt(wx, wz);
        const hasTree = this.terrain.shouldPlaceTree(wx, wz, h);

        const [r, g, b] = this.heightToColor(h, hasTree);
        const i = (py * MAP_PX + px) * 4;
        data[i]     = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);

    // ── Ícones de Torres (posições pré-calculadas, máx 6) ────────────────
    const towerPositions = this.terrain.getTowerWorldPositions();
    for (const tp of towerPositions) {
      const mx = Math.round((tp.x + half) / scale);
      const my = Math.round((tp.z + half) / scale);

      // Halo exterior brilhante
      ctx.save();
      ctx.shadowColor = "rgba(255, 180, 0, 1.0)";
      ctx.shadowBlur  = 8;

      // Círculo preenchido laranja
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ff8800";
      ctx.fill();

      // Borda branca
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth   = 1.5;
      ctx.stroke();
      ctx.restore();

      // Cruz preta interna (símbolo de ponto de interesse)
      ctx.save();
      ctx.strokeStyle = "#1a0a00";
      ctx.lineWidth   = 1.5;
      ctx.lineCap     = "round";
      ctx.beginPath();
      ctx.moveTo(mx - 3, my); ctx.lineTo(mx + 3, my);
      ctx.moveTo(mx, my - 3); ctx.lineTo(mx, my + 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  private heightToColor(h: number, hasTree: boolean): [number, number, number] {
    if (h <= WATER_LVL)      return [47,  127, 184]; // água
    if (h <= WATER_LVL + 1)  return [200, 176, 106]; // areia / praia
    if (hasTree)             return [34,  90,  26];  // floresta
    if (h <= 7)              return [88,  158,  58]; // grama baixa
    if (h <= 11)             return [74,  130,  48]; // grama média
    return                   [100, 88,   60];  // terreno alto
  }
}
