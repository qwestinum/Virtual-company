/**
 * Sync client ↔ serveur pour `campaigns-store` (Session 5, round 1).
 *
 * Comportement :
 *   - `hydrateCampaigns()` est appelé une fois au boot par le
 *     `<HydrationGate />`. Il fetch `/api/campaigns` et hydrate le store.
 *     503 (Supabase non configuré) ou échec réseau → no-op silencieux,
 *     l'app continue en mode volatile.
 *   - `attachCampaignsSync()` pose un subscriber sur le store. À chaque
 *     mutation d'une campagne (référence !==), on programme un PUT
 *     debounced à 300ms sur `/api/campaigns`. Idempotent — le serveur
 *     fait un upsert.
 *
 * Anti-récursion : pendant l'hydratation, on bypass le subscriber pour
 * éviter de re-pousser les campagnes qu'on vient de charger.
 *
 * Pas de retry pour le MVP. Si un push échoue, la prochaine mutation
 * sur la même campagne déclenchera un nouveau push qui rattrape l'état.
 */
'use client';

import type { ActiveCampaign } from '@/stores/campaigns-store';
import { useCampaignsStore } from '@/stores/campaigns-store';

const PUSH_DEBOUNCE_MS = 300;

let hydrationStarted = false;
let isHydrating = false;
let subscriberAttached = false;
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();

export type HydrationResult = { ok: boolean; count: number };

export async function hydrateCampaigns(): Promise<HydrationResult> {
  if (hydrationStarted) {
    return { ok: true, count: useCampaignsStore.getState().order.length };
  }
  hydrationStarted = true;

  let campaigns: ActiveCampaign[] = [];
  try {
    const res = await fetch('/api/campaigns', { cache: 'no-store' });
    if (res.status === 503) return { ok: false, count: 0 };
    if (!res.ok) return { ok: false, count: 0 };
    const json = (await res.json()) as { campaigns: ActiveCampaign[] };
    campaigns = json.campaigns ?? [];
  } catch {
    return { ok: false, count: 0 };
  }

  isHydrating = true;
  try {
    useCampaignsStore.setState((state) => {
      const byId = { ...state.byId };
      const seen = new Set<string>();
      const order: string[] = [];
      for (const incoming of campaigns) {
        const local = byId[incoming.id];
        // Si l'utilisateur a déjà commencé à muter localement pendant
        // que l'hydratation roulait, on garde la version locale (plus
        // récente côté updatedAt). Sinon, l'incoming gagne.
        if (local && local.updatedAt > incoming.updatedAt) {
          // garde local
        } else {
          byId[incoming.id] = incoming;
        }
        seen.add(incoming.id);
        order.push(incoming.id);
      }
      // Conserve les campagnes locales jamais poussées (créées avant le
      // retour de la réponse). On les ajoute en fin d'ordre.
      for (const id of state.order) {
        if (!seen.has(id)) order.push(id);
      }
      return { ...state, byId, order };
    });
  } finally {
    isHydrating = false;
  }
  return { ok: true, count: campaigns.length };
}

export function attachCampaignsSync(): () => void {
  if (subscriberAttached) return () => {};
  subscriberAttached = true;

  let previous = useCampaignsStore.getState().byId;
  const unsubscribe = useCampaignsStore.subscribe((state) => {
    const next = state.byId;
    if (isHydrating) {
      previous = next;
      return;
    }
    for (const id of Object.keys(next)) {
      if (previous[id] !== next[id]) {
        schedulePush(id, next[id]!);
      }
    }
    previous = next;
  });

  return () => {
    subscriberAttached = false;
    unsubscribe();
  };
}

function schedulePush(id: string, snapshot: ActiveCampaign): void {
  const existing = pushTimers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pushTimers.delete(id);
    void pushCampaign(snapshot);
  }, PUSH_DEBOUNCE_MS);
  pushTimers.set(id, timer);
}

/**
 * Annule un push debouncé en attente pour cette campagne. Appelé par le chemin
 * de création CONFIRMÉE (`persistCampaign` awaité) qui prend la main sur la
 * persistance : sans ça, le timer de fond rejouerait le PUT après coup et
 * pourrait ré-enregistrer une campagne dont la création a été annulée pour
 * échec. Idempotent.
 */
export function cancelScheduledCampaignPush(id: string): void {
  const existing = pushTimers.get(id);
  if (existing) {
    clearTimeout(existing);
    pushTimers.delete(id);
  }
}

/**
 * Résultat d'une tentative de persistance d'une campagne.
 *   - `{ ok: true, demo: false }` : confirmé écrit en base (200).
 *   - `{ ok: true, demo: true }`  : Supabase non configuré (503) — mode démo
 *     volatile assumé, rien à enregistrer côté serveur. PAS un échec.
 *   - `{ ok: false, ... }`        : échec DUR (réseau, 4xx/5xx) — la campagne
 *     n'est PAS en base. L'appelant doit le signaler et NE PAS déclarer le
 *     succès.
 */
export type PersistOutcome =
  | { ok: true; demo: boolean }
  | { ok: false; status?: number; error: string };

/**
 * Persiste une campagne et REND le résultat (contrairement à `pushCampaign`,
 * fire-and-forget). C'est la voie autoritaire d'une création/édition qui doit
 * confirmer l'enregistrement avant de l'annoncer à l'utilisateur. Vérifie
 * `res.ok` (un 4xx/5xx renvoie une réponse — `fetch` ne rejette PAS dessus) et
 * extrait le message d'erreur serveur quand il existe.
 */
export async function persistCampaign(
  snapshot: ActiveCampaign,
): Promise<PersistOutcome> {
  let res: Response;
  try {
    res = await fetch('/api/campaigns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
      cache: 'no-store',
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Erreur réseau.',
    };
  }
  // 503 = Supabase non configuré : démo volatile assumée, pas un échec.
  if (res.status === 503) return { ok: true, demo: true };
  if (!res.ok) {
    let error = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string; error?: string };
      error = data.message ?? data.error ?? error;
    } catch {
      // Réponse non-JSON : on garde le code HTTP comme message.
    }
    return { ok: false, status: res.status, error };
  }
  return { ok: true, demo: false };
}

/**
 * Push best-effort de fond (subscriber) pour les éditions ultérieures. Délègue
 * à `persistCampaign` pour partager la logique `res.ok`, mais reste
 * fire-and-forget : son résultat n'est pas encore remonté à l'UI (durcissement
 * « modifications non enregistrées » prévu séparément).
 */
async function pushCampaign(snapshot: ActiveCampaign): Promise<void> {
  await persistCampaign(snapshot);
}

// Exposé pour les tests : permet de remettre l'état du module à zéro.
export function _resetCampaignsSyncForTests(): void {
  hydrationStarted = false;
  isHydrating = false;
  subscriberAttached = false;
  for (const t of pushTimers.values()) clearTimeout(t);
  pushTimers.clear();
}
