import { Client, Room } from "colyseus.js";
import * as THREE from "three";
import { PlayerAvatar } from "../game/PlayerAvatar";
import type { VoxelTerrain } from "../game/VoxelTerrain";
import { backendUrl } from "../lib/config";

type MatchPhase = "waiting" | "countdown" | "active";

type PlayerSnapshot = {
  displayName?: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  walking: boolean;
  armed: boolean;
  weaponId: string;
  reloading: boolean;
  aiming: boolean;   // true quando está mirando (ADS) — visível para os outros
};

export type ShotEvent = {
  ox: number; oy: number; oz: number; // origin
  dx: number; dy: number; dz: number; // direction (normalized)
  ix: number; iy: number; iz: number; // impact point
  nx: number; ny: number; nz: number; // impact normal
  hit: boolean;
};

type RemotePlayer = {
  avatar: PlayerAvatar;
  state: PlayerSnapshot;
};

export type PlayerStats = {
  kills: number;
  headshots: number;
  mobKills: number;
  points: number;
  name: string;
  isDead: boolean;
  sessionId: string;
  isSelf: boolean;
};

export type LobbyStatus = {
  connected: boolean;
  phase: MatchPhase;
  playerCount: number;
  countdownSeconds: number;
  playerNames: string[];
  errorMessage?: string;
};

export class MultiplayerClient {
  private readonly client: Client;
  private readonly remotePlayers = new Map<string, RemotePlayer>();
  private room?: Room<any>;
  private connected = false;
  private lastSendTime = 0;
  private scene?: THREE.Scene;
  private terrain?: VoxelTerrain;
  private readonly lobbyListeners = new Set<(status: LobbyStatus) => void>();
  private shotListener?: (shot: ShotEvent) => void;
  private readonly playerStats = new Map<string, { kills: number; headshots: number; mobKills: number; points: number; name: string }>();
  private readonly lastAttacker = new Map<string, { id: string; isHeadshot: boolean }>();
  private lobbyStatus: LobbyStatus = {
    connected: false,
    phase: "waiting",
    playerCount: 0,
    countdownSeconds: 0,
    playerNames: [],
    errorMessage: undefined
  };

  constructor(scene?: THREE.Scene) {
    this.scene = scene;
    const backendOrigin = new URL(backendUrl, window.location.origin);
    const wsProtocol = backendOrigin.protocol === "https:" ? "wss:" : "ws:";
    this.client = new Client(`${wsProtocol}//${backendOrigin.host}`);
  }

