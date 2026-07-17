/**
 * Sync client ↔ serveur pour `artifacts-store` (Session 5 round 3).
 *
 * Différent de campaigns/tasks-sync : on ne fait PAS de subscriber
 * automatique. Raison — un artefact a un cycle de vie immutable
 * (créé, optionnellement back-updated avec publicUrl, jamais
 * supprimé sauf reset chat). On expose donc un appel impératif
 * `pushArtifact(artifact, content)` que les call sites invoquent
 * après `addArtifact`. Plus prévisible, plus testable.
 *
 * Le push est non-bloquant (fire-and-forget) : l'UI affiche déjà
 * l'attachment avec le Blob local, l'URL Supabase arrive en
 * back-update via `updateArtifactStorage` quand la promesse résout.
 *
 * Anti-perte silencieuse (audit C7) : un POST qui échoue (réseau, 4xx/5xx)
 * n'est plus avalé — l'artefact (avec son CONTENU, indispensable au rejeu)
 * est marqué « non enregistré » dans le registre de synchro : la bannière le
 * signale et le réessai le repousse. Un 503 (Supabase non configuré) reste un
 * mode démo volatile assumé, pas un échec.
 */
'use client';

import type { ArtifactKind } from '@/lib/db/types';
import type { Artifact } from '@/stores/artifacts-store';
import { useArtifactsStore } from '@/stores/artifacts-store';
import { useSyncStatusStore } from '@/stores/sync-status-store';

export type PushArtifactInput = {
  artifact: Artifact;
  content: string;
};

export async function pushArtifact(input: PushArtifactInput): Promise<void> {
  const { artifact, content } = input;
  // Pas de double-XOR check ici — le store l'accepte avec un seul
  // owner. Si les deux manquent (artifact transverse), on skip le
  // push (l'API rejette de toute façon).
  if (!artifact.campaignId && !artifact.taskId) return;
  if (!artifact.kind) return;

  const body = {
    id: artifact.id,
    campaignId: artifact.campaignId ?? undefined,
    taskId: artifact.taskId ?? undefined,
    kind: artifact.kind,
    name: artifact.name,
    content,
    mime: artifact.mime,
  };

  const sync = useSyncStatusStore.getState();
  try {
    const res = await fetch('/api/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (res.status === 503) {
      // Supabase non configuré : démo volatile assumée, rien à enregistrer.
      sync.clearArtifactFailed(artifact.id);
      return;
    }
    if (!res.ok) {
      sync.markArtifactFailed(input);
      return;
    }
    const json = (await res.json()) as {
      artifact?: { publicUrl: string | null; storagePath: string | null };
    };
    if (json.artifact) {
      useArtifactsStore.getState().updateArtifactStorage(artifact.id, {
        publicUrl: json.artifact.publicUrl,
        storagePath: json.artifact.storagePath,
      });
    }
    sync.clearArtifactFailed(artifact.id);
  } catch {
    // Réseau coupé / Supabase down : l'UI continue avec le Blob local (le DRH
    // peut toujours télécharger), mais l'échec est SIGNALÉ — le Blob ne
    // survivra pas au reload.
    sync.markArtifactFailed(input);
  }
}

/** Rejoue les push d'artefacts en échec (bannière « réessayer »). Séquentiel. */
export async function retryFailedArtifactPushes(): Promise<void> {
  const failed = useSyncStatusStore.getState().failedArtifactList();
  for (const input of failed) {
    await pushArtifact(input);
  }
}

/**
 * Helper d'hydratation : charge les artefacts d'une campagne depuis
 * Supabase et seed le store. Appelé par HydrationGate après
 * hydratation des campagnes, pour les `byId.order`. Idempotent —
 * ne dupliquera pas un artefact déjà produit localement.
 */
export async function hydrateArtifactsForCampaign(
  campaignId: string,
): Promise<void> {
  try {
    const res = await fetch(
      `/api/artifacts?campaign_id=${encodeURIComponent(campaignId)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return;
    const json = (await res.json()) as {
      artifacts: Array<{
        id: string;
        campaignId: string | null;
        taskId: string | null;
        kind: ArtifactKind;
        name: string;
        mime: string;
        publicUrl: string | null;
        storagePath: string | null;
        createdAt: string;
      }>;
    };
    const hydrate = useArtifactsStore.getState().hydrateArtifact;
    for (const a of json.artifacts ?? []) {
      hydrate({
        id: a.id,
        name: a.name,
        mime: a.mime,
        createdAt: a.createdAt,
        campaignId: a.campaignId,
        taskId: a.taskId,
        kind: a.kind,
        publicUrl: a.publicUrl,
        storagePath: a.storagePath,
      });
    }
  } catch {
    // Idem — pas de crash sur réseau coupé.
  }
}

export async function hydrateArtifactsForTask(taskId: string): Promise<void> {
  try {
    const res = await fetch(
      `/api/artifacts?task_id=${encodeURIComponent(taskId)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return;
    const json = (await res.json()) as {
      artifacts: Array<{
        id: string;
        campaignId: string | null;
        taskId: string | null;
        kind: ArtifactKind;
        name: string;
        mime: string;
        publicUrl: string | null;
        storagePath: string | null;
        createdAt: string;
      }>;
    };
    const hydrate = useArtifactsStore.getState().hydrateArtifact;
    for (const a of json.artifacts ?? []) {
      hydrate({
        id: a.id,
        name: a.name,
        mime: a.mime,
        createdAt: a.createdAt,
        campaignId: a.campaignId,
        taskId: a.taskId,
        kind: a.kind,
        publicUrl: a.publicUrl,
        storagePath: a.storagePath,
      });
    }
  } catch {
    // no-op
  }
}
