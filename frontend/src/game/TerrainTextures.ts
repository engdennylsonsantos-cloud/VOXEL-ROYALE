import * as THREE from "three";

export class TerrainTextures {
  private static readonly size = 8; // 8×8 para máximo desempenho
  private static grassTopTexture?: THREE.CanvasTexture;
  private static grassSideTexture?: THREE.CanvasTexture;
  private static dirtTexture?: THREE.CanvasTexture;
  private static stoneTexture?: THREE.CanvasTexture;
  private static trunkTexture?: THREE.CanvasTexture;
  private static leafTexture?: THREE.CanvasTexture;
  private static planksTexture?: THREE.CanvasTexture;
  private static brickTexture?: THREE.CanvasTexture;
  private static ironTexture?: THREE.CanvasTexture;
  private static woolBlueTexture?: THREE.CanvasTexture;

  static createGrassMaterialSet(): THREE.MeshStandardMaterial[] {
    const sideTexture = this.getGrassSideTexture();
    const topTexture = this.getGrassTopTexture();
    const dirtTexture = this.getDirtTexture();

    return [
      new THREE.MeshStandardMaterial({ map: sideTexture, roughness: 1 }),
      new THREE.MeshStandardMaterial({ map: sideTexture, roughness: 1 }),
      new THREE.MeshStandardMaterial({ map: topTexture, roughness: 1 }),
      new THREE.MeshStandardMaterial({ map: dirtTexture, roughness: 1 }),
      new THREE.MeshStandardMaterial({ map: sideTexture, roughness: 1 }),
      new THREE.MeshStandardMaterial({ map: sideTexture, roughness: 1 })
    ];
  }