  async connect(): Promise<void> {
    console.log("[mp] connect() called, displayName=", window.localStorage.getItem("voxel-royale.player-name"));
    try {
      const displayName = window.localStorage.getItem("voxel-royale.player-name") || "Player";
      const reservationResponse = await fetch(`${backendUrl}/api/matchmaking/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ displayName })
      });

      const reservationPayload = await reservationResponse.json();
      if (!reservationResponse.ok) {
        console.error("[matchmaking] reservation failed", {
          status: reservationResponse.status,
          payload: reservationPayload
        });
        throw new Error(reservationPayload?.error || "Falha ao reservar assento na sala.");
      }

      console.log("[matchmaking] seat reservation ok", reservationPayload);
      this.room = await this.client.consumeSeatReservation(reservationPayload);
      this.connected = true;
      this.updateLobbyStatus({ connected: true, errorMessage: undefined });

      this.room.onMessage("lobby:update", (payload) => {
        console.log("[matchmaking] lobby:update", payload);
        this.updateLobbyStatus({
          phase: payload.phase ?? "waiting",
          playerCount: payload.playerCount ?? 1,
          countdownSeconds: payload.countdownSeconds ?? 0,
          playerNames: Array.isArray(payload.playerNames) ? payload.playerNames : []
        });
      });

      this.room.onMessage("players:snapshot", (payload) => {
        console.log("[mp] players:snapshot received, count=", payload?.players?.length);
        this.applySnapshot(Array.isArray(payload?.players) ? payload.players : []);
      });

      this.room.onMessage("match:start", () => {
        console.log("[matchmaking] match:start", {
          roomId: this.room?.roomId,
          sessionId: this.room?.sessionId
        });
        this.updateLobbyStatus({
          phase: "active",
          countdownSeconds: 0
        });
      });



      this.room.onMessage("player:joined", (payload) => {
        this.upsertRemotePlayer(payload?.sessionId, {
          displayName: payload?.displayName,
          ...payload?.player
        });
      });

      this.room.onMessage("player:update", (payload) => {
        this.upsertRemotePlayer(payload?.sessionId, payload?.player);
      });

      this.room.onMessage("player:left", (payload) => {
        this.removeRemotePlayer(payload?.sessionId);
      });

      this.room.onMessage("player:shot", (payload: ShotEvent) => {
        this.shotListener?.(payload);
      });

      this.room.onMessage("player:took_damage", (payload) => {
        // payload: { sessionId, attackerId, damage, part }
        if (payload.attackerId && payload.sessionId) {
          this.lastAttacker.set(payload.sessionId, {
            id: payload.attackerId,
            isHeadshot: payload.part === "head"
          });
        }
        if (payload.sessionId === this.room?.sessionId) {
            this.playerHitListener?.(payload.damage, payload.part === "head", payload.attackerId);
        }
      });

      this.room.onMessage("player:died", (payload) => {
        // Award kill to attacker
        const victimId = payload.sessionId;
        const attackerInfo = this.lastAttacker.get(victimId);
        if (attackerInfo) {
          this.lastAttacker.delete(victimId);
          const attackerId = attackerInfo.id;
          // Only track stats for remote players as attackers (local player kills tracked in GameApp)
          if (attackerId !== this.room?.sessionId) {
            const stats = this.getOrCreateStats(attackerId);
            const isBot = !this.remotePlayers.has(victimId) || (victimId === this.room?.sessionId);
            if (isBot) {
              stats.mobKills++;
              stats.points += 5;
            } else {
              stats.kills++;
              stats.points += attackerInfo.isHeadshot ? 15 : 10;
              if (attackerInfo.isHeadshot) stats.headshots++;
            }
          }
        }

        if (victimId !== this.room?.sessionId) {
            const remote = this.remotePlayers.get(victimId);
            if (remote && !remote.avatar.isDead) {
                remote.avatar.die();
            }
        }
      });

      this.room.onLeave((code) => {
        console.warn("[matchmaking] room left", {
          code,
          roomId: this.room?.roomId,
          sessionId: this.room?.sessionId
        });
        this.connected = false;
        this.updateLobbyStatus({ connected: false });
      });

      this.room.onError((code, message) => {
        console.error("[matchmaking] room error", {
          code,
          message,
          roomId: this.room?.roomId,
          sessionId: this.room?.sessionId
        });
        this.updateLobbyStatus({
          connected: false,
          errorMessage: `Erro ${code}: ${message || "falha ao entrar na sala"}`
        });
      });
    } catch (error) {
      console.error("[matchmaking] connect failed", error);
      this.updateLobbyStatus({
        connected: false,
        phase: "waiting",
        playerCount: 1,
        countdownSeconds: 0,
        playerNames: [],
        errorMessage: error instanceof Error ? error.message : "Falha desconhecida no matchmaking."
      });
    }
  }

  setTerrain(terrain: VoxelTerrain): void {
    this.terrain = terrain;
  }

  update(elapsedTime: number, delta = 0.016): void {
    if (!this.scene) {
      return;
    }

    for (const remote of this.remotePlayers.values()) {
      remote.avatar.updateDead(delta);
      if (!remote.avatar.isDead) {
         // ── Snapping: mantém player remoto dentro de limites do terreno real ──
         let targetCamY = remote.state.y;
         if (this.terrain) {
           const groundH = this.terrain.getSurfaceHeightAt(remote.state.x, remote.state.z, true);
           const minCamY = groundH + 1.8;
           const maxCamY = groundH + 1.8 + 2.5; // até 2.5m acima do chão (pulo máximo ~1.3m + margem)
           if (targetCamY < minCamY) targetCamY = minCamY;
           if (targetCamY > maxCamY) targetCamY = maxCamY;
         }
         const targetFeetY = targetCamY - 1.8;

         // ── Interpolação de posição (lerp) ────────────────────────────────
         // X/Z: lerp rápido (20 Hz de servidor → suaviza entre pacotes)
         // Y: lerp mais agressivo para subida (parece pulo) e descida suave
         const cur = remote.avatar.root.position;
         const lerpXZ = Math.min(1, delta * 18);
         const diffY  = targetFeetY - cur.y;
         // Subida rápida (parece pulo), descida mais suave (gravidade)
         const lerpY  = diffY > 0
           ? Math.min(1, delta * 14)   // sobe rápido = animação de pulo
           : Math.min(1, delta * 10);  // desce suave = queda natural

         remote.avatar.root.position.set(
           cur.x + (remote.state.x - cur.x) * lerpXZ,
           cur.y + diffY * lerpY,
           cur.z + (remote.state.z - cur.z) * lerpXZ
         );

         // ── Rotação suave de yaw ───────────────────────────────────────────
         const yawDiff = remote.state.yaw - remote.avatar.root.rotation.y;
         const yawDiffWrapped = ((yawDiff + Math.PI) % (2 * Math.PI)) - Math.PI;
         remote.avatar.root.rotation.y += yawDiffWrapped * Math.min(1, delta * 16);

         remote.avatar.setWeaponType(remote.state.weaponId);
         remote.avatar.setWeaponVisible(remote.state.armed);
         remote.avatar.animateWalk(remote.state.walking ? 1 : 0, elapsedTime, remote.state.pitch, remote.state.reloading, remote.state.aiming ?? false, delta);
      }
    }
  }

  getRaycastTargets(): THREE.Object3D[] {
     const targets: THREE.Object3D[] = [];
     for (const remote of this.remotePlayers.values()) {
        if (!remote.avatar.isDead) {
           targets.push(...remote.avatar.hitboxes);
        }
     }
     return targets;
  }

  sendPlayerState(snapshot: PlayerSnapshot): void {
    if (!this.connected || !this.room || this.lobbyStatus.phase === "waiting") {
      return;
    }

    const now = performance.now();
    if (now - this.lastSendTime < 50) {
      return;
    }

    this.lastSendTime = now;
    console.log("[pitch:send]", snapshot.pitch.toFixed(4));
    this.room.send("player:update", snapshot);
  }

  sendShot(event: ShotEvent): void {
    if (!this.connected || !this.room || this.lobbyStatus.phase === "waiting") return;
    this.room.send("player:shot", event);
  }

  sendPlayerHit(targetSessionId: string, damage: number, part: string): void {
    if (!this.connected || !this.room) return;
    this.room.send("player:hit", { targetId: targetSessionId, damage, part });
  }

  sendPlayerDied(): void {
    if (!this.connected || !this.room) return;
    this.room.send("player:died");
  }

  onRemoteShot(listener: (shot: ShotEvent) => void): void {
    this.shotListener = listener;
  }

  private playerHitListener?: (damage: number, headshot: boolean, attackerId: string) => void;
  onPlayerHit(listener: (damage: number, headshot: boolean, attackerId: string) => void): void {
      this.playerHitListener = listener;
  }

  getLobbyStatus(): LobbyStatus {
    return { ...this.lobbyStatus };
  }

  /** Retorna snapshot de todos os players remotos conhecidos (para cálculo de spawn seguro) */
  getAllSnapshots(): { x: number; z: number }[] {
    return Array.from(this.remotePlayers.values()).map(r => ({ x: r.state.x, z: r.state.z }));
  }

  /** Lista de players remotos para o scoreboard */
  getAllPlayerInfo(): { sessionId: string; name: string; isDead: boolean }[] {
    return Array.from(this.remotePlayers.entries()).map(([sid, r]) => ({
      sessionId: sid,
      name: r.state.displayName ?? `Player`,
      isDead: r.avatar.isDead
    }));
  }

  getSnapshot(sessionId: string) {
    const remote = this.remotePlayers.get(sessionId);
    return remote ? remote.state : null;
  }

  onLobbyStatusChange(listener: (status: LobbyStatus) => void): () => void {
    this.lobbyListeners.add(listener);
    listener(this.getLobbyStatus());
    return () => {
      this.lobbyListeners.delete(listener);
    };
  }

  disconnect(): void {
    this.connected = false;
    this.room?.leave();
  }

  attachScene(scene: THREE.Scene): void {
    this.scene = scene;
    console.log("[mp] attachScene, remotePlayers=", this.remotePlayers.size);
    for (const remote of this.remotePlayers.values()) {
      this.scene.add(remote.avatar.root);
    }
  }

  private applySnapshot(players: Array<{ sessionId?: string; displayName?: string; player?: any }>): void {
    const seenPlayers = new Set<string>();
    console.log("[mp] applySnapshot", players.length, "players, mySession=", this.room?.sessionId);

    for (const entry of players) {
      if (!entry?.sessionId || !entry.player) {
        continue;
      }

      seenPlayers.add(entry.sessionId);
      this.upsertRemotePlayer(entry.sessionId, {
        displayName: entry.displayName,
        ...entry.player
      });
    }

    for (const sessionId of this.remotePlayers.keys()) {
      if (!seenPlayers.has(sessionId)) {
        this.removeRemotePlayer(sessionId);
      }
    }
  }

  private upsertRemotePlayer(sessionId: string | undefined, snapshotLike: any): void {
    if (!sessionId || !this.room || sessionId === this.room.sessionId) {
      return;
    }

    const snapshot = this.toSnapshot(snapshotLike);
    const existing = this.remotePlayers.get(sessionId);
    if (existing) {
      // Preserve displayName — player:update messages don't include it
      existing.state = { ...snapshot, displayName: snapshot.displayName ?? existing.state.displayName };
      // Keep stats name in sync when we do have a name
      if (snapshot.displayName) {
        const stats = this.playerStats.get(sessionId);
        if (stats) stats.name = snapshot.displayName;
      }
      return;
    }

    console.log("[mp] creating avatar for", sessionId, "at", snapshot.x, snapshot.y, snapshot.z, "scene=", !!this.scene);
    const avatar = new PlayerAvatar();
    // Posição inicial exata (sem lerp) para não surgir do chão
    const initGroundH = this.terrain?.getSurfaceHeightAt(snapshot.x, snapshot.z, true) ?? 0;
    const initFeetY   = Math.max(snapshot.y - 1.8, initGroundH);
    avatar.root.position.set(snapshot.x, initFeetY, snapshot.z);
    avatar.root.rotation.y = snapshot.yaw;
    avatar.setWeaponType(snapshot.weaponId);
    avatar.setWeaponVisible(snapshot.armed);
    if (this.scene) {
      this.scene.add(avatar.root);
    }
    avatar.setSessionId(sessionId);
    this.remotePlayers.set(sessionId, {
      avatar,
      state: snapshot
    });
  }

  private removeRemotePlayer(sessionId: string | undefined): void {
    if (!sessionId) {
      return;
    }

    const remote = this.remotePlayers.get(sessionId);
    if (!remote) {
      return;
    }

    if (this.scene) {
      this.scene.remove(remote.avatar.root);
    }
    this.remotePlayers.delete(sessionId);
  }

  private toSnapshot(player: any): PlayerSnapshot {
    return {
      displayName: player.displayName,
      x: Number(player?.x) || 0,
      y: Number(player?.y) || 0,
      z: Number(player?.z) || 0,
      yaw: Number(player?.yaw) || 0,
      pitch: Number(player?.pitch) || 0,
      walking: Boolean(player?.walking),
      armed: Boolean(player?.armed),
      weaponId: typeof player?.weaponId === "string" ? player.weaponId : "",
      reloading: Boolean(player?.reloading),
      aiming: Boolean(player?.aiming)
    };
  }

  private getOrCreateStats(sessionId: string): { kills: number; headshots: number; mobKills: number; points: number; name: string } {
    let s = this.playerStats.get(sessionId);
    if (!s) {
      const remote = this.remotePlayers.get(sessionId);
      s = { kills: 0, headshots: 0, mobKills: 0, points: 0, name: remote?.state.displayName ?? "Player" };
      this.playerStats.set(sessionId, s);
    }
    return s;
  }

  /** Returns all known player stats for the scoreboard, sorted by points descending */
  getAllPlayerStats(): PlayerStats[] {
    const result: PlayerStats[] = [];
    for (const [sid, remote] of this.remotePlayers.entries()) {
      const stats = this.playerStats.get(sid) ?? { kills: 0, headshots: 0, mobKills: 0, points: 0, name: remote.state.displayName ?? "Player" };
      result.push({
        sessionId: sid,
        name: remote.state.displayName ?? stats.name ?? "Player",
        isDead: remote.avatar.isDead,
        isSelf: false,
        kills: stats.kills,
        headshots: stats.headshots,
        mobKills: stats.mobKills,
        points: stats.points
      });
    }
    return result.sort((a, b) => b.points - a.points);
  }

  private updateLobbyStatus(partial: Partial<LobbyStatus>): void {
    this.lobbyStatus = {
      ...this.lobbyStatus,
      ...partial
    };

    for (const listener of this.lobbyListeners) {
      listener(this.getLobbyStatus());
    }
  }
}
