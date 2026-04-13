import type { Session } from "@supabase/supabase-js";
import { backendUrl } from "./config";
import { supabase } from "./supabase";

const guestStorageKey = "voxel-royale.guest-id";

export type CatalogItem = {
  id?: string;
  slug: string;
  name: string;
  rarity: string;
  description: string;
  price_brl: number;
  is_vip_only: boolean;
  preview_color: string;
};

export type PlayerProfile = {
  id: string;
  display_name: string;
  is_vip: boolean;
  vip_until: string | null;
  equipped_skin_id: string | null;
  owned_skin_ids: string[];
};

export type BootstrapState = {
  mode: "guest" | "authenticated";
  guest: { id: string; display_name: string } | null;
  profile: PlayerProfile | null;
  ads_enabled: boolean;
  catalog: CatalogItem[];
};

export type AuthDebugEvent = {
  step: string;
  detail: string;
};

function emitAuthDebug(step: string, detail: string): void {
  const event = new CustomEvent<AuthDebugEvent>("auth-debug", {
    detail: { step, detail }
  });
  window.dispatchEvent(event);
  console.log(`[auth] ${step}: ${detail}`);
}

function getOrCreateGuestId(): string {
  const existing = window.localStorage.getItem(guestStorageKey);
  if (existing) {
    return existing;
  }

  const created = crypto.randomUUID();
  window.localStorage.setItem(guestStorageKey, created);
  return created;
}

async function getSession(): Promise<Session | null> {
  if (!supabase) {
    emitAuthDebug("getSession", "Supabase client ausente.");
    return null;
  }

  const { data } = await supabase.auth.getSession();
  emitAuthDebug("getSession", data.session ? "Sessao encontrada." : "Nenhuma sessao encontrada.");
  return data.session;
}

export async function initializeAuthFromUrl(): Promise<{ error?: string }> {
  if (!supabase) {
    return { error: "Supabase nao configurado no frontend." };
  }

  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const authCode = url.searchParams.get("code");
  const hashError = hashParams.get("error_description") || hashParams.get("error");
  emitAuthDebug(
    "initializeAuthFromUrl",
    `url=${window.location.href} code=${authCode ? "presente" : "ausente"} hash=${url.hash || "(vazio)"}`
  );

  if (hashError) {
    emitAuthDebug("initializeAuthFromUrl", `Erro retornado pelo provedor: ${hashError}`);
    return { error: decodeURIComponent(hashError) };
  }

  if (!authCode) {
    emitAuthDebug("initializeAuthFromUrl", "Nenhum code OAuth na URL.");
    return {};
  }

  emitAuthDebug("exchangeCodeForSession", "Trocando code OAuth por sessao Supabase.");
  const { error } = await supabase.auth.exchangeCodeForSession(authCode);
  if (error) {
    emitAuthDebug("exchangeCodeForSession", `Falhou: ${error.message}`);
    return { error: error.message };
  }

  emitAuthDebug("exchangeCodeForSession", "Sessao criada com sucesso.");
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("scope");
  url.searchParams.delete("authuser");
  url.searchParams.delete("prompt");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
  emitAuthDebug("initializeAuthFromUrl", "URL limpa apos login.");

  return {};
}

export async function bootstrapState(): Promise<BootstrapState> {
  const session = await getSession();
  const guestId = getOrCreateGuestId();
  emitAuthDebug(
    "bootstrapState",
    `Chamando backend com modo=${session?.access_token ? "authenticated" : "guest"} guestId=${guestId}`
  );
  const response = await fetch(`${backendUrl}/api/session/bootstrap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
    },
    body: JSON.stringify({ guestId })
  });

  if (!response.ok) {
    emitAuthDebug("bootstrapState", `Backend respondeu ${response.status}.`);
    throw new Error(`Falha ao iniciar a sessao (${response.status}).`);
  }

  const payload = await response.json() as BootstrapState;
  emitAuthDebug("bootstrapState", `Backend confirmou modo=${payload.mode}.`);
  return payload;
}

export async function equipSkin(skinId: string): Promise<PlayerProfile> {
  const session = await getSession();
  if (!session?.access_token) {
    throw new Error("E preciso estar logado para equipar skins.");
  }

  const response = await fetch(`${backendUrl}/api/me/equip-skin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ skinId })
  });

  if (!response.ok) {
    throw new Error("Nao foi possivel equipar a skin.");
  }

  const payload = await response.json() as { profile: PlayerProfile };
  return payload.profile;
}

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) {
    throw new Error("Supabase nao configurado no frontend.");
  }

  emitAuthDebug("signInWithGoogle", `Iniciando OAuth com redirectTo=${window.location.origin}`);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin
    }
  });

  if (error) {
    emitAuthDebug("signInWithGoogle", `Falhou antes do redirect: ${error.message}`);
    throw error;
  }
}

export async function signOut(): Promise<void> {
  if (!supabase) {
    return;
  }

  emitAuthDebug("signOut", "Encerrando sessao local do Supabase.");
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    emitAuthDebug("signOut", `Falhou ao encerrar sessao: ${error.message}`);
    throw error;
  }

  emitAuthDebug("signOut", "Sessao local encerrada com sucesso.");
}

export function onAuthChange(callback: () => void): () => void {
  if (!supabase) {
    return () => {};
  }

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    emitAuthDebug("onAuthChange", `evento=${event} session=${session ? "presente" : "ausente"}`);
    void callback();
  });

  return () => data.subscription.unsubscribe();
}
