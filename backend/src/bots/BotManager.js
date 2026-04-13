/**
 * BotManager — IA de bots que simulam jogadores humanos reais.
 *
 * Cada bot roda no servidor e emite player:update/player:shot como um
 * cliente real faria. Clientes normais enxergam os bots como avatares
 * idênticos a jogadores humanos.
 *
 * Máquina de estados por bot:
 *   WANDERING  → anda aleatoriamente pelo mapa explorando
 *   HUNTING    → detectou inimigo, se aproxima
 *   COMBAT     → está atirando num alvo
 *   RELOADING  → recarregando a arma
 *   FLEEING    → HP < 30%, foge e busca cobertura
 *   LOOTING    → se move em direção a um ponto de loot
 */

/** Gera nome no mesmo formato que um jogador guest normal (Visitante-XXXXXX) */
function randomBotGuestName() {
  const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, "0");
  return `Visitante-${hex}`;
}

const WEAPON_IDS    = ["m9", "ak47", "m4a1", "spas12", "awp"];
const TICK_RATE_MS  = 100;  // atualização dos bots a 10Hz
const DETECT_RANGE  = 40;   // metros para detectar inimigo (reduzido para ser mais justo)
const ATTACK_RANGE  = 28;   // metros para abrir fogo (reduzido: ~28m de combate)
const FLEE_HP       = 30;   // HP abaixo do qual foge
const RELOAD_TIME   = 2500; // ms de reload
const REACTION_MIN  = 350;  // ms de delay mínimo de reação (mais humano)
const REACTION_MAX  = 800;  // ms de delay máximo

