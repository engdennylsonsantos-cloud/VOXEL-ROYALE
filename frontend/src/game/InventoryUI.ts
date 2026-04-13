type InventoryItem = {
  id: string;
  label: string;
  count: number;
};

type SlotLocation = {
  area:  "hotbar" | "backpack";
  index: number;
};

// ── Ícones desenhados em canvas 24×24 ──────────────────────────────────────
const iconCache = new Map<string, string>();

function getIconDataURL(itemId: string): string {
  if (iconCache.has(itemId)) return iconCache.get(itemId)!;

  const c   = document.createElement("canvas");
  c.width   = 24;
  c.height  = 24;
  const ctx = c.getContext("2d")!;

  ctx.clearRect(0, 0, 24, 24);

  switch (itemId) {
    // ── Blocos ────────────────────────────────────────────────────────────
    case "grass_block": {
      ctx.fillStyle = "#8b5e3c"; ctx.fillRect(2,10,20,12);
      ctx.fillStyle = "#58a032"; ctx.fillRect(2, 4,20, 7);
      ctx.fillStyle = "#3d7a22"; ctx.fillRect(2, 2,20, 3);
      break;
    }
    case "dirt_block": {
      ctx.fillStyle = "#8b5e3c"; ctx.fillRect(2,2,20,20);
      ctx.fillStyle = "#a06840"; ctx.fillRect(4,4,4,4); ctx.fillRect(14,10,4,4);
      break;
    }
    case "stone_block": {
      ctx.fillStyle = "#7a7a7a"; ctx.fillRect(2,2,20,20);
      ctx.fillStyle = "#909090"; ctx.fillRect(4,4,6,6); ctx.fillRect(14,13,5,5);
      ctx.fillStyle = "#606060"; ctx.fillRect(2,12,2,2); ctx.fillRect(18,4,2,2);
      break;
    }
    case "wood_log": {
      ctx.fillStyle = "#7a5c3a"; ctx.fillRect(2,2,20,20);
      ctx.fillStyle = "#6a4c2a"; ctx.fillRect(2,2,3,20); ctx.fillRect(6,2,3,20);
      ctx.fillStyle = "#a0783a"; ctx.fillRect(9,2,2,20);
      break;
    }
    case "leaf_block": {
      ctx.fillStyle = "#2a6a18"; ctx.fillRect(2,2,20,20);
      ctx.fillStyle = "#3a8020"; ctx.fillRect(4,4,5,5); ctx.fillRect(13,4,5,5);
      ctx.fillStyle = "#1a5010"; ctx.fillRect(4,13,5,5); ctx.fillRect(13,13,5,5);
      break;
    }
    case "planks": {
      ctx.fillStyle = "#a67d3d"; ctx.fillRect(2,2,20,20);
      ctx.fillStyle = "#8b5e3c"; ctx.fillRect(2,2,20,2); ctx.fillRect(2,8,20,2); ctx.fillRect(2,14,20,2); ctx.fillRect(2,20,20,2);
      break;
    }
    case "brick": {
      ctx.fillStyle = "#b43c28"; ctx.fillRect(2,2,20,20);
      ctx.fillStyle = "#d0d0d0"; ctx.fillRect(2,8,20,1); ctx.fillRect(2,15,20,1);
      ctx.fillRect(10,2,1,6); ctx.fillRect(5,9,1,6); ctx.fillRect(15,9,1,6); ctx.fillRect(10,16,1,6);
      break;
    }
    case "iron": {
      ctx.fillStyle = "#a0a0a0"; ctx.fillRect(2,2,20,20);
      ctx.fillStyle = "#c0c0c0"; ctx.fillRect(4,4,4,4);
      ctx.fillStyle = "#808080"; ctx.fillRect(16,16,4,4);
      break;
    }
    case "wool_blue": {
      ctx.fillStyle = "#1e64c8"; ctx.fillRect(2,2,20,20);
      ctx.fillStyle = "#2a80f0"; ctx.fillRect(4,4,3,3); ctx.fillRect(15,12,4,4);
      break;
    }

    // ── Picareta ─────────────────────────────────────────────────────────
    case "pickaxe": {
      ctx.strokeStyle = "#7a5c3a"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(18,6); ctx.lineTo(6,18); ctx.stroke();
      ctx.fillStyle = "#555555";
      ctx.beginPath(); ctx.moveTo(14,2); ctx.lineTo(22,10); ctx.lineTo(18,6); ctx.lineTo(14,2); ctx.fill();
      ctx.fillStyle = "#888888";
      ctx.beginPath(); ctx.moveTo(16,4); ctx.lineTo(22,10); ctx.lineTo(20,10); ctx.lineTo(14,4); ctx.fill();
      break;
    }

    // ── Armas (ícones simplificados) ─────────────────────────────────────
    case "m9":
    case "glock17": {
      ctx.fillStyle = "#222222";
      ctx.fillRect(4,10,12,6);
      ctx.fillRect(14,8,5,4);
      ctx.fillRect(4,15,4,6);
      break;
    }
    case "deagle": {
      ctx.fillStyle = "#333322";
      ctx.fillRect(3,9,14,8);
      ctx.fillRect(15,6,6,5);
      ctx.fillRect(3,16,5,6);
      break;
    }
    case "ak47": {
      ctx.fillStyle = "#1a1a10";
      ctx.fillRect(2,10,18,5);
      ctx.fillRect(18,8,4,3);
      ctx.fillStyle = "#7a5c3a";
      ctx.fillRect(2,14,5,4);
      ctx.fillStyle = "#1a1a10";
      ctx.fillRect(8,14,4,6);
      break;
    }
    case "m4a1": {
      ctx.fillStyle = "#1e2228";
      ctx.fillRect(2,10,18,5);
      ctx.fillRect(18,8,4,3);
      ctx.fillRect(2,14,5,3);
      ctx.fillRect(8,14,4,6);
      ctx.fillStyle = "#cc2200";
      ctx.fillRect(9,8,4,3);
      break;
    }
    case "mp5":
    case "uzi": {
      ctx.fillStyle = "#222222";
      ctx.fillRect(2,10,16,5);
      ctx.fillRect(16,8,6,3);
      ctx.fillRect(2,14,4,5);
      ctx.fillRect(7,14,4,6);
      break;
    }
    case "escopeta":
    case "spas12": {
      ctx.fillStyle = "#2a2010";
      ctx.fillRect(2,8,18,8);
      ctx.fillRect(18,6,4,5);
      ctx.fillRect(2,15,5,5);
      ctx.fillStyle = "#444";
      ctx.fillRect(2,14,18,2);
      break;
    }
    case "awp": {
      ctx.fillStyle = "#1a2a2a";
      ctx.fillRect(2,10,20,5);
      ctx.fillRect(20,8,2,3);
      ctx.fillStyle = "#333";
      ctx.fillRect(6,7,8,4);
      ctx.fillStyle = "#7a5c3a";
      ctx.fillRect(2,14,6,4);
      break;
    }
    case "m1garand": {
      ctx.fillStyle = "#7a5c3a";
      ctx.fillRect(2,11,16,7);
      ctx.fillStyle = "#444";
      ctx.fillRect(4,9,14,4);
      ctx.fillRect(16,7,6,3);
      break;
    }

    default: {
      ctx.fillStyle = "#888"; ctx.fillRect(4,4,16,16);
      ctx.fillStyle = "#aaa"; ctx.fillRect(6,6,5,5); ctx.fillRect(13,13,5,5);
    }
  }

  const url = c.toDataURL();
  iconCache.set(itemId, url);
  return url;
}

