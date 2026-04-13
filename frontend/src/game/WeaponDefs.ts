export type SightType = "iron" | "red_dot" | "scope";

export type WeaponDef = {
  id: string;
  name: string;
  /** Segundos entre tiros (controla cadência) */
  fireCooldown: number;
  /** Capacidade do pente */
  maxAmmo: number;
  /** Segundos para recarregar */
  reloadTime: number;
  /** Probabilidade de engalhamento por tiro (0–1) */
  jamChance: number;
  /** Segundos para destravar engalhamento */
  jamClearTime: number;
  bulletSpeed: number;
  recoilAmount: number;
  isAuto: boolean;
  sightType: SightType;
  /** Abertura em radianos (spread cone) */
  spreadAngle: number;
  /** Projéteis por tiro (shotgun > 1) */
  pellets: number;
  /** FOV ao mirar */
  fovAim: number;
  /** Dano base do tiro (no corpo) */
  baseDamage: number;
};

export const WEAPONS: Record<string, WeaponDef> = {
  /* ── PISTOLAS ─────────────────────────────────────────── */
  escopeta: {
    id: "escopeta",
    name: "Escopeta de Cano Duro",
    fireCooldown: 0.8,
    maxAmmo: 1,
    reloadTime: 1.2,
    jamChance: 0.05,
    jamClearTime: 1.5,
    bulletSpeed: 50,
    recoilAmount: 1.0,
    isAuto: false,
    sightType: "iron",
    spreadAngle: 0.12,
    pellets: 10,
    fovAim: 70,
    baseDamage: 18,
  },
  m9: {
    id: "m9",         name: "M9 Beretta",
    fireCooldown: 0.14, maxAmmo: 15, reloadTime: 1.8,
    jamChance: 0.002,   jamClearTime: 1.5,
    bulletSpeed: 200,   recoilAmount: 0.45, isAuto: false,
    sightType: "iron",  spreadAngle: 0.012, pellets: 1, fovAim: 55, baseDamage: 25,
  },
  glock17: {
    id: "glock17",    name: "Glock 17",
    fireCooldown: 0.11, maxAmmo: 17, reloadTime: 1.6,
    jamChance: 0.001,   jamClearTime: 1.2,
    bulletSpeed: 210,   recoilAmount: 0.35, isAuto: false,
    sightType: "iron",  spreadAngle: 0.010, pellets: 1, fovAim: 55, baseDamage: 22,
  },
  deagle: {
    id: "deagle",     name: "Desert Eagle",
    fireCooldown: 0.28, maxAmmo: 7,  reloadTime: 2.3,
    jamChance: 0.005,   jamClearTime: 2.2,
    bulletSpeed: 235,   recoilAmount: 0.95, isAuto: false,
    sightType: "iron",  spreadAngle: 0.016, pellets: 1, fovAim: 53, baseDamage: 60,
  },

  /* ── RIFLES DE ASSALTO ────────────────────────────────── */
  ak47: {
    id: "ak47",       name: "AK-47",
    fireCooldown: 0.10, maxAmmo: 30, reloadTime: 2.8,
    jamChance: 0.0015,  jamClearTime: 2.5,
    bulletSpeed: 240,   recoilAmount: 0.72, isAuto: true,
    sightType: "iron",  spreadAngle: 0.022, pellets: 1, fovAim: 52, baseDamage: 40,
  },
  m4a1: {
    id: "m4a1",       name: "M4A1",
    fireCooldown: 0.09, maxAmmo: 30, reloadTime: 2.4,
    jamChance: 0.0012,  jamClearTime: 2.0,
    bulletSpeed: 250,   recoilAmount: 0.58, isAuto: true,
    sightType: "red_dot", spreadAngle: 0.016, pellets: 1, fovAim: 52, baseDamage: 38,
  },

  /* ── SUBMETRALHADORAS ─────────────────────────────────── */
  mp5: {
    id: "mp5",        name: "MP5",
    fireCooldown: 0.08, maxAmmo: 30, reloadTime: 2.2,
    jamChance: 0.001,   jamClearTime: 1.8,
    bulletSpeed: 195,   recoilAmount: 0.35, isAuto: true,
    sightType: "iron",  spreadAngle: 0.022, pellets: 1, fovAim: 55, baseDamage: 28,
  },
  uzi: {
    id: "uzi",        name: "UZI",
    fireCooldown: 0.07, maxAmmo: 32, reloadTime: 2.0,
    jamChance: 0.003,   jamClearTime: 1.5,
    bulletSpeed: 185,   recoilAmount: 0.40, isAuto: true,
    sightType: "iron",  spreadAngle: 0.032, pellets: 1, fovAim: 55, baseDamage: 24,
  },

  /* ── ESPINGARDA ───────────────────────────────────────── */
  spas12: {
    id: "spas12",     name: "SPAS-12",
    fireCooldown: 0.50, maxAmmo: 8,  reloadTime: 3.6,
    jamChance: 0.004,   jamClearTime: 2.8,
    bulletSpeed: 175,   recoilAmount: 1.0,  isAuto: false,
    sightType: "iron",  spreadAngle: 0.085, pellets: 8, fovAim: 58, baseDamage: 18,
  },

  /* ── SNIPER ───────────────────────────────────────────── */
  awp: {
    id: "awp",        name: "AWP Sniper",
    fireCooldown: 0.68, maxAmmo: 5,  reloadTime: 3.8,
    jamChance: 0.001,   jamClearTime: 2.0,
    bulletSpeed: 360,   recoilAmount: 1.0,  isAuto: false,
    sightType: "scope", spreadAngle: 0.003, pellets: 1, fovAim: 18, baseDamage: 120,
  },

  /* ── FUZIL SEMI-AUTO ──────────────────────────────────── */
  m1garand: {
    id: "m1garand",   name: "M1 Garand",
    fireCooldown: 0.18, maxAmmo: 8,  reloadTime: 3.2,
    jamChance: 0.002,   jamClearTime: 2.0,
    bulletSpeed: 265,   recoilAmount: 0.78, isAuto: false,
    sightType: "iron",  spreadAngle: 0.008, pellets: 1, fovAim: 52, baseDamage: 50,
  },
};

export const ALL_WEAPON_IDS = Object.keys(WEAPONS);