// Ruído de Perlin simplificado (suaviza movimento)
function smoothNoise(seed, t) {
  const s = Math.sin(seed * 127.1 + t * 1.3) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Estimativa suave da altura do terreno para física dos bots no servidor.
 * Usa senos de BAIXA frequência para garantir transições suaves entre posições
 * vizinhas — evita bouncing ao se mover. Não replica árvores.
 * O cliente faz snapping fino; aqui só precisamos de um piso razoável.
 */
function getBotGroundHeight(x, z) {
  const WORLD_SIZE = 512;
  const nx = x / (WORLD_SIZE * 0.5);
  const nz = z / (WORLD_SIZE * 0.5);
  const radial     = Math.sqrt(nx * nx + nz * nz);
  const islandMask = Math.max(0, 1 - radial * 1.05);

  // Senos de baixa frequência: contínuos e suaves entre pontos vizinhos
  const h1 = Math.sin(nx * Math.PI * 2.4 + 1.1) * Math.cos(nz * Math.PI * 2.4 + 0.7);
  const h2 = Math.sin(nx * Math.PI * 5.1 + 2.3) * Math.cos(nz * Math.PI * 5.1 + 1.9);

  const shaped = 3 + islandMask * 6 + (h1 * 0.55 + h2 * 0.2) * 5;
  // Clamp conservador: bots não devem ter chão acima de 18 (abaixo da maioria dos tops de árvore)
  return Math.max(2, Math.min(18, shaped));
}

function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function dist3D(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Normaliza vetor 3D. Retorna {x,y,z} unit. */
function normalize3(dx, dy, dz) {
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
  return { x: dx/len, y: dy/len, z: dz/len };
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
class Bot {
  constructor(id, displayName, spawnX, spawnZ) {
    this.id          = id;         // sessionId fake (ex: "bot_0")
    this.displayName = displayName;

    // Estado de jogo
    this.x       = spawnX;
    this.z       = spawnZ;
    this.y       = getBotGroundHeight(spawnX, spawnZ) + 1.8 + 2; // acima do chão
    this.yaw     = Math.random() * Math.PI * 2;
    this.pitch   = 0;
    this.hp      = 100;
    this.isDead  = false;

    // Arma
    this.weaponId    = randomFrom(WEAPON_IDS);
    this.ammo        = 30;
    this.maxAmmo     = 30;
    this.armed       = true;
    this.reloading   = false;
    this.aiming      = false;

    // Máquina de estados
    this.state       = "wandering";
    this.targetId    = null;   // ID do player/bot alvo
    this.wanderAngle = Math.random() * Math.PI * 2;
    this.wanderTimer = 0;

    // Timers/delays
    this.reloadTimer    = 0;
    this.reactionTimer  = 0;
    this.sightTimer     = 0;  // tempo que está vendo o alvo atual
    this.stateTimer     = 0;
    this.shootCooldown  = 0;
    this.noiseSeed      = Math.random() * 1000;
    this.t              = 0;

    // Simulação de física básica
    this.vy            = 0;
    this._onGround     = false;
    this.walking       = false;
    this._wanderPaused = false;
    this._deadTimer    = 0;     // tempo morto (para respawn)
    this._smoothGroundY = getBotGroundHeight(spawnX, spawnZ); // piso suavizado
  }

  /** Retorna snapshot no formato do player:update */
  snapshot() {
    return {
      x:         this.x,
      y:         this.y,
      z:         this.z,
      yaw:       this.yaw,
      pitch:     this.pitch,
      walking:   this.walking,
      armed:     this.armed,
      weaponId:  this.weaponId,
      reloading: this.reloading,
      aiming:    this.aiming
    };
  }

  /** Renascer após morte */
  respawn() {
    const angle  = Math.random() * Math.PI * 2;
    const dist   = 15 + Math.random() * 50;
    this.x       = Math.cos(angle) * dist;
    this.z       = Math.sin(angle) * dist;
    const rg     = getBotGroundHeight(this.x, this.z);
    this._smoothGroundY = rg;
    this.y       = rg + 1.8 + 1;
    this.yaw     = Math.random() * Math.PI * 2;
    this.pitch   = 0;
    this.hp      = 100;
    this.isDead  = false;
    this._deadTimer = 0;
    this.vy      = 0;
    this._onGround = false;
    this.state   = "wandering";
    this.targetId = null;
    this.aiming  = false;
    this.ammo    = this.maxAmmo;
    this.reloading = false;
    this.reactionTimer = 0;
    this.sightTimer = 0;
    this.stateTimer = 0;
  }

  /** Damage recebido de tiro */
  takeDamage(amount, part) {
    if (this.isDead) return;
    const dmg = part === "head" ? 9999 : amount;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp    = 0;
      this.isDead = true;
    }
  }

  /**
   * Atualiza IA do bot
   * @param {number} dt  delta em segundos
   * @param {Map<string, {x,z,y,hp,isDead}>} allPlayers todos os snapshots
   * @returns {Array<{type,payload}>} eventos a emitir (shot, died, etc.)
   */
  update(dt, allPlayers) {
    if (this.isDead) return [];
    const events = [];
    this.t += dt;
    this.stateTimer += dt;

    // ── Rebuild lista de alvos possíveis ─────────────────────────────────
    const enemies = [];
    for (const [id, p] of allPlayers) {
      if (id === this.id || p.isDead) continue;
      const d = dist2D(this.x, this.z, p.x, p.z);
      enemies.push({ id, ...p, dist: d });
    }

    // ── Transições de estado ─────────────────────────────────────────────
    if (this.hp < FLEE_HP && this.state !== "fleeing") {
      this.state       = "fleeing";
      this.stateTimer  = 0;
      this.targetId    = null;
    }

    if (this.state !== "fleeing" && this.state !== "reloading") {
      // Procura inimigo mais próximo ao alcance
      const nearest = enemies.filter(e => e.dist < DETECT_RANGE)
                             .sort((a, b) => a.dist - b.dist)[0];
      if (nearest) {
        if (this.state === "wandering" || this.state === "looting") {
          this.state       = "hunting";
          this.stateTimer  = 0;
          this.reactionTimer = REACTION_MIN + Math.random() * (REACTION_MAX - REACTION_MIN);
          this.sightTimer  = 0; // Reset só ao detectar novo alvo (saindo do wander)
        } else if (nearest.id !== this.targetId) {
          // Trocou de alvo: reinicia sightTimer
          this.sightTimer = 0;
        }
        this.targetId = nearest.id;
      } else if (this.state === "hunting" || this.state === "combat") {
        // Perdeu o alvo
        this.state    = "wandering";
        this.targetId = null;
        this.aiming   = false;
        this.sightTimer = 0;
      }
    }

    // ── Reload ───────────────────────────────────────────────────────────
    if (this.reloading) {
      this.reloadTimer -= dt * 1000;
      if (this.reloadTimer <= 0) {
        this.reloading   = false;
        this.ammo        = this.maxAmmo;
        if (this.targetId) this.state = "hunting"; else this.state = "wandering";
      }
      this.walking = false;
      return events;
    }

    if (this.ammo <= 0 && !this.reloading) {
      this.reloading   = true;
      this.reloadTimer = RELOAD_TIME + Math.random() * 800; // variação humana
      this.state       = "reloading";
      this.aiming      = false;
      return events;
    }

    // ── Comportamento por estado ─────────────────────────────────────────
    const SPEED_WALK   = 3.5;
    const SPEED_RUN    = 5.8;
    const SPEED_FLEE   = 6.2;

    let moveX = 0, moveZ = 0;

    if (this.state === "wandering") {
      // Muda direção a cada 3-7s
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderAngle = Math.random() * Math.PI * 2;
        this.wanderTimer = 3 + Math.random() * 4;
        // Às vezes para brevemente (olha ao redor)
        if (Math.random() < 0.15) {
          this.wanderTimer = 0.8 + Math.random() * 1.5;
          this._wanderPaused = true;
        } else {
          this._wanderPaused = false;
        }
      }
      if (!this._wanderPaused) {
        // Errância com ruído suave — curva gradual, não teleporte de direção
        const noiseYaw = smoothNoise(this.noiseSeed, this.t * 0.25) * 0.5;
        this.yaw = this.wanderAngle + noiseYaw;
        moveX = Math.sin(this.yaw) * SPEED_WALK;
        moveZ = Math.cos(this.yaw) * SPEED_WALK;
        this.walking = true;

        // Pulo ocasional enquanto explora (obstáculos)
        if (this._onGround && Math.random() < 0.001) {
          this.vy = 7.5;
          this._onGround = false;
        }
      } else {
        // Parado: vira devagar olhando ao redor
        this.yaw += dt * 0.8;
        this.walking = false;
      }
      this.aiming = false;

    } else if (this.state === "hunting") {
      const target = allPlayers.get(this.targetId);
      if (!target || target.isDead) { 
        this.state = "wandering"; 
        this.targetId = null;
        return events; 
      }

      // Vira para o alvo suavemente (humano não vira instantâneo)
      const desiredYaw = Math.atan2(target.x - this.x, target.z - this.z);
      const yawDiff    = ((desiredYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += yawDiff * Math.min(1, dt * 3.5); // yaw lerp humano

      const d = dist2D(this.x, this.z, target.x, target.z);
      if (d > ATTACK_RANGE) {
        // Corre em direção ao alvo
        this.walking = true;
        moveX = Math.sin(this.yaw) * SPEED_RUN;
        moveZ = Math.cos(this.yaw) * SPEED_RUN;
      } else {
        this.state = "combat";
        this.walking = false;
      }

    } else if (this.state === "combat") {
      const target = allPlayers.get(this.targetId);
      if (!target || target.isDead) {
        this.state = "wandering";
        this.targetId = null;
        this.aiming = false;
        return events;
      }

      const d = dist2D(this.x, this.z, target.x, target.z);

      // Mira com tremor de mão (Perlin noise na pitch/yaw)
      const desiredYaw   = Math.atan2(target.x - this.x, target.z - this.z);
      const jitterYaw    = smoothNoise(this.noiseSeed + 10, this.t * 4) * 0.04;
      const jitterPitch  = smoothNoise(this.noiseSeed + 20, this.t * 4) * 0.03;
      const yawDiff      = ((desiredYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw          += (yawDiff + jitterYaw) * Math.min(1, dt * 5);
      this.pitch         = -0.1 + jitterPitch;
      this.aiming        = true;

      // ── Movimento humano em combate ──────────────────────────────────
      // Strafe lateral com ruído lento
      const strafeNoise  = smoothNoise(this.noiseSeed + 30, this.t * 0.5);
      const advanceNoise = smoothNoise(this.noiseSeed + 40, this.t * 0.3);
      const strafeAngle  = this.yaw + Math.PI / 2;
      const fwdAngle     = this.yaw;

      // Strafe lateral
      moveX += Math.sin(strafeAngle) * strafeNoise * SPEED_WALK * 0.8;
      moveZ += Math.cos(strafeAngle) * strafeNoise * SPEED_WALK * 0.8;

      // Avança/recua dependendo da distância e ruído
      const preferredDist = 14; // distância ideal de combate
      if (d > preferredDist + 4) {
        // Longe: avança em direção ao alvo enquanto atira
        moveX += Math.sin(fwdAngle) * SPEED_WALK * 0.7;
        moveZ += Math.cos(fwdAngle) * SPEED_WALK * 0.7;
      } else if (d < preferredDist - 4) {
        // Perto demais: recua
        moveX -= Math.sin(fwdAngle) * SPEED_WALK * 0.6;
        moveZ -= Math.cos(fwdAngle) * SPEED_WALK * 0.6;
      } else {
        // Na distância ideal: strafe puro + pequena variação
        moveX += Math.sin(fwdAngle) * advanceNoise * SPEED_WALK * 0.3;
        moveZ += Math.cos(fwdAngle) * advanceNoise * SPEED_WALK * 0.3;
      }

      this.walking = (moveX * moveX + moveZ * moveZ) > 0.5;

      // Pulo aleatório em combate (esquiva humana — ~1x a cada 5s)
      if (this._onGround && Math.random() < 0.004) {
        this.vy = 7.5;
        this._onGround = false;
      }

      // Se muito longe, volta a caçar
      if (d > DETECT_RANGE * 1.2) {
        this.state  = "hunting";
        this.aiming = false;
      }

      // Delay de reação + tempo de mira antes de começar a atirar
      this.sightTimer += dt;
      if (this.reactionTimer > 0) {
        this.reactionTimer -= dt * 1000;
      } else if (this.sightTimer > 0.8) { // 0.8s para "aquisição de alvo"
        // Abre fogo!
        this.shootCooldown -= dt * 1000;
        if (this.shootCooldown <= 0) {
          const fireCooldownMs = this.weaponId === "sniper" ? 1800 :
                                 this.weaponId === "shotgun" ? 900 :
                                 this.weaponId === "ak47"    ? 110 :
                                 this.weaponId === "m4a1"    ? 90  : 180;
          this.shootCooldown = fireCooldownMs + Math.random() * 80;
          this.ammo--;

          // Precisão por arma + distância
          const accuracy = this.weaponId === "sniper" ? 0.80 :
                           this.weaponId === "shotgun" ? 0.60 :
                           0.50;
          // Bot acerta menos de longe, mas com variação — não é perfeito
          const hitChance  = accuracy * Math.max(0.1, 1 - (d / ATTACK_RANGE) * 0.9);
          const isHit      = Math.random() < hitChance;
          const isHeadshot = isHit && Math.random() < 0.08; // 8% headshot

          events.push({
            type: "shot",
            payload: {
              shooterId: this.id,
              targetId:  isHit ? this.targetId : null,
              part:      isHeadshot ? "head" : "body",
              damage:    isHeadshot ? 9999 : (
                           this.weaponId === "sniper"  ? 80 :
                           this.weaponId === "shotgun" ? 35 :
                           this.weaponId === "ak47"    ? 28 :
                           this.weaponId === "m4a1"    ? 24 : 22
                         ),
              ox: this.x, oy: this.y + 1.6, oz: this.z,
              tx: target.x, ty: (target.y ?? this.y) + 1.0, tz: target.z,
              hit: isHit
            }
          });
        }
      }

    } else if (this.state === "fleeing") {
      // Foge na direção oposta ao inimigo mais próximo
      const nearest = enemies.sort((a, b) => a.dist - b.dist)[0];
      if (nearest) {
        const fleeYaw = Math.atan2(this.x - nearest.x, this.z - nearest.z);
        const yawDiff = ((fleeYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        this.yaw += yawDiff * Math.min(1, dt * 4);
      }
      moveX    = Math.sin(this.yaw) * SPEED_FLEE;
      moveZ    = Math.cos(this.yaw) * SPEED_FLEE;
      this.walking = true;
      this.aiming  = false;
      // Recupera coragem após 8s fugindo
      if (this.stateTimer > 8) {
        this.hp    = Math.min(100, this.hp + 20); // curou um pouco
        this.state = "wandering";
        this.stateTimer = 0;
      }
    }

    // ── Física simples ───────────────────────────────────────────────────
    this.x += moveX * dt;
    this.z += moveZ * dt;
    // Mantém fora de coordenadas absurdas
    this.x = Math.max(-240, Math.min(240, this.x));
    this.z = Math.max(-240, Math.min(240, this.z));

    // Gravidade com chão suavizado (lerp para evitar saltos bruscos entre ticks)
    const rawGroundY = getBotGroundHeight(this.x, this.z);
    this._smoothGroundY += (rawGroundY - this._smoothGroundY) * Math.min(1, dt * 6);
    const groundCamY = this._smoothGroundY + 1.8; // câmera = pés + 1.8
    this.vy -= 22 * dt;
    this.y  += this.vy * dt;
    if (this.y <= groundCamY) {
      this.y  = groundCamY;
      this.vy = 0;
      this._onGround = true;
    } else {
      this._onGround = false;
    }

    // Pulo ocasional enquanto anda (parece humano)
    if (this._onGround && Math.random() < 0.002) {
      this.vy = 7.5;
      this._onGround = false;
    }

    return events;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export class BotManager {
  constructor(room) {
    this.room    = room;
    this.bots    = new Map();  // id → Bot
    this.interval = null;
  }

  /** Preenche até `targetCount` bots. Chamado ao iniciar a partida. */
  fillBots(targetCount) {
    const humanCount = this.room.clients.length;
    const botCount   = Math.max(0, targetCount - humanCount);
    console.log(`[BotManager] spawning ${botCount} bots (${humanCount} humans in room)`);

    for (let i = 0; i < botCount; i++) {
      const id          = `bot_${Date.now()}_${i}`;
      const name        = randomBotGuestName();
      const spawnX      = (Math.random() - 0.5) * 80;
      const spawnZ      = (Math.random() - 0.5) * 80;
      const bot         = new Bot(id, name, spawnX, spawnZ);

      this.bots.set(id, bot);
      this.room.playerNames.set(id, name);
      this.room.playerSnapshots.set(id, bot.snapshot());

      // Anuncia chegada do bot como se fosse um player normal
      this.room.broadcast("player:joined", {
        sessionId:   id,
        displayName: name,
        player:      bot.snapshot()
      });
    }

    this._startTick();
  }

  _startTick() {
    if (this.interval) return;
    let lastMs = Date.now();

    this.interval = this.room.clock.setInterval(() => {
      const now = Date.now();
      const dt  = Math.min((now - lastMs) / 1000, 0.1);
      lastMs    = now;

      // Snapshot de todos os players (humanos + bots) visíveis pelos bots
      const allPlayers = new Map();
      for (const [id, snap] of this.room.playerSnapshots) {
        allPlayers.set(id, { ...snap, isDead: snap.isDead ?? false });
      }
      for (const [id, bot] of this.bots) {
        allPlayers.set(id, { x: bot.x, y: bot.y, z: bot.z, hp: bot.hp, isDead: bot.isDead });
      }

      for (const [id, bot] of this.bots) {
        if (bot.isDead) {
          // Conta tempo morto e respawna após 8s
          bot._deadTimer += dt;
          if (bot._deadTimer >= 8) {
            bot.respawn();
            // Notifica clientes: remove o avatar morto e recria vivo
            this.room.broadcast("player:left",   { sessionId: id });
            this.room.broadcast("player:joined", {
              sessionId:   id,
              displayName: this.room.playerNames.get(id),
              player:      bot.snapshot()
            });
            this.room.playerSnapshots.set(id, { ...bot.snapshot(), isDead: false });
          }
          continue;
        }

        const events = bot.update(dt, allPlayers);
        const snap   = bot.snapshot();

        // Atualiza snapshot no servidor
        this.room.playerSnapshots.set(id, { ...snap, isDead: false });

        // Transmite posição/estado como um player:update normal
        this.room.broadcast("player:update", {
          sessionId: id,
          player:    snap
        });

        // Processa eventos (tiros)
        for (const evt of events) {
          if (evt.type === "shot") {
            const { payload } = evt;

            // Calcula direção real 3D: bot-eye → target-eye
            const eyeY  = payload.oy;  // já é bot.y + 1.6
            const tgtX  = payload.tx, tgtY = payload.ty, tgtZ = payload.tz;
            // Adiciona jitter de mira sobre a direção real
            const rawDir = normalize3(tgtX - payload.ox, tgtY - eyeY, tgtZ - payload.oz);
            const jX = (Math.random() - 0.5) * 0.04;
            const jY = (Math.random() - 0.5) * 0.04;
            const jZ = (Math.random() - 0.5) * 0.04;
            const dir = normalize3(rawDir.x + jX, rawDir.y + jY, rawDir.z + jZ);

            // Ponto de impacto: posição real do alvo (ou ponto na direção se miss)
            const RANGE = 200;
            const ix = payload.hit ? tgtX : payload.ox + dir.x * RANGE;
            const iy = payload.hit ? tgtY : eyeY       + dir.y * RANGE;
            const iz = payload.hit ? tgtZ : payload.oz + dir.z * RANGE;

            // Efeito visual do tiro para todos
            this.room.broadcast("player:shot", {
              ox: payload.ox, oy: eyeY,   oz: payload.oz,
              dx: dir.x,      dy: dir.y,  dz: dir.z,
              ix,             iy,         iz,
              hit: payload.hit,
              // Inclui atacante para indicador de dano
              attackerId: payload.shooterId
            });

            if (payload.hit && payload.targetId) {
              // Aplica dano ao alvo
              const targetBot = this.bots.get(payload.targetId);
              if (targetBot) {
                // Alvo é outro bot
                const wasAlive = !targetBot.isDead;
                targetBot.takeDamage(payload.damage, payload.part);
                this.room.broadcast("player:took_damage", {
                  sessionId:  payload.targetId,
                  attackerId: id,
                  damage:     payload.damage,
                  part:       payload.part
                });
                if (wasAlive && targetBot.isDead) {
                  this.room.broadcast("player:died", { sessionId: payload.targetId });
                  this.room.playerSnapshots.set(payload.targetId, { ...targetBot.snapshot(), isDead: true });
                }
              } else {
                // Alvo é humano — manda dano para ele
                this.room.broadcast("player:took_damage", {
                  sessionId:  payload.targetId,
                  attackerId: id,
                  damage:     payload.damage,
                  part:       payload.part
                });
              }
            }
          }
        }
      }
    }, TICK_RATE_MS);
  }

  /** Chamado quando um bot ou player humano toma dano */
  onPlayerHit(targetId, damage, part, attackerId) {
    const bot = this.bots.get(targetId);
    if (!bot || bot.isDead) return;

    const wasAlive = !bot.isDead;
    bot.takeDamage(damage, part);

    if (wasAlive && bot.isDead) {
        this.room.broadcast("player:died", { sessionId: targetId });
        this.room.playerSnapshots.set(targetId, { ...bot.snapshot(), isDead: true });
    } else {
        // Reação imediata: pula ao levar tiro (esquiva instintiva)
        if (bot._onGround && Math.random() < 0.6) {
            bot.vy = 7.5;
            bot._onGround = false;
        }
        // Se o bot sobreviveu, ele "se vira" para quem o atacou se for neutro
        if (bot.state === "wandering" || bot.state === "looting") {
            bot.targetId      = attackerId;
            bot.state         = "hunting";
            bot.reactionTimer = 150; // reação rápida ao ser atingido
            bot.sightTimer    = 0;
        }
    }
  }

  /** Notifica morte de um player humano para os bots reagirem */
  onPlayerDied(sessionId) {
    for (const bot of this.bots.values()) {
      if (bot.targetId === sessionId) {
        bot.state    = "wandering";
        bot.targetId = null;
        bot.aiming   = false;
      }
    }
  }

  destroy() {
    if (this.interval) {
      this.interval.clear();
      this.interval = null;
    }
    // Remove bots do snapshot
    for (const id of this.bots.keys()) {
      this.room.playerSnapshots.delete(id);
      this.room.playerNames.delete(id);
      this.room.broadcast("player:left", { sessionId: id });
    }
    this.bots.clear();
  }
}
