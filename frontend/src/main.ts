import "./style.css";
import { GameApp } from "./game/GameApp";
import { MultiplayerClient, type LobbyStatus } from "./network/MultiplayerClient";
import { LobbyScreen } from "./ui/LobbyScreen";
import {
  bootstrapState,
  equipSkin,
  initializeAuthFromUrl,
  onAuthChange,
  signInWithGoogle,
  signOut,
  type BootstrapState,
  type CatalogItem
} from "./lib/session";

const container = document.querySelector<HTMLDivElement>("#app");

if (!container) {
  throw new Error("Elemento #app nao encontrado.");
}

const launcher = document.createElement("div");
launcher.className = "launcher";
launcher.innerHTML = `
  <div class="launcher__backdrop"></div>
  <div class="launcher__content">
    <section class="launcher__hero">
      <span class="launcher__eyebrow">🎮 Battle Royale · Multiplayer · Sem Download</span>
      <h1 class="launcher__title">VOXEL<br>ROYALE</h1>
      <p class="launcher__subtitle">15 jogadores, tempestade, armas e bots IA. Jogue agora no navegador — sem login, sem espera.</p>
      <div class="launcher__feature-pills">
        <span>🪖 15 Jogadores</span>
        <span>🌀 Tempestade</span>
        <span>🤖 Bots IA</span>
        <span>📱 Mobile</span>
        <span>🆓 Grátis</span>
      </div>
      <div class="launcher__actions">
        <button id="btn-play" class="launcher__button launcher__button--primary">⚡ Jogar Agora</button>
        <button id="btn-login" class="launcher__button launcher__button--secondary">Entrar com Google</button>
        <button id="btn-logout" class="launcher__button launcher__button--ghost" hidden>Sair</button>
      </div>
      <p id="launcher-message" class="launcher__message">Carregando perfil e loja...</p>
    </section>
    <section class="launcher__panel">
      <div class="launcher__status">
        <div>
          <span class="launcher__label">👤 Sessão</span>
          <strong id="session-name">Conectando...</strong>
        </div>
        <div>
          <span class="launcher__label">📢 Anúncios</span>
          <strong id="ads-status">Verificando...</strong>
        </div>
        <div>
          <span class="launcher__label">⭐ Plano</span>
          <strong id="vip-status">Carregando...</strong>
        </div>
      </div>
      <div>
        <div class="launcher__panel-title">🎨 Loja de Skins</div>
        <div class="launcher__panel-subtitle">Personalize seu personagem. Skins e VIP ficam salvos na sua conta.</div>
      </div>
      <div id="shop-grid" class="shop-grid"></div>
    </section>
  </div>
`;
document.body.appendChild(launcher);

const lobbyScreen = new LobbyScreen();
document.body.appendChild(lobbyScreen.root);

const btnPlay = document.getElementById("btn-play") as HTMLButtonElement;
const btnLogin = document.getElementById("btn-login") as HTMLButtonElement;
const btnLogout = document.getElementById("btn-logout") as HTMLButtonElement;
const sessionName = document.getElementById("session-name") as HTMLSpanElement;
const adsStatus = document.getElementById("ads-status") as HTMLSpanElement;
const vipStatus = document.getElementById("vip-status") as HTMLSpanElement;
const launcherMessage = document.getElementById("launcher-message") as HTMLParagraphElement;
const shopGrid = document.getElementById("shop-grid") as HTMLDivElement;

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

let appState: BootstrapState | null = null;
let game: GameApp | null = null;
let isSearchingMatch = false;
let gameStarted = false;
let matchmakingClient: MultiplayerClient | null = null;

function resetMatchmaking(): void {
  matchmakingClient?.disconnect();
  matchmakingClient = null;
  isSearchingMatch = false;
  gameStarted = false;
  btnPlay.textContent = "Procurar Partida";
  btnPlay.disabled = false;
  btnLogin.disabled = false;
  btnLogout.disabled = false;
  launcherMessage.textContent = "Partida cancelada.";
}

function getSkinAction(item: CatalogItem, state: BootstrapState): string {
  if (state.mode === "guest") {
    return "Entre para comprar";
  }

  const owned = item.id ? state.profile?.owned_skin_ids.includes(item.id) : false;
  const equipped = item.id ? state.profile?.equipped_skin_id === item.id : false;

  if (equipped) {
    return "Equipada";
  }

  if (owned) {
    return "Equipar";
  }

  if (item.is_vip_only) {
    return "Exclusiva VIP";
  }

  return "Checkout depois";
}