// ── Classe principal ──────────────────────────────────────────────────────
export class InventoryUI {
  readonly hotbar:  (InventoryItem | null)[] = new Array(9).fill(null);
  readonly backpack:(InventoryItem | null)[] = new Array(20).fill(null);

  private readonly hotbarElement     = document.createElement("div");
  private readonly inventoryElement  = document.createElement("div");
  private readonly backpackGrid      = document.createElement("div");
  private readonly inventoryHotbar   = document.createElement("div");
  private selectedHotbarIndex = 0;
  private isOpen      = false;

  // ── Estado do drag ────────────────────────────────────────────────────
  private dragSource: SlotLocation | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly onHotbarChange: (item: InventoryItem | null, index: number) => void
  ) {
    this.hotbar[0] = { id: "pickaxe", label: "Picareta",   count: 1 };
    this.hotbar[1] = { id: "m9",      label: "M9 Beretta", count: 1 };
    this.hotbar[2] = { id: "escopeta", label: "Escopeta de Cano Duro", count: 1 };

    this.hotbarElement.className    = "hotbar";
    this.inventoryElement.className = "inventory hidden";
    this.backpackGrid.className     = "inventory-grid";
    this.inventoryHotbar.className  = "inventory-hotbar";

    const title = document.createElement("div");
    title.className   = "inventory-title";
    title.textContent = "Mochila";

    this.inventoryElement.append(title, this.backpackGrid, this.inventoryHotbar);
    this.root.append(this.hotbarElement, this.inventoryElement);

    this.render();
    this.onHotbarChange(this.hotbar[this.selectedHotbarIndex], this.selectedHotbarIndex);
  }

  toggle(): boolean {
    this.isOpen = !this.isOpen;
    this.dragSource = null;
    this.render();
    return this.isOpen;
  }

  selectHotbar(index: number): void {
    this.selectedHotbarIndex = index;
    this.onHotbarChange(this.hotbar[index], index);
    this.render();
  }

  addItem(item: { id: string; label: string }): boolean {
    // 1) empilha na mochila
    for (let i = 0; i < this.backpack.length; i++) {
      if (this.backpack[i]?.id === item.id) {
        this.backpack[i]!.count += 1;
        this.render(); return true;
      }
    }
    // 2) empilha na hotbar (1 a 9)
    for (let i = 0; i < this.hotbar.length; i++) {
      if (this.hotbar[i]?.id === item.id) {
        this.hotbar[i]!.count += 1;
        this.render(); return true;
      }
    }
    // 3) novo slot hotbar (preferência por preencher barra primeiro)
    for (let i = 0; i < this.hotbar.length; i++) {
      if (!this.hotbar[i]) {
        this.hotbar[i] = { ...item, count: 1 };
        this.render(); return true;
      }
    }
    // 4) novo slot mochila se hotbar cheia
    for (let i = 0; i < this.backpack.length; i++) {
      if (!this.backpack[i]) {
        this.backpack[i] = { ...item, count: 1 };
        this.render(); return true;
      }
    }
    return false;
  }

  getSelectedItem(): InventoryItem | null {
    return this.hotbar[this.selectedHotbarIndex];
  }

  decrementSelectedItem(): void {
    const item = this.hotbar[this.selectedHotbarIndex];
    if (!item) return;
    item.count -= 1;
    if (item.count <= 0) {
      this.hotbar[this.selectedHotbarIndex] = null;
    }
    this.onHotbarChange(this.hotbar[this.selectedHotbarIndex], this.selectedHotbarIndex);
    this.render();
  }

  // ── Renderização ────────────────────────────────────────────────────────
  private render(): void {
    this.hotbarElement.replaceChildren(
      ...this.hotbar.map((item, i) =>
        this.createSlot({ area: "hotbar", index: i }, item, i === this.selectedHotbarIndex, false))
    );
    this.backpackGrid.replaceChildren(
      ...this.backpack.map((item, i) =>
        this.createSlot({ area: "backpack", index: i }, item, false, true))
    );
    this.inventoryHotbar.replaceChildren(
      ...this.hotbar.map((item, i) =>
        this.createSlot({ area: "hotbar", index: i }, item, i === this.selectedHotbarIndex, true))
    );
    this.inventoryElement.classList.toggle("hidden", !this.isOpen);
  }

  private createSlot(
    location:    SlotLocation,
    item:        InventoryItem | null,
    selected:    boolean,
    interactive: boolean
  ): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "slot";
    btn.type      = "button";
    btn.dataset.selected = selected ? "true" : "false";

    // Verifica se é a fonte do drag atual
    const isDragSrc =
      this.dragSource?.area === location.area &&
      this.dragSource?.index === location.index;
    if (isDragSrc) btn.dataset.dragging = "true";

    // ── Número do slot ─────────────────────────────────────────────────
    if (location.area === "hotbar") {
      const indexLbl = document.createElement("span");
      indexLbl.className   = "slot-index";
      indexLbl.textContent = String(location.index + 1);
      btn.append(indexLbl);
    }

    // ── Ícone + label ─────────────────────────────────────────────────
    if (item) {
      const img = document.createElement("img");
      img.src    = getIconDataURL(item.id);
      img.width  = 24;
      img.height = 24;
      img.style.imageRendering = "pixelated";
      img.className = "slot-icon";
      img.draggable = false; // evita drag no img, só no container
      btn.append(img);
    }

    const itemLbl = document.createElement("span");
    itemLbl.className   = "slot-label";
    itemLbl.textContent = item?.label ?? "";
    btn.append(itemLbl);

    if (item && item.count > 1) {
      const countLbl = document.createElement("span");
      countLbl.className   = "slot-count";
      countLbl.textContent = String(item.count);
      btn.append(countLbl);
    }

    // ── Clique simples na hotbar (fora do inventário) ─────────────────
    if (!interactive && location.area === "hotbar") {
      btn.addEventListener("click", () => this.selectHotbar(location.index));
    }

    // ── Drag & Drop (só no inventário aberto) ────────────────────────
    if (interactive) {
      // Origem: pode arrastar qualquer slot com item
      if (item) {
        btn.draggable = true;

        btn.addEventListener("dragstart", (e) => {
          this.dragSource = location;
          e.dataTransfer!.effectAllowed = "move";
          e.dataTransfer!.setData("text/plain", JSON.stringify(location));
          // Pequeno delay para o estilo aparecer após o snapshot do navegador
          setTimeout(() => btn.setAttribute("data-dragging", "true"), 0);
        });

        btn.addEventListener("dragend", () => {
          this.dragSource = null;
          this.render();
        });
      }

      // Destino: todo slot pode receber
      btn.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer!.dropEffect = "move";
        btn.setAttribute("data-dragover", "true");
      });

      btn.addEventListener("dragleave", () => {
        btn.removeAttribute("data-dragover");
      });

      btn.addEventListener("drop", (e) => {
        e.preventDefault();
        btn.removeAttribute("data-dragover");
        const raw = e.dataTransfer!.getData("text/plain");
        if (!raw) return;
        const source = JSON.parse(raw) as SlotLocation;
        this.performSwap(source, location);
      });

      // Clique como fallback (seleciona hotbar dentro do inventário)
      btn.addEventListener("click", () => {
        if (location.area === "hotbar") this.selectHotbar(location.index);
      });
    }

    return btn;
  }

  // ── Troca dois slots ────────────────────────────────────────────────────
  private performSwap(source: SlotLocation, target: SlotLocation): void {
    if (source.area === target.area && source.index === target.index) return;

    const srcSlots = source.area === "hotbar" ? this.hotbar : this.backpack;
    const tgtSlots = target.area === "hotbar" ? this.hotbar : this.backpack;

    const srcItem = srcSlots[source.index];
    const tgtItem = tgtSlots[target.index];

    // Empilha se mesmo item
    if (srcItem && tgtItem && srcItem.id === tgtItem.id) {
      tgtItem.count += srcItem.count;
      srcSlots[source.index] = null;
    } else {
      // Troca normal (incluindo slots 0 e 1 da hotbar — livre para reorganizar)
      srcSlots[source.index] = tgtItem;
      tgtSlots[target.index] = srcItem;
    }

    this.dragSource = null;
    this.onHotbarChange(this.hotbar[this.selectedHotbarIndex], this.selectedHotbarIndex);
    this.render();
  }
}
