import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { InputController } from "../core/InputController";
import { MultiplayerClient, type LobbyStatus } from "../network/MultiplayerClient";
import { CombatEffects } from "./CombatEffects";
import { FirstPersonViewModel } from "./FirstPersonViewModel";
import { InventoryUI } from "./InventoryUI";
import { ItemDropSystem } from "./ItemDropSystem";
import { MinimapUI } from "./MinimapUI";
import { UnderwaterEffect } from "./UnderwaterEffect";
import { VoxelTerrain } from "./VoxelTerrain";
import type { BreakResult } from "./VoxelTerrain";
import { AirdropSystem } from "./AirdropSystem";
import { MobSystem } from "./MobSystem";
import { StormSystem } from "./StormSystem";
import { WEAPONS, ALL_WEAPON_IDS } from "./WeaponDefs";
import type { WeaponDef } from "./WeaponDefs";
import { TouchControls } from "../ui/TouchControls";

// ── Flags de debug (desabilitar para testes) ──────────────────────────────
const DEBUG_DISABLE_MOBS  = false;  // false = zumbis ativos
const DEBUG_DISABLE_STORM = false;  // false = tempestade ativa
const DEBUG_SKIP_INTRO    = false;  // false = intro do avião ativa

// ── Física do jogador ──────────────────────────────────────────────────────
const WALK_SPEED    = 4.3;   // m/s – velocidade próxima ao Minecraft
const SPRINT_SPEED  = 6.0;
const JUMP_FORCE    = 7.5;
const CLIMB_STEP    = 6.8;   // velocidade vertical por press de Space ao escalar tronco
const GROUND_DRAG   = 14;
const AIR_DRAG      = 2.5;
const GRAVITY       = 22;
const WATER_DRAG    = 6.0;   // drag extra ao nadar
const WATER_GRAVITY = 5.0;   // gravidade suave na água
const SWIM_SPEED    = 3.2;
const PLAYER_HEIGHT = 1.8;   // altura total do player em blocos
const PLAYER_OFFSET = PLAYER_HEIGHT; // distância dos pés à câmera
const PLAYER_RADIUS = 0.35;  // raio de colisão horizontal
const CLIMB_REACH   = PLAYER_RADIUS + 0.55; // distância extra para detectar tronco escalável
const STEP_HEIGHT   = 1.1;

// ── Combate ────────────────────────────────────────────────────────────────
const BREAK_INTERVAL = 0.28; // segundos entre golpes de picareta

// ── Intro ──────────────────────────────────────────────────────────────────
const PLANE_ALTITUDE      = 300;
const PLANE_SPEED         = 72;
const SKYDIVE_GRAVITY     = 30;
const SKYDIVE_MAX_FALL    = 58;
const SKYDIVE_STEER       = 20;
const CHUTE_FALL_SPEED    = 6;
const CHUTE_STEER         = 13;
const CHUTE_DEPLOY_HEIGHT = 45;