function renderState(state: BootstrapState): void {
  let playerName = state.mode === "authenticated"
    ? state.profile?.display_name ?? "Conta"
    : state.guest?.display_name ?? "";
  if (!playerName) {
    const guestId = window.localStorage.getItem("voxel-royale.guest-id") ?? crypto.randomUUID();
    window.localStorage.setItem("voxel-royale.guest-id", guestId);
    playerName = `Visitante-${guestId.slice(0, 6)}`;
  }

  window.localStorage.setItem("voxel-royale.player-name", playerName);
  sessionName.textContent = state.mode === "authenticated"
    ? playerName
    : playerName;
  adsStatus.textContent = state.ads_enabled ? "Ativos no plano atual" : "Desativados";
  vipStatus.textContent = state.profile?.is_vip ? "VIP" : "Free";
  btnLogin.hidden = state.mode === "authenticated";
  btnLogout.hidden = state.mode !== "authenticated";

  shopGrid.innerHTML = "";

  for (const item of state.catalog) {
    const card = document.createElement("article");
    card.className = "shop-card";

    const owned = item.id ? state.profile?.owned_skin_ids.includes(item.id) : false;
    const equipped = item.id ? state.profile?.equipped_skin_id === item.id : false;
    const canEquip = state.mode === "authenticated" && owned && !equipped && !!item.id;

    card.innerHTML = `
      <div class="shop-card__swatch" style="background:${item.preview_color}"></div>
      <div class="shop-card__meta">
        <span class="shop-card__rarity">${item.rarity}</span>
        <h3>${item.name}</h3>
        <p>${item.description}</p>
      </div>
      <div class="shop-card__footer">
        <strong>${item.price_brl > 0 ? currency.format(item.price_brl / 100) : "Gratis"}</strong>
        <button class="launcher__button launcher__button--ghost shop-card__button" ${canEquip ? "" : "disabled"}>${getSkinAction(item, state)}</button>
      </div>
    `;

    const button = card.querySelector("button");
    if (button && canEquip && item.id) {
      const skinId = item.id;
      button.addEventListener("click", async () => {
        button.setAttribute("disabled", "true");
        launcherMessage.textContent = "Equipando skin...";

        try {
          const profile = await equipSkin(skinId);
          appState = { ...state, profile };
          renderState(appState);
          launcherMessage.textContent = "Skin equipada com sucesso.";
        } catch (error) {
          launcherMessage.textContent = error instanceof Error ? error.message : "Nao foi possivel equipar a skin.";
          button.removeAttribute("disabled");
        }
      });
    }

    shopGrid.appendChild(card);
  }
}

async function refreshState(): Promise<void> {
  launcherMessage.textContent = "Sincronizando com Supabase...";

  try {
    appState = await bootstrapState();
    renderState(appState);
    launcherMessage.textContent = appState.mode === "authenticated"
      ? "Conta conectada. Compras e VIP podem ser vinculados a esta sessao."
      : "Modo convidado ativo. O login continua opcional.";
  } catch (error) {
    launcherMessage.textContent = "Servidor offline. Voce pode jogar como convidado.";
    // Garante que haja um nome de convidado para o matchmaking mesmo sem backend
    if (!window.localStorage.getItem("voxel-royale.player-name")) {
      const guestId = window.localStorage.getItem("voxel-royale.guest-id") ?? crypto.randomUUID();
      window.localStorage.setItem("voxel-royale.guest-id", guestId);
      window.localStorage.setItem("voxel-royale.player-name", `Visitante-${guestId.slice(0, 6)}`);
    }
    // Botão play continua disponível mesmo sem sessão
    btnPlay.disabled = false;
  }
}


async function initializeApp(): Promise<void> {
  launcherMessage.textContent = "Validando retorno do login...";
  const authResult = await initializeAuthFromUrl();

  if (authResult.error) {
    launcherMessage.textContent = `Falha no login Google: ${authResult.error}`;
  }

  await refreshState();
}

btnPlay.addEventListener("click", () => {
  if (isSearchingMatch) {
    return;
  }

  isSearchingMatch = true;
  btnPlay.textContent = "Buscando sala...";
  btnPlay.disabled = true;
  btnLogin.disabled = true;
  btnLogout.disabled = true;

  lobbyScreen.show();

  lobbyScreen.onCancel(() => {
    lobbyScreen.hide();
    resetMatchmaking();
  });

  const handleLobbyStatus = (status: LobbyStatus) => {
    lobbyScreen.update(status);

    if (status.phase === "active" && !gameStarted) {
      gameStarted = true;
      const clientForGame = matchmakingClient;
      lobbyScreen.transitionToGame(() => {
        launcher.remove();
        lobbyScreen.root.remove();
        game = new GameApp(container, {
          multiplayerClient: clientForGame ?? undefined
        });
        game.start();
      });
      return;
    }

    if (!status.connected && status.errorMessage) {
      launcherMessage.textContent = `Falha: ${status.errorMessage}`;
    }
  };

  matchmakingClient = new MultiplayerClient();
  matchmakingClient.onLobbyStatusChange(handleLobbyStatus);
  void matchmakingClient.connect();
});

btnLogin.addEventListener("click", async () => {
  launcherMessage.textContent = "Redirecionando para o login Google...";
  btnLogin.disabled = true;

  try {
    await signInWithGoogle();
  } catch (error) {
    launcherMessage.textContent = error instanceof Error ? error.message : "Nao foi possivel iniciar o login.";
    btnLogin.disabled = false;
  }
});

btnLogout.addEventListener("click", async () => {
  launcherMessage.textContent = "Encerrando sessao...";
  btnLogout.disabled = true;

  try {
    await signOut();
    appState = null;
    await refreshState();
  } catch (error) {
    launcherMessage.textContent = error instanceof Error ? error.message : "Nao foi possivel sair.";
  } finally {
    btnLogout.disabled = false;
  }
});

void initializeApp();
const unsubscribe = onAuthChange(async () => {
  btnLogin.disabled = false;
  await refreshState();
});

window.addEventListener("beforeunload", () => {
  unsubscribe();
});

window.addEventListener("error", (event) => {
  console.error("[window] uncaught error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error
  });
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[window] unhandled rejection", event.reason);
});