  static createDirtMaterialSet(): THREE.MeshStandardMaterial[] {
    const texture = this.getDirtTexture();
    return new Array(6).fill(null).map(
      () =>
        new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 1
        })
    );
  }

  static createStoneMaterialSet(): THREE.MeshStandardMaterial[] {
    const texture = this.getStoneTexture();
    return new Array(6).fill(null).map(
      () =>
        new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.95,
          metalness: 0.05
        })
    );
  }

  static createTrunkMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      map: this.getTrunkTexture(),
      roughness: 1
    });
  }

  static createLeafMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      map: this.getLeafTexture(),
      alphaTest: 0.35,
      transparent: true,
      roughness: 1
    });
  }

  static createPlanksMaterialSet(): THREE.MeshStandardMaterial[] {
    const texture = this.getPlanksTexture();
    return new Array(6).fill(null).map(() => new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }));
  }

  static createBrickMaterialSet(): THREE.MeshStandardMaterial[] {
    const texture = this.getBrickTexture();
    return new Array(6).fill(null).map(() => new THREE.MeshStandardMaterial({ map: texture, roughness: 1.0 }));
  }

  static createIronMaterialSet(): THREE.MeshStandardMaterial[] {
    const texture = this.getIronTexture();
    return new Array(6).fill(null).map(() => new THREE.MeshStandardMaterial({ map: texture, roughness: 0.4, metalness: 0.7 }));
  }

  static createWoolBlueMaterialSet(): THREE.MeshStandardMaterial[] {
    const texture = this.getWoolBlueTexture();
    return new Array(6).fill(null).map(() => new THREE.MeshStandardMaterial({ map: texture, roughness: 1.0 }));
  }

  private static getGrassTopTexture(): THREE.CanvasTexture {
    if (!this.grassTopTexture) {
      this.grassTopTexture = this.toTexture(this.createGrassTopCanvas());
    }
    return this.grassTopTexture;
  }

  private static getGrassSideTexture(): THREE.CanvasTexture {
    if (!this.grassSideTexture) {
      this.grassSideTexture = this.toTexture(this.createGrassSideCanvas());
    }
    return this.grassSideTexture;
  }

  private static getDirtTexture(): THREE.CanvasTexture {
    if (!this.dirtTexture) {
      this.dirtTexture = this.toTexture(this.createDirtCanvas());
    }
    return this.dirtTexture;
  }

  private static getStoneTexture(): THREE.CanvasTexture {
    if (!this.stoneTexture) {
      this.stoneTexture = this.toTexture(this.createStoneCanvas());
    }
    return this.stoneTexture;
  }

  private static getTrunkTexture(): THREE.CanvasTexture {
    if (!this.trunkTexture) {
      this.trunkTexture = this.toTexture(this.createTrunkCanvas());
    }
    return this.trunkTexture;
  }

  private static getLeafTexture(): THREE.CanvasTexture {
    if (!this.leafTexture) {
      this.leafTexture = this.toTexture(this.createLeafCanvas());
    }
    return this.leafTexture;
  }

  private static getPlanksTexture(): THREE.CanvasTexture {
    if (!this.planksTexture) this.planksTexture = this.toTexture(this.createPlanksCanvas());
    return this.planksTexture;
  }

  private static getBrickTexture(): THREE.CanvasTexture {
    if (!this.brickTexture) this.brickTexture = this.toTexture(this.createBrickCanvas());
    return this.brickTexture;
  }

  private static getIronTexture(): THREE.CanvasTexture {
    if (!this.ironTexture) this.ironTexture = this.toTexture(this.createIronCanvas());
    return this.ironTexture;
  }

  private static getWoolBlueTexture(): THREE.CanvasTexture {
    if (!this.woolBlueTexture) this.woolBlueTexture = this.toTexture(this.createWoolBlueCanvas());
    return this.woolBlueTexture;
  }

  private static toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private static createGrassTopCanvas(): HTMLCanvasElement {
    const canvas = this.createCanvas();
    const context = this.getContext(canvas);
    const image = context.createImageData(this.size, this.size);

    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        const index = (y * this.size + x) * 4;
        const variation = this.random2D(x, y);
        const brightPatch = this.random2D(x + 9, y + 17) > 0.78 ? 12 : 0;
        const shade = 0.8 + variation * 0.28;
        image.data[index] = Math.floor(84 * shade);
        image.data[index + 1] = Math.floor(146 * shade + brightPatch + (x % 5 === 0 ? 8 : 0));
        image.data[index + 2] = Math.floor(56 * shade);
        image.data[index + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
    return canvas;
  }

  private static createGrassSideCanvas(): HTMLCanvasElement {
    const canvas = this.createCanvas();
    const context = this.getContext(canvas);
    const image = context.createImageData(this.size, this.size);

    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        const index = (y * this.size + x) * 4;
        const topLayer = y < 5;
        const variation = this.random2D(x, y);

        if (topLayer) {
          const shade = 0.86 + variation * 0.18;
          image.data[index] = Math.floor(90 * shade);
          image.data[index + 1] = Math.floor(154 * shade);
          image.data[index + 2] = Math.floor(61 * shade);
        } else {
          const layerNoise = this.random2D(x + 31, y + 5) > 0.84 ? 10 : 0;
          const shade = 0.74 + variation * 0.2;
          image.data[index] = Math.floor(112 * shade + layerNoise);
          image.data[index + 1] = Math.floor(79 * shade + layerNoise * 0.35);
          image.data[index + 2] = Math.floor(45 * shade);
        }

        image.data[index + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
    return canvas;
  }

  private static createDirtCanvas(): HTMLCanvasElement {
    const canvas = this.createCanvas();
    const context = this.getContext(canvas);
    const image = context.createImageData(this.size, this.size);

    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        const index = (y * this.size + x) * 4;
        const variation = this.random2D(x, y);
        const speck = this.random2D(x + 33, y + 71) > 0.8 ? 16 : 0;
        const darkPatch = this.random2D(x + 11, y + 49) > 0.87 ? -12 : 0;
        const shade = 0.7 + variation * 0.3;
        image.data[index] = Math.floor(118 * shade + speck + darkPatch);
        image.data[index + 1] = Math.floor(83 * shade + speck * 0.35 + darkPatch * 0.35);
        image.data[index + 2] = Math.floor(50 * shade + darkPatch * 0.2);
        image.data[index + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
    return canvas;
  }

  private static createStoneCanvas(): HTMLCanvasElement {
    const canvas = this.createCanvas();
    const context = this.getContext(canvas);
    const image = context.createImageData(this.size, this.size);

    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        const index = (y * this.size + x) * 4;
        const variation = this.random2D(x, y);
        const crack = this.random2D(x + 19, y + 41) > 0.84 ? -18 : 0;
        const oreTint = this.random2D(x + 101, y + 13) > 0.93 ? 10 : 0;
        const shade = 0.7 + variation * 0.26;
        const base = Math.floor(118 * shade + crack);
        image.data[index] = base;
        image.data[index + 1] = base + oreTint;
        image.data[index + 2] = Math.floor(128 * shade + crack + oreTint * 0.4);
        image.data[index + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
    return canvas;
  }

  private static createTrunkCanvas(): HTMLCanvasElement {
    const canvas = this.createCanvas();
    const context = this.getContext(canvas);
    const image = context.createImageData(this.size, this.size);

    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        const index = (y * this.size + x) * 4;
        const barkLine = x % 4 === 0 ? 18 : 0;
        const variation = this.random2D(x, y);
        const shade = 0.72 + variation * 0.2;
        image.data[index] = Math.floor(106 * shade + barkLine);
        image.data[index + 1] = Math.floor(73 * shade + barkLine * 0.25);
        image.data[index + 2] = Math.floor(43 * shade);
        image.data[index + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
    return canvas;
  }

  private static createLeafCanvas(): HTMLCanvasElement {
    const canvas = this.createCanvas();
    const context = this.getContext(canvas);
    const image = context.createImageData(this.size, this.size);

    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        const index = (y * this.size + x) * 4;
        const alphaNoise = this.random2D(x + 41, y + 13);
        const dense = alphaNoise > 0.18;
        const variation = this.random2D(x, y);
        const highlight = this.random2D(x + 7, y + 21) > 0.8 ? 15 : 0;
        const shade = 0.78 + variation * 0.24;

        image.data[index] = Math.floor(58 * shade);
        image.data[index + 1] = Math.floor(135 * shade + highlight);
        image.data[index + 2] = Math.floor(54 * shade);
        image.data[index + 3] = dense ? 255 : 0;
      }
    }

    context.putImageData(image, 0, 0);
    return canvas;
  }

  private static createPlanksCanvas(): HTMLCanvasElement {
    const canvas = this.createCanvas();
    const context = this.getContext(canvas);
    const image = context.createImageData(this.size, this.size);
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const index = (y * this.size + x) * 4;
        const line = (y % 4 === 0 || (x % 3 === 0 && y % 5 === 0)) ? -25 : 0;
        const variation = this.random2D(x, y);
        const shade = 0.85 + variation * 0.15;
        image.data[index] = Math.max(0, Math.floor(166 * shade + line));
        image.data[index + 1] = Math.max(0, Math.floor(125 * shade + line));
        image.data[index + 2] = Math.max(0, Math.floor(61 * shade + line));
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  private static createBrickCanvas(): HTMLCanvasElement {
    const canvas = this.createCanvas();
    const context = this.getContext(canvas);
    const image = context.createImageData(this.size, this.size);
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const index = (y * this.size + x) * 4;
        const isMortarY = y % 3 === 0;
        const offsetX = Math.floor(y / 3) % 2 === 0 ? 0 : 3;
        const isMortarX = (x + offsetX) % 6 === 0;
        if (isMortarY || isMortarX) {
            image.data[index] = 200; image.data[index + 1] = 200; image.data[index + 2] = 200;
        } else {
            const variation = this.random2D(x, y);
            const shade = 0.8 + variation * 0.2;
            image.data[index] = Math.floor(180 * shade);
            image.data[index + 1] = Math.floor(60 * shade);
            image.data[index + 2] = Math.floor(40 * shade);
        }
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  private static createIronCanvas(): HTMLCanvasElement {
    const canvas = this.createCanvas();
    const context = this.getContext(canvas);
    const image = context.createImageData(this.size, this.size);
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const index = (y * this.size + x) * 4;
        const border = (x === 0 || y === 0 || x === this.size - 1 || y === this.size - 1) ? 40 : 0;
        const variation = this.random2D(x, y);
        const shade = 0.9 + variation * 0.1;
        image.data[index] = Math.min(255, Math.floor(160 * shade + border));
        image.data[index + 1] = Math.min(255, Math.floor(160 * shade + border));
        image.data[index + 2] = Math.min(255, Math.floor(170 * shade + border));
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  private static createWoolBlueCanvas(): HTMLCanvasElement {
    const canvas = this.createCanvas();
    const context = this.getContext(canvas);
    const image = context.createImageData(this.size, this.size);
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const index = (y * this.size + x) * 4;
        const variation = this.random2D(y, x);
        const shade = 0.8 + variation * 0.2;
        image.data[index] = Math.floor(30 * shade);
        image.data[index + 1] = Math.floor(100 * shade);
        image.data[index + 2] = Math.floor(200 * shade);
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  private static createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = this.size;
    canvas.height = this.size;
    return canvas;
  }

  private static getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Nao foi possivel criar contexto 2D para texturas procedurais.");
    }
    return context;
  }

  private static random2D(x: number, y: number): number {
    const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return value - Math.floor(value);
  }
}