// ── Armas no mundo: pontos predefinidos ───────────────────────────────────
// Geradas a partir de hash deterministico
function generateWorldWeaponSpawns(): { x: number; z: number; weaponId: string }[] {
  const spawns: { x: number; z: number; weaponId: string }[] = [];
  const rng = (seed: number) => {
    const s = Math.sin(seed * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let i = 0; i < 30; i++) {
    const angle  = rng(i * 3.14)  * Math.PI * 2;
    const dist   = 20 + rng(i * 7.22) * 80;
    const x      = Math.cos(angle) * dist;
    const z      = Math.sin(angle) * dist;
    const wIdx   = Math.floor(rng(i * 11.7) * ALL_WEAPON_IDS.length);
    spawns.push({ x, z, weaponId: ALL_WEAPON_IDS[wIdx] });
  }
  return spawns;
}

type GamePhase = "plane" | "skydiving" | "parachute" | "playing";

type GameAppOptions = {
  onLobbyStatusChange?: (status: LobbyStatus) => void;
  multiplayerClient?: MultiplayerClient;
};

export class GameApp {
  private readonly scene    = new THREE.Scene();
  private readonly camera   = new THREE.PerspectiveCamera(75, 1, 0.1, 2000);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: false });
  private readonly clock    = new THREE.Clock();
  private readonly input    = new InputController();

  private readonly shell        = document.createElement("div");
  private readonly hud          = document.createElement("div");
  private readonly instructions = document.createElement("div");
  private readonly crosshair    = document.createElement("div");
  private readonly introHUD     = document.createElement("div");
  private readonly lobbyHUD     = document.createElement("div");
  private readonly ammoHUD      = document.createElement("div");
  private readonly reloadHUD    = document.createElement("div");

  private readonly controls: PointerLockControls;
  private readonly terrain:   VoxelTerrain;
  private readonly multiplayer: MultiplayerClient;
  private readonly viewModel  = new FirstPersonViewModel();
  private readonly combatEffects: CombatEffects;
  private readonly inventory:  InventoryUI;
  private readonly minimap:    MinimapUI;
  private readonly itemDrops:     ItemDropSystem;
  private readonly underwater:    UnderwaterEffect;
  private readonly airdropSystem: AirdropSystem;
  private readonly mobSystem: MobSystem;
  private readonly stormSystem: StormSystem;

  // ── Vetores reutilizáveis ─────────────────────────────────────────────
  private readonly playerPosition   = new THREE.Vector3();
  private readonly playerVelocity   = new THREE.Vector3();
  private readonly cameraDirection  = new THREE.Vector3();
  private readonly forwardDirection = new THREE.Vector3();
  private readonly rightDirection   = new THREE.Vector3();
  private readonly moveDirection    = new THREE.Vector3();
  private readonly upAxis           = new THREE.Vector3(0, 1, 0);
  private readonly nextPosition     = new THREE.Vector3();
  private readonly raycaster        = new THREE.Raycaster();
  private readonly muzzleWorldPos   = new THREE.Vector3();
  private readonly shotDir          = new THREE.Vector3();
  private readonly impactNormal     = new THREE.Vector3();
  private readonly camWorldPos      = new THREE.Vector3();
  private readonly blockCenterVec   = new THREE.Vector3();
  private readonly yawDirection     = new THREE.Vector3();
  private readonly pitchEuler       = new THREE.Euler(0, 0, 0, "YXZ");

  // ── Estado do jogador ────────────────────────────────────────────────
  private isGrounded   = false;
  private isLocked     = false;
  private isAiming     = false;
  private isSprinting  = false;
  private isUnderwater = false;
  private fireCooldown  = 0;
  private isMouseDown   = false;
  private breakCooldown = 0;
  private playerHP      = 100;
  private playerLives   = 3;   // vidas restantes (max 3 mortes)
  private playerDeaths  = 0;   // mortes acumuladas
  private isGameOver    = false;
  private rescueTimer   = 60;
  private minimapTimer  = 0;
  private readonly livesHUD = document.createElement("div");
  
  private readonly damageOverlay = document.createElement("div");
  private readonly stormOverlay  = document.createElement("div");
  private readonly playerInfoHUD = document.createElement("div");
  private readonly stormPhaseHUD = document.createElement("div");
  private readonly statsHUD      = document.createElement("div");
  private readonly interactHUD   = document.createElement("div");
  private readonly healthHUD     = document.createElement("div");
  private readonly rescueHUD     = document.createElement("div");
  private readonly dmgIndicator  = document.createElement("canvas"); // indicador direcional de dano
  private readonly scoreboardHUD = document.createElement("div");    // Tab = lista de jogadores
  private scoreboardVisible      = false;
  private nearbyDrop: { index: number; itemId: string; itemLabel: string } | null = null;
  private totalKills     = 0;

  // ── Mobile / Touch ────────────────────────────────────────────────────
  private readonly isMobile  = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  private touchControls?: TouchControls;
  private _touchYaw   = 0;
  private _touchPitch = 0;
  private readonly _touchEuler = new THREE.Euler(0, 0, 0, "YXZ");
  private headshotKills  = 0;
  private activeDamageIndicator: { x: number; z: number; life: number } | null = null;

  // ── Crack overlay ────────────────────────────────────────────────────
  private crackMesh:     THREE.Mesh | null = null;
  private crackKey       = "";
  private crackHits      = 0;
  private crackRequired  = 0;
  private readonly crackMaterials: THREE.MeshBasicMaterial[];

  // ── Sistema de armas ─────────────────────────────────────────────────
  private currentWeapon: WeaponDef | null = WEAPONS["m9"];
  private currentAmmo   = WEAPONS["m9"].maxAmmo;
  private isReloading   = false;
  private reloadTimer   = 0;
  private isJammed      = false;
  private jamTimer      = 0;

  // ── Spawns de armas no mundo ─────────────────────────────────────────
  private readonly worldWeaponSpawns = generateWorldWeaponSpawns();
  private readonly spawnedWeapons    = new Set<number>();

  // ── Airdrops ──────────────────────────────────────────────────────────
  private airdropTimer = 90;   // segundos até o próximo drop automático

  // ── Intro ─────────────────────────────────────────────────────────────
  private gamePhase: GamePhase | "gameover" | "victory" = "plane";
  private readonly introPos  = new THREE.Vector3(-520, PLANE_ALTITUDE, 0);
  private readonly introVel  = new THREE.Vector3(PLANE_SPEED, 0, 0);
  private parachuteActive    = false;
  private planeMeshGroup!: THREE.Group;
  private readonly planePos  = new THREE.Vector3(-520, PLANE_ALTITUDE, 0);
  private lobbyStatus: LobbyStatus = {
    connected: false,
    phase: "waiting",
    playerCount: 0,
    countdownSeconds: 0,
    playerNames: []
  };
  private matchReady = false;

  constructor(
    private readonly container: HTMLDivElement,
    private readonly options: GameAppOptions = {}
  ) {
    // ── HUD base ─────────────────────────────────────────────────────────
    this.shell.className        = "game-shell";
    this.hud.className          = "hud";
    this.instructions.className = "instructions";
    // Em mobile não mostra o aviso de pointer lock (não existe pointer lock em touch)
    if (!this.isMobile) {
      this.instructions.innerHTML =
        "<strong>Clique para capturar o mouse</strong>" +
        "<span>WASD move · ESPAÇO pula · LMB atira/quebra · RMB mira · R recarrega</span>";
    } else {
      this.instructions.classList.add("hidden");
    }
    this.crosshair.className = "crosshair";
    this.hud.append(this.crosshair, this.instructions);

    // ── HUD avião ─────────────────────────────────────────────────────────
    this.introHUD.className = "intro-hud";
    this.introHUD.innerHTML =
      `<span class='intro-label'>${this.isMobile ? "Toque ↑ para saltar do avião" : "ESPAÇO para saltar do avião"}</span>` +
      "<span class='intro-alt'></span>";
    this.hud.append(this.introHUD);
    this.lobbyHUD.className = "match-lobby";
    this.hud.append(this.lobbyHUD);

    // ── HUD de munição ────────────────────────────────────────────────────
    this.ammoHUD.className = "ammo-hud";
    this.ammoHUD.style.cssText = "position:absolute;bottom:72px;right:18px;font-size:22px;font-weight:bold;color:#fff;text-shadow:0 1px 3px #000;pointer-events:none;";
    this.hud.append(this.ammoHUD);

    // ── HUD de recarga ────────────────────────────────────────────────────
    this.reloadHUD.className = "reload-hud";
    this.reloadHUD.style.cssText = "position:absolute;top:50%;left:50%;transform:translate(-50%,40px);font-size:16px;color:#ffdd00;font-weight:bold;text-shadow:0 1px 3px #000;pointer-events:none;display:none;";
    this.reloadHUD.textContent = "🔄 RECARREGANDO...";
    this.hud.append(this.reloadHUD);

    // ── Painel Superior Direito (Informações do Jogador) ──────────────────
    this.playerInfoHUD.className = "player-info-hud";
    this.playerInfoHUD.style.cssText = "position:absolute;top:20px;right:20px;display:flex;flex-direction:column;gap:10px;align-items:flex-end;pointer-events:none;user-select:none;background:rgba(0,0,0,0.4);padding:12px;border-radius:10px;box-shadow:0 4px 6px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);";
    this.hud.append(this.playerInfoHUD);

    // ── Fase da Tempestade ────────────────────────────────────────────────
    this.stormPhaseHUD.className = "storm-phase-hud";
    this.stormPhaseHUD.style.cssText = "font-size:18px;font-weight:bold;color:#bf7fff;text-shadow:0 2px 4px #000;";
    this.playerInfoHUD.append(this.stormPhaseHUD); 

    // ── Estatísticas (Kills) ────────────────────────────────────────────────
    this.statsHUD.className = "stats-hud";
    this.statsHUD.style.cssText = "font-size:16px;color:#ddd;margin-bottom:5px;font-weight:bold;";
    this.statsHUD.textContent = "Abates: 0 (0 Headshots)";
    this.playerInfoHUD.append(this.statsHUD);

    // ── Vida em Corações ──────────────────────────────────────────────────
    this.healthHUD.className  = "health-hud";
    this.livesHUD.className   = "lives-hud";
    this.rescueHUD.className  = "rescue-hud";
    this.dmgIndicator.className = "damage-indicator";
    this.dmgIndicator.width = 500;
    this.dmgIndicator.height = 500;

    // ── Scoreboard (Tab) ──────────────────────────────────────────────────
    this.scoreboardHUD.className = "scoreboard-hud";
    this.scoreboardHUD.style.display = "none";
    this.shell.appendChild(this.scoreboardHUD);

    this.hud.appendChild(this.crosshair);
    this.shell.appendChild(this.hud);
    this.shell.appendChild(this.dmgIndicator);
    this.container.appendChild(this.shell);

    this.healthHUD.style.cssText = "font-size:24px;display:flex;gap:4px;text-shadow:0 2px 4px #000;";
    this.livesHUD.style.cssText  = "font-size:14px;color:#ffd700;text-shadow:0 1px 3px #000;margin-top:2px;letter-spacing:2px;";
    this.playerInfoHUD.append(this.healthHUD, this.livesHUD);

    // ── Interact HUD (para Drops de itens) ────────────────────────────────
    this.interactHUD.className = "interact-hud";
    this.interactHUD.style.cssText = "font-size:16px;background:rgba(0,0,0,0.6);padding:6px 12px;border-radius:6px;border:1px solid #777;display:none;color:white;";
    this.playerInfoHUD.append(this.interactHUD);

    // ── HUD de Resgate (Timer final) ──────────────────────────────────────
    this.rescueHUD.className = "rescue-hud";
    this.rescueHUD.style.cssText = "font-size:20px;font-weight:bold;color:#00ff55;text-shadow:0 2px 4px #000;display:none;";
    this.playerInfoHUD.append(this.rescueHUD);

    // ── Dano na tela ──────────────────────────────────────────────────────
    this.damageOverlay.className = "damage-overlay";
    this.damageOverlay.style.cssText = "position:absolute;inset:0;background:radial-gradient(circle, transparent 50%, red 120%);opacity:0;pointer-events:none;transition:opacity 0.2s;";
    this.hud.append(this.damageOverlay);

    // ── Tempestade na tela ────────────────────────────────────────────────
    this.stormOverlay.className = "storm-overlay";
    this.stormOverlay.style.cssText = "position:absolute;inset:0;background:radial-gradient(circle, transparent 30%, rgba(150,0,255,0.6) 120%);opacity:0;pointer-events:none;transition:opacity 0.2s;";
    this.hud.append(this.stormOverlay);

    // ── Materiais de crack ────────────────────────────────────────────────
    this.crackMaterials = [0.18, 0.34, 0.54, 0.78].map(opacity =>
      new THREE.MeshBasicMaterial({
        color: 0x110000, transparent: true, opacity,
        depthWrite: false, side: THREE.FrontSide
      })
    );

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFShadowMap;
    this.renderer.domElement.className = "game-canvas";

    this.container.append(this.shell);
    this.shell.append(this.renderer.domElement, this.hud);

    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.controls.pointerSpeed = 0.8;
    this.controls.object.rotation.y = -Math.PI / 2;

    this.terrain      = new VoxelTerrain();
    this.multiplayer  = this.options.multiplayerClient ?? new MultiplayerClient(this.scene);
    this.multiplayer.attachScene(this.scene);
    this.multiplayer.setTerrain(this.terrain);
    this.combatEffects = new CombatEffects(this.scene, this.camera);
    this.inventory    = new InventoryUI(this.hud, this.handleHotbarChange);
    this.minimap      = new MinimapUI(this.hud, this.terrain);
    this.itemDrops    = new ItemDropSystem(this.scene);
    this.underwater   = new UnderwaterEffect(this.camera, this.hud);
    this.airdropSystem = new AirdropSystem(this.scene, (x, z) => this.terrain.getSurfaceHeightAt(x, z));
    this.mobSystem    = new MobSystem(this.scene, this.terrain);
    this.stormSystem  = new StormSystem(this.scene, this.terrain.worldSize);

    // Callback: item retirado do caixote vai para o inventário
    this.airdropSystem.onPickupItem = (def) => {
      this.inventory.addItem({ id: def.id, label: def.name });
    };

    this.playerPosition.copy(this._findSafeSpawn());
    if (!DEBUG_DISABLE_MOBS) this.mobSystem.spawnDummiesNear(this.playerPosition);

    this.setupScene();
    if (DEBUG_SKIP_INTRO) {
      this.gamePhase = "playing";
      this.introHUD.classList.add("hidden");
      this.viewModel.root.visible = true;
      this.controls.object.position.copy(this.playerPosition);
    }
    // ── Touch controls (mobile) ───────────────────────────────────────────
    if (this.isMobile) {
      this.touchControls = new TouchControls(this.shell);
      // Em mobile não há pointer lock — considera sempre "locked" para o jogo funcionar
      this.isLocked = true;
      // Inicializa yaw/pitch da câmera com a rotação atual
      this._touchEuler.setFromQuaternion(this.camera.quaternion);
      this._touchYaw   = this._touchEuler.y;
      this._touchPitch = this._touchEuler.x;
    }

    this.setupEvents();
    // Se o cliente veio do matchmaking já em 'active', inicializa direto como pronto
    const initialStatus = this.multiplayer.getLobbyStatus();
    this.matchReady = initialStatus.phase === "active";
    this.lobbyStatus = initialStatus;
    this.multiplayer.onLobbyStatusChange((status) => {
      this.lobbyStatus = status;
      this.matchReady = status.phase === "active";
      this.options.onLobbyStatusChange?.(status);
      this.updateLobbyHUD();
    });
    if (!this.options.multiplayerClient) {
      void this.multiplayer.connect();
    }

    // Tiros remotos: mostra projétil + impacto para os outros players
    this.multiplayer.onRemoteShot((shot) => {
      const origin = new THREE.Vector3(shot.ox, shot.oy, shot.oz);
      const dir    = new THREE.Vector3(shot.dx, shot.dy, shot.dz);
      const impact = new THREE.Vector3(shot.ix, shot.iy, shot.iz);
      const normal = new THREE.Vector3(shot.nx, shot.ny, shot.nz);
      this.combatEffects.spawnProjectile(origin, dir, 120);
      if (shot.hit) this.combatEffects.spawnImpact(impact, normal);
    });

    // Dano PvP: quando outro player nos atinge
    this.multiplayer.onPlayerHit((damage, _headshot, attackerId) => {
      this.takeDamage(damage);
      if (this.playerHP <= 0) {
        this.multiplayer.sendPlayerDied();
      }
      const attackerSnap = this.multiplayer.getSnapshot(attackerId);
      if (attackerSnap) this.showDamageIndicator(attackerSnap.x, attackerSnap.z);
    });

    // Vencedor da partida anunciado pelo servidor
    this.multiplayer.onMatchWinner((winnerSessionId, winnerName) => {
      if (this.isGameOver) return; // já eliminado — overlay já visível
      const isSelf = winnerSessionId === (this.multiplayer.getSelfSessionId() ?? "__none__");
      if (isSelf) {
        this.showFinalRanking(true);
      } else {
        this.showFinalRanking(false, winnerName);
      }
    });

    this.updateAmmoHUD();
    this.updateHealthHUD();
    this.updateLobbyHUD();
  }

  start(): void {
    this.renderer.setAnimationLoop(this.animate);
  }

  takeDamage(amount: number, isStorm = false): void {
    if (this.gamePhase !== "playing" || this.isGameOver) return;
    this.playerHP -= amount;
    
    if (isStorm) {
        this.stormOverlay.style.opacity = "0.8";
        setTimeout(() => { this.stormOverlay.style.opacity = "0"; }, 300);
    } else {
        this.damageOverlay.style.opacity = "0.7";
        setTimeout(() => { this.damageOverlay.style.opacity = "0"; }, 300);
    }
    this.updateHealthHUD();

    if (this.playerHP <= 0 && !this.isGameOver) {
      this.triggerRespawn();
    }
  }

  private triggerRespawn(): void {
    this.playerDeaths++;
    this.playerLives = Math.max(0, 3 - this.playerDeaths);
    this.isGameOver = true;
    this.controls.unlock();
    this.multiplayer.sendPlayerDied();

    if (this.playerLives <= 0) {
      // Eliminado permanentemente — mostra ranking
      this.showFinalRanking(false);
      return;
    }

    // Ainda tem vidas — conta regressiva para respawn
    const overlay = document.createElement("div");
    overlay.id = "respawn-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(60,0,0,0.82);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10000;color:white;font-family:sans-serif;backdrop-filter:blur(4px);";
    overlay.innerHTML = `
      <h1 style="font-size:4.5rem;margin:0;text-shadow:4px 4px 0 #000;">VOCÊ MORREU</h1>
      <p style="font-size:1.4rem;color:#ffd700;margin-top:10px;">${"🧡".repeat(this.playerLives)} ${"💀".repeat(this.playerDeaths)} — ${this.playerLives} vida(s) restante(s)</p>
      <p style="font-size:1.5rem;color:#ccc;margin-top:8px;">Respawnando em <span id="respawn-countdown">4</span>s...</p>
    `;
    document.body.appendChild(overlay);

    let count = 4;
    const tick = setInterval(() => {
      count--;
      const el = document.getElementById("respawn-countdown");
      if (el) el.textContent = String(count);
      if (count <= 0) {
        clearInterval(tick);
        overlay.remove();
        this._doRespawn();
      }
    }, 1000);
  }

  /** Tela de ranking final (vitória ou eliminação) */
  showFinalRanking(isWinner: boolean, winnerName = ""): void {
    this.isGameOver = true;
    this.gamePhase  = isWinner ? "victory" : "gameover";
    this.controls.unlock();

    const remoteStats = this.multiplayer.getAllPlayerStats();
    const localName   = window.localStorage.getItem("voxel-royale.player-name") ?? "Você";
    const localEntry  = {
      sessionId: "self", name: localName, isSelf: true,
      kills: this.totalKills, headshots: this.headshotKills,
      mobKills: 0, points: this.totalKills * 10 + this.headshotKills * 5,
      isDead: !isWinner
    };
    const all = [localEntry, ...remoteStats].sort((a, b) => b.points - a.points);

    const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;");
    const rows = all.map((p, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`;
      const selfMark = p.isSelf ? ' <span style="background:#3b82f6;border-radius:4px;padding:1px 6px;font-size:11px;">você</span>' : "";
      const deadMark = p.isDead ? "💀" : "✅";
      return `<tr style="background:${p.isSelf ? "rgba(59,130,246,0.15)" : "transparent"};">
        <td style="padding:6px 10px;">${medal}</td>
        <td style="padding:6px 10px;">${deadMark}</td>
        <td style="padding:6px 10px;text-align:left;">${esc(p.name)}${selfMark}</td>
        <td style="padding:6px 10px;">${p.kills}</td>
        <td style="padding:6px 10px;">${p.headshots}</td>
        <td style="padding:6px 10px;color:#ffd700;font-weight:700;">${p.points}</td>
      </tr>`;
    }).join("");

    const bg    = isWinner ? "rgba(0,60,0,0.93)" : "rgba(40,0,0,0.93)";
    const title = isWinner ? "🏆 VITÓRIA!" : "💀 ELIMINADO";
    const sub   = isWinner
      ? "Você é o último sobrevivente!"
      : winnerName ? `Vencedor: <b>${esc(winnerName)}</b>` : "Você usou todas as suas vidas.";

    const overlay = document.createElement("div");
    overlay.style.cssText = `position:fixed;inset:0;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10000;color:white;font-family:sans-serif;backdrop-filter:blur(6px);overflow-y:auto;padding:20px;`;
    overlay.innerHTML = `
      <h1 style="font-size:3.5rem;margin:0 0 6px;text-shadow:4px 4px 0 #000;">${title}</h1>
      <p style="font-size:1.2rem;color:#ccc;margin:0 0 18px;">${sub}</p>
      <table style="border-collapse:collapse;min-width:min(560px,90vw);background:rgba(0,0,0,0.45);border-radius:12px;overflow:hidden;font-size:0.95rem;">
        <thead><tr style="background:rgba(255,255,255,0.08);color:#aaa;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;">
          <th style="padding:8px 10px;">#</th><th></th>
          <th style="padding:8px 10px;text-align:left;">Jogador</th>
          <th style="padding:8px 10px;">Kills</th><th style="padding:8px 10px;">HS</th>
          <th style="padding:8px 10px;">Pts</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <button onclick="location.reload()" style="margin-top:24px;padding:14px 36px;font-size:1.3rem;font-weight:bold;cursor:pointer;border:none;border-radius:10px;background:${isWinner ? "#ffd700" : "#f1f5f9"};color:#0f172a;box-shadow:0 4px 12px rgba(0,0,0,0.5);">
        Jogar Novamente
      </button>
    `;
    document.body.appendChild(overlay);
  }

  /** Encontra ponto de spawn seguro (longe de todos os outros players/bots, mas não muito) */
  private _findSafeSpawn(): THREE.Vector3 {
    const allSnapshots = this.multiplayer.getAllSnapshots();
    const MIN_DIST = 20;   // pelo menos 20m de distância
    const MAX_DIST = 60;   // mas não mais de 60m
    const ATTEMPTS  = 20;

    for (let i = 0; i < ATTEMPTS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = MIN_DIST + Math.random() * (MAX_DIST - MIN_DIST);
      const cx    = this.playerPosition.x + Math.cos(angle) * dist;
      const cz    = this.playerPosition.z + Math.sin(angle) * dist;

      // Verifica se está longe o suficiente de todos os outros
      let tooClose = false;
      for (const snap of allSnapshots) {
        const dx = snap.x - cx, dz = snap.z - cz;
        if (Math.sqrt(dx * dx + dz * dz) < MIN_DIST) { tooClose = true; break; }
      }
      if (!tooClose) {
        const groundY = this.terrain.getSurfaceHeightAt(cx, cz) + 1.8;
        return new THREE.Vector3(cx, groundY, cz);
      }
    }
    // Fallback: spawn aleatório perto da origem
    const a = Math.random() * Math.PI * 2;
    const r = 30 + Math.random() * 20;
    const fx = Math.cos(a) * r, fz = Math.sin(a) * r;
    return new THREE.Vector3(fx, this.terrain.getSurfaceHeightAt(fx, fz) + 1.8, fz);
  }

  private _doRespawn(): void {
    // Reset estado do player
    this.playerHP      = 100;
    this.isGameOver    = false;
    this.isReloading   = false;
    this.isJammed      = false;
    this.playerVelocity.set(0, 0, 0);
    this.reloadHUD.style.display = "none";
    this.updateHealthHUD();

    // Teleporta para ponto seguro
    const spawnPt = this._findSafeSpawn();
    this.playerPosition.copy(spawnPt);
    this.controls.object.position.copy(spawnPt);

    // Re-trava o mouse
    this.controls.lock();
  }

  private triggerGameOver(): void {
    this.isGameOver = true;
    this.gamePhase = "gameover";
    this.controls.unlock();
    const go = document.createElement("div");
    go.innerHTML = `<div style="position:absolute;inset:0;background:rgba(60,0,0,0.9);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10000;color:white;font-family:sans-serif;backdrop-filter:blur(5px);">
       <h1 style="font-size:6rem;margin:0;text-shadow:4px 4px 0 #000;">VOCÊ MORREU</h1>
       <p style="font-size:1.8rem;color:#ccc;">A ilha cobrou seu preço. Fim de jogo.</p>
       <button onclick="location.reload()" style="margin-top:30px;padding:15px 40px;font-size:1.5rem;font-weight:bold;cursor:pointer;border:none;border-radius:10px;background:white;color:black;box-shadow:0 4px 10px rgba(0,0,0,0.5);">Voltar ao Menu</button>
    </div>`;
    document.body.appendChild(go);
  }

  private triggerVictory(): void {
    this.showFinalRanking(true);
  }

  private showDamageIndicator(attackerX: number, attackerZ: number): void {
    this.activeDamageIndicator = { x: attackerX, z: attackerZ, life: 2.5 };
    this.dmgIndicator.style.opacity = "1";
  }

  private updateDamageIndicator(delta: number): void {
    if (!this.activeDamageIndicator) return;

    this.activeDamageIndicator.life -= delta;
    if (this.activeDamageIndicator.life <= 0) {
      this.activeDamageIndicator = null;
      this.dmgIndicator.style.opacity = "0";
      return;
    }

    const ctx = this.dmgIndicator.getContext("2d");
    if (!ctx) return;

    // ── Ângulo no espaço da câmera ──────────────────────────────────────
    // Three.js PointerLockControls com Euler "YXZ":
    //   rotation.y = θ  →  câmera aponta para (-sin θ, 0, -cos θ) no mundo
    //
    // Para converter a posição do atacante para "tela":
    //   forward_component = dot(attackerDir, cameraFwd)  = -dx*sinθ - dz*cosθ
    //   right_component   = dot(attackerDir, cameraRight) =  dx*cosθ - dz*sinθ
    //
    // No canvas: arc(0) = Leste, arc(-π/2) = Norte (topo = à frente)
    //   canvasAngle = atan2(right, forward) - π/2
    const dx  = this.activeDamageIndicator.x - this.playerPosition.x;
    const dz  = this.activeDamageIndicator.z - this.playerPosition.z;
    const θ   = this.controls.object.rotation.y;
    const fwd   = -dx * Math.sin(θ) - dz * Math.cos(θ);
    const right =  dx * Math.cos(θ) - dz * Math.sin(θ);
    const canvasAngle = Math.atan2(right, fwd) - Math.PI / 2;

    // ── Fade: 1→0 no último meio segundo ──────────────────────────────
    const t     = this.activeDamageIndicator.life; // 2.5 → 0
    const alpha = Math.min(1, t / 0.4);            // pleno por 2.1s, fade em 0.4s

    // ── Desenha indicador ─────────────────────────────────────────────
    const cx   = 250, cy = 250, r = 200;
    const half = 0.42; // metade do arco (~24°)

    ctx.clearRect(0, 0, 500, 500);

    // Arco com múltiplos segmentos para simular fade nas pontas
    const steps   = 12;
    for (let i = 0; i < steps; i++) {
      const t0   = (i / steps);
      const t1   = ((i + 1) / steps);
      const a0   = canvasAngle - half + t0 * half * 2;
      const a1   = canvasAngle - half + t1 * half * 2;
      // Opacidade: 0 nas pontas, 1 no centro
      const mid  = (t0 + t1) / 2;
      const env  = Math.sin(mid * Math.PI); // 0→1→0
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,30,30,${alpha * env * 0.95})`;
      ctx.lineWidth   = 26;
      ctx.lineCap     = "butt";
      ctx.arc(cx, cy, r, a0, a1);
      ctx.stroke();
    }

    // Ponta de seta sólida apontando para a direção do dano
    const tipX = cx + Math.cos(canvasAngle) * (r + 18);
    const tipY = cy + Math.sin(canvasAngle) * (r + 18);
    const l1X  = cx + Math.cos(canvasAngle - 0.38) * (r - 10);
    const l1Y  = cy + Math.sin(canvasAngle - 0.38) * (r - 10);
    const l2X  = cx + Math.cos(canvasAngle + 0.38) * (r - 10);
    const l2Y  = cy + Math.sin(canvasAngle + 0.38) * (r - 10);
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,30,30,${alpha})`;
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(l1X,  l1Y);
    ctx.lineTo(l2X,  l2Y);
    ctx.closePath();
    ctx.fill();
  }

  private updateScoreboard(): void {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Em mobile o scoreboardVisible já é controlado pelo botão touch (não sobrescreve)
    const show = this.isMobile ? this.scoreboardVisible : this.input.isPressed("Tab");
    if (show !== this.scoreboardVisible) {
      this.scoreboardVisible = show;
      this.scoreboardHUD.style.display = show ? "flex" : "none";
    }
    if (!show) return;

    const localName   = window.localStorage.getItem("voxel-royale.player-name") ?? "Você";
    const remoteStats = this.multiplayer.getAllPlayerStats();

    // Build local entry
    const localEntry = {
      sessionId: "self",
      name: localName,
      isDead: false,
      isSelf: true,
      kills: this.totalKills,
      headshots: this.headshotKills,
      mobKills: 0,
      points: this.totalKills * 10 + this.headshotKills * 5
    };

    // Merge & sort by points
    const all = [localEntry, ...remoteStats].sort((a, b) => b.points - a.points);
    const total = all.length;
    const alive = all.filter(p => !p.isDead).length;

    let rows = "";
    all.forEach((p, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
      const deadClass = p.isDead ? " sb-row--dead" : "";
      const selfClass = p.isSelf ? " sb-row--self" : "";
      rows += `
        <div class="sb-row${deadClass}${selfClass}">
          <span class="sb-rank">${medal}</span>
          <span class="sb-dot ${p.isDead ? "sb-dot--dead" : "sb-dot--alive"}"></span>
          <span class="sb-name">${esc(p.name)}${p.isSelf ? ' <span class="sb-you">você</span>' : ""}</span>
          <span class="sb-stat" title="Abates de jogadores">${p.kills}<span class="sb-stat-label">kills</span></span>
          <span class="sb-stat" title="Headshots">${p.headshots}<span class="sb-stat-label">HS</span></span>
          <span class="sb-stat" title="Pontos">${p.points}<span class="sb-stat-label">pts</span></span>
        </div>`;
    });

    this.scoreboardHUD.innerHTML = `
      <div class="sb-panel">
        <div class="sb-header">
          <span class="sb-title">Placar</span>
          <span class="sb-count">${alive} / ${total} vivos</span>
        </div>
        <div class="sb-cols">
          <span></span><span></span><span></span>
          <span class="sb-col-label">Kills</span>
          <span class="sb-col-label">HS</span>
          <span class="sb-col-label">Pts</span>
        </div>
        <div class="sb-list">${rows}</div>
        <div class="sb-hint">Solte Tab para fechar · Kill=10pts · Headshot kill=+5pts</div>
      </div>`;
  }

  private updateHealthHUD(): void {
    const hearts = Math.ceil(Math.max(0, this.playerHP) / 10);
    let html = "";
    for (let i = 1; i <= 10; i++) html += i <= hearts ? "❤️" : "🖤";
    this.healthHUD.innerHTML = html;
    // Vidas restantes
    const livesLeft = Math.max(0, this.playerLives);
    this.livesHUD.innerHTML = "💀".repeat(this.playerDeaths) + "🧡".repeat(livesLeft);
    this.livesHUD.title = `${livesLeft} vida(s) restante(s)`;
  }

  // ── Cena ────────────────────────────────────────────────────────────────
  private setupScene(): void {
    this.scene.background = new THREE.Color(0x8ecdf5);
    this.camera.far = 2000;
    this.camera.updateProjectionMatrix();
    this.scene.fog = new THREE.Fog(0x8ecdf5, 200, 700);

    const hemi = new THREE.HemisphereLight(0xfff4cc, 0x7a8a99, 1.75);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3d9, 2.25);
    sun.position.set(24, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512); // Otimização de performance
    sun.shadow.camera.left   = -50;
    sun.shadow.camera.right  =  50;
    sun.shadow.camera.top    =  50;
    sun.shadow.camera.bottom = -50;
    this.scene.add(sun);

    this.scene.add(this.terrain.group);
    this.scene.add(this.controls.object);
    this.camera.add(this.viewModel.root);

    this.planeMeshGroup = this.buildPlaneMesh();
    this.scene.add(this.planeMeshGroup);

    // Spawna 2 airdrops de teste ao iniciar
    this.airdropSystem.spawnDrop(30,  20);
    this.airdropSystem.spawnDrop(-25, 40);
    this.viewModel.root.visible = false;
    this.introHUD.classList.remove("hidden");
  }

  // ── Avião ────────────────────────────────────────────────────────────────
  private buildPlaneMesh(): THREE.Group {
    const g = new THREE.Group();
    const bM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const wM = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4 });
    const dM = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1 });
    const rM = new THREE.MeshStandardMaterial({ color: 0xcc0000, roughness: 0.4 });

    const fuseGeo = new THREE.CylinderGeometry(1.4, 1.4, 16, 16);
    fuseGeo.rotateX(Math.PI / 2);
    g.add(new THREE.Mesh(fuseGeo, bM));
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 16), bM);
    nose.position.set(0, 0, -8); nose.scale.z = 1.6; g.add(nose);
    const tailGeo = new THREE.CylinderGeometry(1.4, 0.4, 4, 16);
    tailGeo.rotateX(Math.PI / 2);
    const tail = new THREE.Mesh(tailGeo, bM); tail.position.set(0,0,10); g.add(tail);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(32,0.3,4.5), wM);
    wing.position.set(0,-0.2,0); g.add(wing);
    [15.8,-15.8].forEach(px => {
      const wt = new THREE.Mesh(new THREE.BoxGeometry(0.3,1.2,3), rM);
      wt.position.set(px,0.4,0.5); g.add(wt);
    });
    const ht = new THREE.Mesh(new THREE.BoxGeometry(11,0.3,3), wM);
    ht.position.set(0,0,10.5); g.add(ht);
    const vt = new THREE.Mesh(new THREE.BoxGeometry(0.4,4,3.5), rM);
    vt.position.set(0,2.2,10.5); g.add(vt);
    const ck = new THREE.Mesh(new THREE.BoxGeometry(2,1.2,1.8), dM);
    ck.position.set(0,1,-7); ck.rotation.x = -0.25; g.add(ck);
    [[-6,-1.1],[6,-1.1]].forEach(([ex,ey]) => {
      const eGeo = new THREE.CylinderGeometry(0.7,0.7,3,16); eGeo.rotateX(Math.PI/2);
      const e = new THREE.Mesh(eGeo, bM); e.position.set(ex,ey,0.5); g.add(e);
    });
    return g;
  }

  // ── Eventos ──────────────────────────────────────────────────────────────
  private setupEvents(): void {
    window.addEventListener("resize",      this.handleResize);
    window.addEventListener("keydown",     this.handleKeyDown);
    window.addEventListener("contextmenu", this.handleContextMenu);
    window.addEventListener("mousedown",   this.handleMouseDown);
    window.addEventListener("mouseup",     this.handleMouseUp);

    this.shell.addEventListener("click",                this.handlePointerLockRequest);
    this.renderer.domElement.addEventListener("click",  this.handlePointerLockRequest);

    this.controls.addEventListener("lock", () => {
      this.isLocked = true;
      this.instructions.classList.add("hidden");
    });
    this.controls.addEventListener("unlock", () => {
      this.isLocked  = false;
      this.isAiming  = false;
      this.crosshair.classList.remove("aiming");
      this.instructions.classList.remove("hidden");
    });
  }

  // ── Loop principal ────────────────────────────────────────────────────────
  private animate = (): void => {
    const delta   = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

    if (!this.matchReady) {
      this.updateLobbyHUD();
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.gamePhase !== "playing") {
      this.terrain.setViewRadius(this.introPos.y > 150 ? 0 : 4);
      this.terrain.setChunksPerUpdate(this.introPos.y > 150 ? 0 : 3);
      this.updateIntroPhase(delta);
      this.terrain.update(this.introPos);
      this.minimap.update(this.introPos);
      // Atualiza e envia posição de outros players mesmo durante a intro
      this.multiplayer.update(elapsed, delta);
      this.multiplayer.sendPlayerState({
        x:       this.introPos.x,
        y:       this.introPos.y,
        z:       this.introPos.z,
        yaw:     this.getCameraYaw(),
        pitch:   this.getCameraPitch(),
        walking: false,
        armed:   Boolean(this.currentWeapon),
        weaponId: this.currentWeapon?.id ?? "",
        reloading: false,
        aiming:  false,
      });
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // ── Jogo normal ─────────────────────────────────────────────────────
    this.terrain.setViewRadius(2); // Menos radius melhora estabilidade
    this.terrain.setChunksPerUpdate(1);

    // Avião continua sobrevoando mesmo no modo debug (sem intro)
    if (DEBUG_SKIP_INTRO) {
      this.planePos.x += PLANE_SPEED * delta;
      if (this.planePos.x > 600) this.planePos.set(-520, PLANE_ALTITUDE, 0);
      this.planeMeshGroup.position.copy(this.planePos);
      this.planeMeshGroup.rotation.y = -Math.PI / 2;
    }

    this.minimapTimer += delta;
    if (this.minimapTimer > 0.15) {
      this.minimap.update(this.playerPosition, this.stormSystem.currentState);
      this.minimapTimer = 0;
    }

    this.fireCooldown  = Math.max(0, this.fireCooldown  - delta);
    this.breakCooldown = Math.max(0, this.breakCooldown - delta);

    // Recarga
    if (this.isReloading && this.currentWeapon) {
      const done = this.viewModel.advanceReload(delta, this.currentWeapon.reloadTime);
      if (done) {
        this.currentAmmo = this.currentWeapon.maxAmmo;
        this.isReloading = false;
        this.reloadHUD.style.display = "none";
        this.updateAmmoHUD();
      }
    }

    // Engalhamento
    if (this.isJammed && this.currentWeapon) {
      this.jamTimer -= delta;
      if (this.jamTimer <= 0) {
        this.isJammed = false;
        this.viewModel.clearJam();
      }
    }

    this.terrain.update(this.playerPosition);
    this.updateMovement(delta);
    this.syncPlayerView();
    this.updateUnderwater();
    this.checkWeaponSpawns();

    // Interação com drops próximos
    this.nearbyDrop = this.itemDrops.getNearbyDrop(this.playerPosition);
    if (this.nearbyDrop) {
      this.interactHUD.style.display = "block";
      this.interactHUD.innerHTML = `[E] Pegar ${this.nearbyDrop.itemLabel}`;
      this.touchControls?.setInteractVisible(true, this.nearbyDrop.itemLabel);
    } else {
      this.interactHUD.style.display = "none";
      this.touchControls?.setInteractVisible(false);
    }

    if (this.stormSystem.isActive) {
      this.stormPhaseHUD.textContent = `Tempestade: Fase ${Math.min(5, this.stormSystem.stormStage)} / 5`;
    }

    const speed = THREE.MathUtils.clamp(
      Math.hypot(this.playerVelocity.x, this.playerVelocity.z) / SPRINT_SPEED, 0, 1
    );
    const fwdSpeed = this.playerVelocity.dot(this.forwardDirection) / SPRINT_SPEED;
    this.viewModel.update(elapsed, speed, this.isAiming, this.isSprinting, this.currentWeapon);
    this.itemDrops.update(delta, elapsed);
    this.underwater.update(delta, fwdSpeed);
    this.combatEffects.update(delta);
    this.airdropSystem.update(delta, this.playerPosition);
    if (!DEBUG_DISABLE_MOBS) this.mobSystem.update(delta, this.playerPosition, (dmg) => this.takeDamage(dmg));
    if (!DEBUG_DISABLE_STORM) this.stormSystem.update(delta, this.playerPosition, (dmg) => this.takeDamage(dmg, true));

    // Desafio Final: Condição de Vitória!
    if (!DEBUG_DISABLE_STORM && this.stormSystem.isFinal && this.stormSystem.currentState?.phase === "paused") {
       this.rescueHUD.style.display = "block";
       this.rescueTimer -= delta;
       this.rescueHUD.textContent = `🚁 Resgate em: ${Math.ceil(this.rescueTimer)}s`;

       if (this.rescueTimer <= 0 && !this.isGameOver) {
          this.triggerVictory();
       }
    }

    // Spawn periódico de Zumbis
    if (!DEBUG_DISABLE_MOBS) {
      const baseSpawnChance = 0.1;
      const stageMultiplier = 1 + (this.stormSystem.stormStage * 0.8);
      if (Math.random() < delta * baseSpawnChance * stageMultiplier) {
        this.mobSystem.spawnSingleZombieNear(this.playerPosition);
      }
    }

    // Airdrop periódico automático a cada ~90s
    this.airdropTimer -= delta;
    if (this.airdropTimer <= 0) {
      this.airdropTimer = 80 + Math.random() * 40;
      const angle = Math.random() * Math.PI * 2;
      const dist  = 40 + Math.random() * 60;
      this.airdropSystem.spawnDrop(
        this.playerPosition.x + Math.cos(angle) * dist,
        this.playerPosition.z + Math.sin(angle) * dist
      );
    }

    // ── Ações touch one-shot por frame ───────────────────────────────────
    const tcFrame = this.touchControls;
    if (tcFrame) {
      // Mira (ADS)
      const wantsAim = tcFrame.isAimHeld;
      if (wantsAim !== this.isAiming) {
        this.isAiming = wantsAim;
        if (wantsAim) this.crosshair.classList.add("aiming");
        else          this.crosshair.classList.remove("aiming");
      }
      // Recarregar
      if (tcFrame.isReloadJustPressed && !this.isReloading && this.currentWeapon) {
        if (this.currentAmmo < this.currentWeapon.maxAmmo) this.startReload();
      }
      // Pegar item
      if (tcFrame.isInteractJustPressed && this.nearbyDrop) {
        const def = WEAPONS[this.nearbyDrop.itemId];
        const added = this.inventory.addItem({
          id: this.nearbyDrop.itemId,
          label: def ? def.name : this.nearbyDrop.itemLabel
        });
        if (added) {
          this.itemDrops.removeDrop(this.nearbyDrop.index);
          this.nearbyDrop = null;
          this.interactHUD.style.display = "none";
        }
      }
      // Inventário
      if (tcFrame.isInventoryJustPressed) {
        const isOpen = this.inventory.toggle();
        if (!isOpen && this.isMobile) this.isLocked = true;
      }
      // Scoreboard (Tab virtual)
      this.scoreboardVisible = tcFrame.isScoreboardHeld;

      tcFrame.clearFrameState();
    }

    // Hold-to-fire / hold-to-break
    const wantsFire = this.isMouseDown || (this.touchControls?.isFireHeld ?? false);
    if (wantsFire && (this.isLocked || this.isMobile)) {
      const item = this.inventory.getSelectedItem();
      if (item?.id === "pickaxe") {
        if (this.breakCooldown <= 0) {
          this.tryBreakBlock();
          this.breakCooldown = BREAK_INTERVAL;
        }
      } else {
        const def = WEAPONS[item?.id ?? ""];
        if (def) {
          // Semi-auto: só dispara uma vez por clique (controlado por breakCooldown reset)
          if (def.isAuto || this.fireCooldown <= 0) {
            if (this.fireCooldown <= 0) this.fire();
          }
        }
      }
    }

    this.multiplayer.update(elapsed, delta);
    this.multiplayer.sendPlayerState({
      x:       this.playerPosition.x,
      y:       this.playerPosition.y,
      z:       this.playerPosition.z,
      yaw:     this.getCameraYaw(),
      pitch:   this.getCameraPitch(),
      walking: speed > 0.08,
      armed:   Boolean(this.currentWeapon),
      weaponId: this.currentWeapon?.id ?? "",
      reloading: this.isReloading,
      aiming:  this.isAiming,   // ← transmite o estado de mira para os outros players
    });

    this.updateDamageIndicator(delta);
    this.updateScoreboard();
    this.renderer.render(this.scene, this.camera);
  };

  // ── Fase intro ───────────────────────────────────────────────────────────
  private getCameraYaw(): number {
    this.camera.getWorldDirection(this.yawDirection);
    this.yawDirection.y = 0;

    if (this.yawDirection.lengthSq() <= 0.000001) {
      return this.controls.object.rotation.y;
    }

    this.yawDirection.normalize();
    return Math.atan2(this.yawDirection.x, this.yawDirection.z);
  }

  private _pitchLogTimer = 0;
  private getCameraPitch(): number {
    this.pitchEuler.setFromQuaternion(this.camera.quaternion, "YXZ");
    const pitch = this.pitchEuler.x;
    this._pitchLogTimer += 1;
    if (this._pitchLogTimer % 60 === 0) {
      const q = this.camera.quaternion;
      console.log("[getPitch] rotX=", this.camera.rotation.x.toFixed(4),
        "YXZ.x=", pitch.toFixed(4),
        "q=", q.x.toFixed(3), q.y.toFixed(3), q.z.toFixed(3), q.w.toFixed(3),
        "phase=", this.gamePhase);
    }
    return pitch;
  }

  private updateIntroPhase(delta: number): void {
    this.planePos.x += PLANE_SPEED * delta;
    if (this.planePos.x > 600) {
      // Força a queda se o player ainda estiver no avião no fim da rota
      if (this.gamePhase === "plane") {
        this.gamePhase = "skydiving";
        this.introPos.copy(this.planePos);
        this.introVel.set(PLANE_SPEED * 0.3, 0, 0);
      }
      this.planePos.set(-520, PLANE_ALTITUDE, 0);
    }
    this.planeMeshGroup.position.copy(this.planePos);
    this.planeMeshGroup.rotation.y = -Math.PI / 2;

    if (this.gamePhase === "plane") {
      this.introPos.copy(this.planePos);
      this.controls.object.position.set(this.introPos.x - 30, this.introPos.y + 12, this.introPos.z);
      const altEl = this.introHUD.querySelector(".intro-alt");
      if (altEl) altEl.textContent = `Altitude: ${Math.round(PLANE_ALTITUDE)} m`;
      // Mobile: jump button ejects from plane
      if (this.touchControls?.isJumpJustPressed) {
        this.gamePhase = "skydiving";
        this.introPos.copy(this.planePos);
        this.introVel.set(PLANE_SPEED * 0.3, 0, 0);
      }
      return;
    }
    // Mobile: jump button deploys parachute during skydive
    if (this.gamePhase === "skydiving" && this.touchControls?.isJumpJustPressed) {
      this.deployParachute();
    }

    this.camera.getWorldDirection(this.cameraDirection);
    this.forwardDirection.set(this.cameraDirection.x, 0, this.cameraDirection.z);
    if (this.forwardDirection.lengthSq() > 0.001) this.forwardDirection.normalize();
    this.rightDirection.crossVectors(this.forwardDirection, this.upAxis).normalize();
    this.moveDirection.set(0, 0, 0);

    if (this.input.isPressed("KeyW") || this.input.isPressed("ArrowUp")) this.moveDirection.add(this.forwardDirection);
    if (this.input.isPressed("KeyS") || this.input.isPressed("ArrowDown")) this.moveDirection.sub(this.forwardDirection);
    if (this.input.isPressed("KeyD") || this.input.isPressed("ArrowRight")) this.moveDirection.add(this.rightDirection);
    if (this.input.isPressed("KeyA") || this.input.isPressed("ArrowLeft")) this.moveDirection.sub(this.rightDirection);

    const steer = this.gamePhase === "parachute" ? CHUTE_STEER : SKYDIVE_STEER;
    if (this.moveDirection.lengthSq() > 0) {
      this.moveDirection.normalize().multiplyScalar(steer);
      this.introVel.x = THREE.MathUtils.lerp(this.introVel.x, this.moveDirection.x, delta * 3);
      this.introVel.z = THREE.MathUtils.lerp(this.introVel.z, this.moveDirection.z, delta * 3);
    } else {
      this.introVel.x = THREE.MathUtils.lerp(this.introVel.x, 0, delta * 2);
      this.introVel.z = THREE.MathUtils.lerp(this.introVel.z, 0, delta * 2);
    }

    if (this.gamePhase === "skydiving") {
      this.introVel.y -= SKYDIVE_GRAVITY * delta;
      this.introVel.y  = Math.max(this.introVel.y, -SKYDIVE_MAX_FALL);
    } else {
      this.introVel.y = THREE.MathUtils.lerp(this.introVel.y, -CHUTE_FALL_SPEED, delta * 4);
    }

    this.introPos.addScaledVector(this.introVel, delta);
    const groundH = this.terrain.getSurfaceHeightAt(this.introPos.x, this.introPos.z);

    if (this.gamePhase === "skydiving" && this.introPos.y - groundH < CHUTE_DEPLOY_HEIGHT) {
      this.deployParachute();
    }

    // Verifica se há copa de árvore abaixo para pousar
    const introTreeBoxes = this.terrain.getTreeBoxesNear(this.introPos, 4);
    let introTreeFloor = -Infinity;
    for (const b of introTreeBoxes) {
      const px = this.introPos.x;
      const pz = this.introPos.z;
      if (
        px + PLAYER_RADIUS > b.minX && px - PLAYER_RADIUS < b.maxX &&
        pz + PLAYER_RADIUS > b.minZ && pz - PLAYER_RADIUS < b.maxZ &&
        b.maxY <= this.introPos.y + 0.3
      ) {
        if (b.maxY > introTreeFloor) introTreeFloor = b.maxY;
      }
    }
    const introLandY = Math.max(groundH, introTreeFloor > -Infinity ? introTreeFloor : groundH);

    if (this.introPos.y <= introLandY + PLAYER_OFFSET) {
      this.introPos.y = introLandY + PLAYER_OFFSET;
      this.landPlayer();
      return;
    }

    this.controls.object.position.copy(this.introPos);

    const altEl   = this.introHUD.querySelector(".intro-alt");
    const labelEl = this.introHUD.querySelector(".intro-label");
    if (altEl)   altEl.textContent = `Altitude: ${Math.round(this.introPos.y - introLandY)} m acima do solo`;
    if (labelEl) labelEl.textContent =
      this.gamePhase === "parachute"
        ? "🪂 Paraquedas aberto — WASD para dirigir"
        : this.isMobile
          ? "Queda livre — toque ↑ para abrir paraquedas"
          : "Queda livre — ESPAÇO para abrir paraquedas";
  }

  private deployParachute(): void {
    if (this.parachuteActive) return;
    this.parachuteActive = true;
    this.gamePhase = "parachute";
    this.introVel.x *= 0.4;
    this.introVel.z *= 0.4;
    this.introVel.y *= 0.4; // suaviza queda inicial do abrir paraquedas
  }

  private landPlayer(): void {
    this.playerPosition.copy(this.introPos);
    this.playerVelocity.set(0, 0, 0);
    this.gamePhase = "playing";
    this.viewModel.root.visible = true;
    this.introHUD.classList.add("hidden");
    this.planeMeshGroup.visible = false;
    this.controls.object.position.copy(this.playerPosition);
    
    // Inicia a tempestade quando acabar a travessia
    if (!DEBUG_DISABLE_STORM) this.stormSystem.start();
  }

  // ── Movimento e colisão ──────────────────────────────────────────────────
  private updateMovement(delta: number): void {
    this.camera.getWorldDirection(this.cameraDirection);
    this.forwardDirection.set(this.cameraDirection.x, 0, this.cameraDirection.z);
    if (this.forwardDirection.lengthSq() < 0.0001) {
      this.forwardDirection.set(0, 0, -1);
    } else {
      this.forwardDirection.normalize();
    }
    this.rightDirection.crossVectors(this.forwardDirection, this.upAxis).normalize();
    this.moveDirection.set(0, 0, 0);

    if (this.input.isPressed("KeyW") || this.input.isPressed("ArrowUp")) this.moveDirection.add(this.forwardDirection);
    if (this.input.isPressed("KeyS") || this.input.isPressed("ArrowDown")) this.moveDirection.sub(this.forwardDirection);
    if (this.input.isPressed("KeyD") || this.input.isPressed("ArrowRight")) this.moveDirection.add(this.rightDirection);
    if (this.input.isPressed("KeyA") || this.input.isPressed("ArrowLeft")) this.moveDirection.sub(this.rightDirection);

    // ── Touch joystick (mobile) ───────────────────────────────────────────
    const tc = this.touchControls;
    if (tc && (tc.moveX !== 0 || tc.moveZ !== 0)) {
      this.moveDirection.addScaledVector(this.forwardDirection, -tc.moveZ);
      this.moveDirection.addScaledVector(this.rightDirection,    tc.moveX);
    }
    // Câmera touch: acumula yaw/pitch e aplica ao quaternion da câmera
    if (tc && (tc.lookDeltaX !== 0 || tc.lookDeltaY !== 0)) {
      this._touchYaw   -= tc.lookDeltaX;
      this._touchPitch -= tc.lookDeltaY;
      this._touchPitch  = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, this._touchPitch));
      this._touchEuler.set(this._touchPitch, this._touchYaw, 0, "YXZ");
      this.camera.quaternion.setFromEuler(this._touchEuler);
    }

    this.isSprinting = this.input.isPressed("ShiftLeft") || this.input.isPressed("ShiftRight")
                    || (tc?.isSprintActive ?? false);

    // excludeTreeBlocks=true → terreno puro, sem troncos/folhas (escalada manual)
    const groundH    = this.terrain.getSurfaceHeightAt(this.playerPosition.x, this.playerPosition.z, true);
    const feetY      = groundH;
    const cameraY    = groundH + PLAYER_OFFSET;

    // Detecta se está na água (pés abaixo do nível da água com 2 blocos de altura)
    const waterH     = this.terrain.waterLevel;
    const inWater    = this.playerPosition.y < waterH + 1.8 && groundH < waterH;
    this.isUnderwater = inWater && this.playerPosition.y < waterH + 0.8;

    this.isGrounded = this.playerPosition.y <= cameraY + 0.1;

    // ── Verificação de colisão com troncos de árvore ─────────────────────
    const treeBoxes = this.terrain.getTreeBoxesNear(this.playerPosition, 4);

    // Detecta se o player está próximo a um tronco/estrutura para escalar
    // Folhas são passáveis e não escaláveis; troncos e estruturas sim.
    let isNearTrunk = false;
    for (const b of treeBoxes) {
      if (b.isLeaf) continue; // folhas não servem para escalar
      const px = this.playerPosition.x;
      const pz = this.playerPosition.z;
      const pFeet = this.playerPosition.y - PLAYER_OFFSET;
      if (
        px + CLIMB_REACH > b.minX && px - CLIMB_REACH < b.maxX &&
        pz + CLIMB_REACH > b.minZ && pz - CLIMB_REACH < b.maxZ &&
        pFeet < b.maxY + 0.3 // pés abaixo ou levemente acima do topo
      ) {
        isNearTrunk = true;
        break;
      }
    }

    // Verifica se há bloco de árvore/estrutura EXATAMENTE ABAIXO dos pés (sem auto-step)
    let treeFloorY = -Infinity;
    for (const b of treeBoxes) {
      const px = this.playerPosition.x;
      const pz = this.playerPosition.z;
      if (
        px + PLAYER_RADIUS > b.minX && px - PLAYER_RADIUS < b.maxX &&
        pz + PLAYER_RADIUS > b.minZ && pz - PLAYER_RADIUS < b.maxZ &&
        b.maxY <= this.playerPosition.y - PLAYER_OFFSET  // pés já em cima — sem step automático
      ) {
        if (b.maxY > treeFloorY) treeFloorY = b.maxY;
      }
    }

    // Chão efetivo: máximo entre terreno e topo de árvore sob os pés
    const effectiveFeetY = Math.max(feetY, treeFloorY > -Infinity ? treeFloorY : feetY);
    const effectiveCamY  = effectiveFeetY + PLAYER_OFFSET;

    this.isGrounded = this.playerPosition.y <= effectiveCamY + 0.1;

    // ── Física ────────────────────────────────────────────────────────────
    if (inWater) {
      // Na água: menos gravidade e drag maior
      const targetSpeed = SWIM_SPEED;
      if (this.moveDirection.lengthSq() > 0) {
        this.moveDirection.normalize().multiplyScalar(targetSpeed);
        const blend = Math.min(1, WATER_DRAG * delta);
        this.playerVelocity.x = THREE.MathUtils.lerp(this.playerVelocity.x, this.moveDirection.x, blend);
        this.playerVelocity.z = THREE.MathUtils.lerp(this.playerVelocity.z, this.moveDirection.z, blend);
      } else {
        const drag = Math.max(0, 1 - WATER_DRAG * delta);
        this.playerVelocity.x *= drag;
        this.playerVelocity.z *= drag;
      }
      // Gravidade reduzida + flutuação
      const targetVY = -1.5; // afunda devagar
      this.playerVelocity.y = THREE.MathUtils.lerp(this.playerVelocity.y, targetVY, WATER_DRAG * delta);

      // Flutua se pular na água
      if (this.input.isPressed("Space")) {
        this.playerVelocity.y = 2.5;
      }
    } else {
      // Fora d'água: física normal
      if (this.moveDirection.lengthSq() > 0) {
        const targetSpeed = this.isSprinting && !this.isAiming ? SPRINT_SPEED : WALK_SPEED;
        this.moveDirection.normalize().multiplyScalar(targetSpeed);
        const blend = Math.min(1, (this.isGrounded ? GROUND_DRAG : AIR_DRAG) * delta);
        this.playerVelocity.x = THREE.MathUtils.lerp(this.playerVelocity.x, this.moveDirection.x, blend);
        this.playerVelocity.z = THREE.MathUtils.lerp(this.playerVelocity.z, this.moveDirection.z, blend);
      } else {
        const drag = Math.max(0, 1 - (this.isGrounded ? GROUND_DRAG : AIR_DRAG) * delta);
        this.playerVelocity.x *= drag;
        this.playerVelocity.z *= drag;
      }

      if (this.input.isJustPressed("Space") || (tc?.isJumpJustPressed ?? false)) {
        if (isNearTrunk) {
          // Escalada: cada press sobe ~1 bloco (CLIMB_STEP²/(2*GRAVITY) ≈ 1 unidade)
          this.playerVelocity.y = CLIMB_STEP;
          this.isGrounded = false;
        } else if (this.isGrounded) {
          // Pulo normal fora de árvores
          this.playerVelocity.y = JUMP_FORCE;
          this.isGrounded = false;
        }
      }

      // ── Auto-pulo: sobe automaticamente 1 nível de terreno ao se mover ──
      // Detecta terreno à frente que seja maior que o step automático mas
      // alcançável por um pulo (até ~1.3 blocos de altura).
      if (this.isGrounded && this.playerVelocity.y <= 0 && this.moveDirection.lengthSq() > 0.01) {
        const lookDist  = 0.5;
        const lookX     = this.playerPosition.x + this.moveDirection.x * lookDist;
        const lookZ     = this.playerPosition.z + this.moveDirection.z * lookDist;
        const aheadH    = this.terrain.getSurfaceHeightAt(lookX, lookZ, true);
        const currentFeetY = this.playerPosition.y - PLAYER_OFFSET;
        const heightDiff   = aheadH - currentFeetY;
        if (heightDiff > STEP_HEIGHT && heightDiff <= 1.35) {
          this.playerVelocity.y = JUMP_FORCE;
          this.isGrounded = false;
        }
      }

      if (!this.isGrounded) {
        this.playerVelocity.y -= GRAVITY * delta;
      } else if (this.playerVelocity.y < 0) {
        this.playerVelocity.y = 0;
      }
    }

    // ── Posição candidata ─────────────────────────────────────────────────
    this.nextPosition.copy(this.playerPosition).addScaledVector(this.playerVelocity, delta);

    // ── Colisão horizontal com troncos ────────────────────────────────────
    let collidedX = false;
    let collidedZ = false;
    for (const b of treeBoxes) {
      const pBottomY = this.nextPosition.y - PLAYER_OFFSET;
      const pTopY    = this.nextPosition.y;
      if (pTopY < b.minY - 0.05 || pBottomY > b.maxY + 0.05) continue;

      const px = this.nextPosition.x;
      const pz = this.nextPosition.z;
      const overlapX = px + PLAYER_RADIUS > b.minX && px - PLAYER_RADIUS < b.maxX;
      const overlapZ = pz + PLAYER_RADIUS > b.minZ && pz - PLAYER_RADIUS < b.maxZ;

      if (overlapX && overlapZ) {
        if (b.isLeaf) continue;
        const currentFeetY = this.playerPosition.y - PLAYER_OFFSET;
        // Permite subir como degrau
        if (b.maxY <= currentFeetY + STEP_HEIGHT + 0.05) continue;

        const fromX = this.playerPosition.x;
        const fromZ = this.playerPosition.z;

        const hitZ = (fromX + PLAYER_RADIUS > b.minX && fromX - PLAYER_RADIUS < b.maxX) &&
                     (pz + PLAYER_RADIUS > b.minZ && pz - PLAYER_RADIUS < b.maxZ);
                     
        const hitX = (px + PLAYER_RADIUS > b.minX && px - PLAYER_RADIUS < b.maxX) &&
                     (fromZ + PLAYER_RADIUS > b.minZ && fromZ - PLAYER_RADIUS < b.maxZ);

        if (hitX) collidedX = true;
        if (hitZ) collidedZ = true;
        if (!hitX && !hitZ) {
          collidedX = true;
          collidedZ = true;
        }
      }
    }
    if (collidedX) { this.nextPosition.x = this.playerPosition.x; this.playerVelocity.x = 0; }
    if (collidedZ) { this.nextPosition.z = this.playerPosition.z; this.playerVelocity.z = 0; }

    // ── Colisão vertical com terreno e árvores ─────────────────────────
    // Amostra a altura em múltiplos pontos ao redor do raio do player
    // para evitar que ele entre no terreno nas bordas dos blocos.
    const r = PLAYER_RADIUS * 0.85;
    const nx_ = this.nextPosition.x, nz_ = this.nextPosition.z;
    const nextGroundH = Math.max(
      this.terrain.getSurfaceHeightAt(nx_,     nz_,     true),
      this.terrain.getSurfaceHeightAt(nx_ + r, nz_,     true),
      this.terrain.getSurfaceHeightAt(nx_ - r, nz_,     true),
      this.terrain.getSurfaceHeightAt(nx_,     nz_ + r, true),
      this.terrain.getSurfaceHeightAt(nx_,     nz_ - r, true)
    );

    // Piso de árvore para nova posição suportando subir degraus
    let nextTreeFloorY = -Infinity;
    const nextTreeBoxes = this.terrain.getTreeBoxesNear(this.nextPosition, 4);
    for (const b of nextTreeBoxes) {
      if (b.isLeaf) continue;
      const px = this.nextPosition.x;
      const pz = this.nextPosition.z;
      if (
        px + PLAYER_RADIUS > b.minX && px - PLAYER_RADIUS < b.maxX &&
        pz + PLAYER_RADIUS > b.minZ && pz - PLAYER_RADIUS < b.maxZ &&
        b.maxY <= (this.playerPosition.y - PLAYER_OFFSET) + STEP_HEIGHT + 0.1
      ) {
        if (b.maxY > nextTreeFloorY) nextTreeFloorY = b.maxY;
      }
    }

    const nextEffFeetY = Math.max(nextGroundH, nextTreeFloorY > -Infinity ? nextTreeFloorY : nextGroundH);
    const nextCamY     = nextEffFeetY + PLAYER_OFFSET;

    // Degrau muito alto: bloqueio horizontal (terreno puro)
    if (!inWater && nextEffFeetY - (this.playerPosition.y - PLAYER_OFFSET) > STEP_HEIGHT) {
      this.nextPosition.x = this.playerPosition.x;
      this.nextPosition.z = this.playerPosition.z;
      this.playerVelocity.x = 0;
      this.playerVelocity.z = 0;
    }

    if (!inWater) {
      if (this.nextPosition.y <= nextCamY) {
        // Player atingiu obstáculo ou caiu no chão
        this.nextPosition.y = nextCamY;
        this.playerVelocity.y = 0;
        this.isGrounded = true;
      } else if (this.isGrounded && this.playerVelocity.y <= 0 && this.nextPosition.y - nextCamY <= STEP_HEIGHT + 0.2) {
        // Player estava no chão e andou para frente num degrau que desce -> força colar no chão, evitar flutuar
        this.nextPosition.y = nextCamY;
        this.playerVelocity.y = 0;
        this.isGrounded = true;
      } else {
        this.isGrounded = false;
      }
    }

    // Impede afundar para dentro do terreno na água
    if (inWater && this.nextPosition.y < nextGroundH + PLAYER_OFFSET) {
      this.nextPosition.y = nextGroundH + PLAYER_OFFSET;
      this.playerVelocity.y = 0;
    }

    this.playerPosition.copy(this.nextPosition);

    // Limpa o estado "just pressed" após consumir todos os inputs deste frame
    this.input.clearJustPressed();
  }

  // ── Estado underwater ───────────────────────────────────────────────────
  private updateUnderwater(): void {
    this.underwater.setActive(this.isUnderwater);
  }

  // ── Spawns de armas no mundo ────────────────────────────────────────────
  private checkWeaponSpawns(): void {
    for (let i = 0; i < this.worldWeaponSpawns.length; i++) {
      if (this.spawnedWeapons.has(i)) continue;
      const sp  = this.worldWeaponSpawns[i];
      const dx  = sp.x - this.playerPosition.x;
      const dz  = sp.z - this.playerPosition.z;
      if (dx * dx + dz * dz < 40 * 40) {
        this.spawnedWeapons.add(i);
        const groundY = this.terrain.getSurfaceHeightAt(sp.x, sp.z);
        if (groundY > this.terrain.waterLevel) {
          const pos = new THREE.Vector3(sp.x, groundY, sp.z);
          const def = WEAPONS[sp.weaponId];
          this.itemDrops.spawnDrop(pos, sp.weaponId, def?.name ?? sp.weaponId);
        }
      }
    }
  }

  // ── Sincroniza câmera ────────────────────────────────────────────────────
  private syncPlayerView(): void {
    this.controls.object.position.copy(this.playerPosition);
    const def = this.currentWeapon;
    const targetFov = this.isAiming ? (def?.fovAim ?? 55) : (this.isSprinting ? 81 : 75);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 0.16);
    this.camera.updateProjectionMatrix();
  }

  // ── Disparo ──────────────────────────────────────────────────────────────
  private fire(): void {
    const def = this.currentWeapon;
    if (!def || (!this.isLocked && !this.isMobile) || this.fireCooldown > 0) return;
    if (this.isReloading || this.isJammed) return;

    if (this.currentAmmo <= 0) {
      this.startReload();
      return;
    }

    // Chance de engalhamento
    if (Math.random() < def.jamChance) {
      this.isJammed = true;
      this.jamTimer = def.jamClearTime;
      this.viewModel.startJam();
      return;
    }

    this.fireCooldown = def.fireCooldown;
    this.currentAmmo -= 1;
    this.viewModel.triggerFire();
    this.updateAmmoHUD();

    if (this.currentAmmo === 0 && !this.isReloading) {
      this.startReload();
    }

    this.camera.getWorldDirection(this.shotDir).normalize();
    this.viewModel.muzzle.getWorldPosition(this.muzzleWorldPos);

    // Disparar pellets (shotgun tem múltiplos)
    for (let p = 0; p < def.pellets; p++) {
      const dir = this.shotDir.clone();
      if (def.spreadAngle > 0) {
        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.random() * def.spreadAngle;
        dir.x += Math.sin(phi) * Math.cos(theta);
        dir.y += Math.sin(phi) * Math.sin(theta);
        dir.z += Math.cos(phi) - 1;
        dir.normalize();
      }
      this.combatEffects.spawnProjectile(this.muzzleWorldPos, dir, def.bulletSpeed);

      this.raycaster.set(this.controls.object.position, dir);
      const targets = [
        ...this.mobSystem.getRaycastTargets(),
        ...this.multiplayer.getRaycastTargets(),
        ...this.terrain.raycastTargets
      ];
      const [hit] = this.raycaster.intersectObjects(targets, false);
      
      if (hit) {
        if (hit.object.userData?.isMob) {
          const mobPart = hit.object.userData.part;
          const dummy = hit.object.userData.dummy;
          if (dummy) {
            const wasDead = dummy.isDead;
            dummy.takeDamage(def.baseDamage, mobPart);
            if (!wasDead && dummy.isDead) {
              this.totalKills++;
              if (mobPart === "head") this.headshotKills++;
              this.statsHUD.textContent = `Abates: ${this.totalKills} (${this.headshotKills} Headshots)`;
            }
          }
        } else if (hit.object.userData?.isPlayer) {
          const part      = hit.object.userData.part as string;
          const sessionId = hit.object.userData.sessionId as string;
          const avatar    = hit.object.userData.dummy as import("./PlayerAvatar").PlayerAvatar;
          if (avatar && !avatar.isDead && sessionId) {
            const damage = part === "head" ? 9999 : def.baseDamage;
            this.multiplayer.sendPlayerHit(sessionId, damage, part);
            // Optimistic: dispara morte local também para feedback imediato
            if (part === "head" || damage >= 100) {
              if (!avatar.isDead) {
                avatar.die();
                this.multiplayer.sendPlayerDied();
                this.totalKills++;
                if (part === "head") this.headshotKills++;
                this.statsHUD.textContent = `Abates: ${this.totalKills} (${this.headshotKills} Headshots)`;
              }
            }
          }
        }
        
        if (hit.face) {
          this.impactNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        } else {
          this.impactNormal.set(0, 1, 0);
        }
        this.combatEffects.spawnImpact(hit.point, this.impactNormal);
        this.multiplayer.sendShot({
          ox: this.muzzleWorldPos.x, oy: this.muzzleWorldPos.y, oz: this.muzzleWorldPos.z,
          dx: dir.x, dy: dir.y, dz: dir.z,
          ix: hit.point.x, iy: hit.point.y, iz: hit.point.z,
          nx: this.impactNormal.x, ny: this.impactNormal.y, nz: this.impactNormal.z,
          hit: true
        });
      } else {
        // Tiro sem impacto — envia apenas trajetória
        const far = this.muzzleWorldPos.clone().addScaledVector(dir, 200);
        this.multiplayer.sendShot({
          ox: this.muzzleWorldPos.x, oy: this.muzzleWorldPos.y, oz: this.muzzleWorldPos.z,
          dx: dir.x, dy: dir.y, dz: dir.z,
          ix: far.x, iy: far.y, iz: far.z,
          nx: 0, ny: 1, nz: 0,
          hit: false
        });
      }
    }
  }

  private startReload(): void {
    if (!this.currentWeapon || this.isReloading) return;
    this.isReloading = true;
    this.reloadTimer = 0;
    this.viewModel.startReload();
    this.reloadHUD.style.display = "block";
  }

  private updateAmmoHUD(): void {
    if (!this.currentWeapon) {
      this.ammoHUD.textContent = "";
      return;
    }
    this.ammoHUD.textContent = `${this.currentAmmo} / ${this.currentWeapon.maxAmmo}`;
    if (this.currentAmmo === 0) this.ammoHUD.style.color = "#ff4444";
    else if (this.currentAmmo <= 3) this.ammoHUD.style.color = "#ffaa00";
    else this.ammoHUD.style.color = "#ffffff";
  }

  // ── Quebra de bloco ──────────────────────────────────────────────────────
  private tryBreakBlock(): void {
    this.camera.getWorldPosition(this.camWorldPos);
    this.camera.getWorldDirection(this.shotDir).normalize();
    this.raycaster.set(this.camWorldPos, this.shotDir);

    const [hit] = this.raycaster.intersectObjects(this.terrain.raycastTargets, false);
    if (!hit || !hit.object.userData.breakable || hit.distance > 6) {
      this.clearCrack();
      return;
    }

    const obj        = hit.object;
    const isInstanced = (obj as THREE.InstancedMesh).isInstancedMesh;
    const blockType  = (obj.userData.blockType as string) ?? "grass";

    // ── Centro do bloco correto (usando face normal para desviar do face) ─
    let hitKey: string;
    let blockCenter: THREE.Vector3;

    if (isInstanced) {
      const p = hit.point;
      const n = hit.face?.normal ?? new THREE.Vector3(0, 1, 0);
      // Move 0.5 na direção oposta da normal para garantir estar DENTRO do bloco
      blockCenter = this.blockCenterVec.set(
        Math.floor(p.x - n.x * 0.5) + 0.5,
        Math.floor(p.y - n.y * 0.5) + 0.5,
        Math.floor(p.z - n.z * 0.5) + 0.5
      );
      hitKey = `${blockCenter.x}:${blockCenter.y}:${blockCenter.z}`;
    } else {
      blockCenter = obj.position.clone();
      hitKey = obj.uuid;
    }

    if (hitKey !== this.crackKey) {
      this.clearCrack();
      this.crackKey      = hitKey;
      this.crackHits     = 0;
      this.crackRequired = VoxelTerrain.hitsRequired(blockType);
      this.spawnCrackOverlay(blockCenter);
    }

    this.viewModel.triggerSwing();
    this.crackHits += 1;

    const stage = Math.min(
      Math.floor((this.crackHits / this.crackRequired) * this.crackMaterials.length),
      this.crackMaterials.length - 1
    );
    if (this.crackMesh) this.crackMesh.material = this.crackMaterials[stage];

    let result: BreakResult;
    if (isInstanced) {
      result = this.terrain.breakBlockAt(blockCenter, blockType);
    } else {
      result = this.terrain.breakTreeBlock(obj as THREE.Mesh);
    }

    if (!result) { this.clearCrack(); return; }

    if (result.broken) {
      this.clearCrack();
      // Spawna drop flutuante
      this.itemDrops.spawnDrop(result.dropPos, result.itemId, result.itemLabel);
    }
  }

  private tryPlaceBlock(): void {
    this.camera.getWorldPosition(this.camWorldPos);
    this.camera.getWorldDirection(this.shotDir).normalize();
    this.raycaster.set(this.camWorldPos, this.shotDir);

    const targets = this.terrain.raycastTargets;
    const [hit] = this.raycaster.intersectObjects(targets, false);

    if (!hit || hit.distance > 8) return;

    // Calcula posição do novo bloco baseado na normal da face atingida
    const norm = hit.face?.normal ?? new THREE.Vector3(0, 1, 0);
    // Transforma normal da face do objeto para o mundo (se o objeto tiver rotação)
    const impactN = norm.clone().transformDirection(hit.object.matrixWorld);

    // Ajustamos para o grid
    const targetPos = hit.point.clone().add(impactN.multiplyScalar(0.5));
    const finalPos = new THREE.Vector3(
        Math.floor(targetPos.x) + 0.5,
        Math.floor(targetPos.y) + 0.5,
        Math.floor(targetPos.z) + 0.5
    );

    // Verifica se colide com o corpo do player (bounding box simples)
    const dx = Math.abs(finalPos.x - this.playerPosition.x);
    const dz = Math.abs(finalPos.z - this.playerPosition.z);
    const dy = Math.abs(finalPos.y - (this.playerPosition.y - 0.9)); // Pé
    if (dx < 0.7 && dz < 0.7 && dy < 1.0) return;

    const selected = this.inventory.getSelectedItem();
    if (!selected) return;

    // Converte ID do inventário para tipo do terreno
    let blockType = "grass";
    if (selected.id === "grass_block") blockType = "grass";
    else if (selected.id === "dirt_block") blockType = "dirt";
    else if (selected.id === "stone_block") blockType = "stone";
    else if (selected.id === "wood_log") blockType = "wood";
    else if (selected.id === "leaf_block") blockType = "leaf";
    else blockType = selected.id; // planks, brick, iron, wool_blue

    const success = this.terrain.placeBlockAt(finalPos, blockType);
    if (success) {
      this.inventory.decrementSelectedItem();
    }
  }

  private spawnCrackOverlay(center: THREE.Vector3): void {
    this.crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.03, 1.03, 1.03), this.crackMaterials[0]);
    this.crackMesh.position.copy(center);
    this.scene.add(this.crackMesh);
  }

  private clearCrack(): void {
    if (this.crackMesh) {
      this.scene.remove(this.crackMesh);
      this.crackMesh.geometry.dispose();
      this.crackMesh = null;
    }
    this.crackKey  = "";
    this.crackHits = 0;
  }

  private updateLobbyHUD(): void {
    if (this.matchReady) {
      this.lobbyHUD.style.display = "none";
      return;
    }

    this.lobbyHUD.style.display = "flex";

    if (!this.lobbyStatus.connected) {
      this.lobbyHUD.innerHTML = `
        <span class="match-lobby__eyebrow">Modo local</span>
        <strong>Servidor indisponivel</strong>
        <span>O jogo abre sozinho enquanto o backend multiplayer nao responde.</span>
      `;
      return;
    }

    if (this.lobbyStatus.phase === "countdown") {
      this.lobbyHUD.innerHTML = `
        <span class="match-lobby__eyebrow">Sala formada</span>
        <strong>${this.lobbyStatus.playerCount}/10 jogadores</strong>
        <span>Partida comeca em ${this.lobbyStatus.countdownSeconds}s</span>
      `;
      return;
    }

    this.lobbyHUD.innerHTML = `
      <span class="match-lobby__eyebrow">Aguardando jogadores</span>
      <strong>${this.lobbyStatus.playerCount}/10 na sala</strong>
      <span>A partida inicia em ate 60s assim que entrar pelo menos 2 jogadores.</span>
    `;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  private handleResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private handlePointerLockRequest = (): void => {
    // Permite capturar o mouse durante o avião/queda/paraquedas E durante o jogo
    if (!this.matchReady && this.gamePhase !== "plane" && this.gamePhase !== "skydiving" && this.gamePhase !== "parachute") return;
    if (!this.isLocked) this.controls.lock();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Space" && this.gamePhase !== "playing") {
      if (this.gamePhase === "plane") {
        this.gamePhase = "skydiving";
        this.introPos.copy(this.planePos);
        this.introVel.set(PLANE_SPEED * 0.3, 0, 0);
      } else if (this.gamePhase === "skydiving") {
        this.deployParachute();
      } else if (this.gamePhase === "parachute") {
        const groundH = this.terrain.getSurfaceHeightAt(this.introPos.x, this.introPos.z);
        if (this.introPos.y - groundH > CHUTE_DEPLOY_HEIGHT) {
            this.parachuteActive = false;
            this.gamePhase = "skydiving";
        }
      }
      return;
    }

    // Capturar itens no chão
    if (event.code === "KeyE" && this.gamePhase === "playing" && this.nearbyDrop) {
      const def = WEAPONS[this.nearbyDrop.itemId];
      const added = this.inventory.addItem({ 
         id: this.nearbyDrop.itemId, 
         label: def ? def.name : this.nearbyDrop.itemLabel 
      });
      if (added) {
         this.itemDrops.removeDrop(this.nearbyDrop.index);
         this.nearbyDrop = null;
         this.interactHUD.style.display = "none";
      }
      return;
    }

    // Abre/fecha UI do caixote de suprimentos
    if (event.code === "Enter" && this.gamePhase === "playing") {
      if (this.airdropSystem.isUIOpen) {
        this.airdropSystem.closeUI();
        this.controls.lock();
      } else {
        const opened = this.airdropSystem.tryOpenNearby(this.playerPosition);
        if (opened) this.controls.unlock();
      }
      return;
    }

    if (event.code === "KeyR" && this.gamePhase === "playing" && !this.isReloading) {
      if (this.currentWeapon && this.currentAmmo < this.currentWeapon.maxAmmo) {
        this.startReload();
      }
      return;
    }

    if (event.code === "KeyI" && this.gamePhase === "playing") {
      const isOpen = this.inventory.toggle();
      if (isOpen) this.controls.unlock();
      return;
    }

    if (event.code.startsWith("Digit") && this.gamePhase === "playing") {
      const index = Number(event.code.replace("Digit", "")) - 1;
      if (index >= 0 && index < 9) this.inventory.selectHotbar(index);
    }
  };

  private handleContextMenu = (e: MouseEvent): void => { e.preventDefault(); };

  private handleMouseDown = (event: MouseEvent): void => {
    if (!this.isLocked) return;
    if (event.button === 0 && this.gamePhase === "playing") {
      this.isMouseDown   = true;
      this.breakCooldown = 0;
      this.fireCooldown  = 0;
    }
    if (event.button === 2 && this.gamePhase === "playing") {
      const selected = this.inventory.getSelectedItem();
      const isBlock = selected && (
        selected.id.includes("block") || 
        ["planks", "brick", "iron", "wool_blue", "wood_log"].includes(selected.id)
      );

      if (isBlock) {
         this.tryPlaceBlock();
      } else {
         this.isAiming = true;
         this.crosshair.classList.add("aiming");
      }
    }
  };

  private handleMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) { this.isMouseDown = false; this.clearCrack(); }
    if (event.button === 2) { this.isAiming = false; this.crosshair.classList.remove("aiming"); }
  };

  private handleHotbarChange = (item: { id: string; label: string; count: number } | null, _index: number): void => {
    const isPick = item?.id === "pickaxe";
    const weapId = !isPick ? (item?.id ?? "") : "";

    this.viewModel.setTool(isPick ? "pickaxe" : (weapId || "m9"));
    this.currentWeapon = isPick ? null : (WEAPONS[weapId] ?? null);

    if (this.currentWeapon) {
      this.currentAmmo = this.currentWeapon.maxAmmo;
      this.isReloading = false;
      this.isJammed    = false;
      this.viewModel.clearJam();
      this.reloadHUD.style.display = "none";
    }

    if (!item || isPick) {
      this.isAiming = false;
      this.crosshair.classList.remove("aiming");
      this.ammoHUD.textContent = "";
    } else {
      this.updateAmmoHUD();
    }

    this.clearCrack();
    this.isMouseDown = false;
  };
}
