/**
 * Upload d'artefacts vers Supabase Storage (Session 5 round 2).
 *
 * Remplace l'intégration Google Drive — les service accounts Google
 * n'ont pas de quota de stockage sur My Drive (limitation 2025) et
 * nécessitent un Shared Drive (Workspace). Supabase Storage n'a aucune
 * de ces contraintes : même projet que les tables, URL publique
 * cliquable côté client, configuration zéro.
 *
 * Convention de chemin (mappée sur la spec §5.2) :
 *   - campagnes/<campaignId>/<filename>
 *   - tasks/<taskId>/<filename>
 *
 * Mode dégradé : si Supabase n'est pas configuré, `uploadArtifact`
 * lève SupabaseNotConfiguredError. Le caller (API route) traduit en
 * artefact volatile (Session 4 fallback) — pas de crash.
 */

import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';

export const ARTIFACTS_BUCKET = 'artifacts';

export type ArtifactOwner =
  | { kind: 'campaign'; id: string }
  | { kind: 'task'; id: string };

export type UploadArtifactInput = {
  owner: ArtifactOwner;
  name: string;
  content: string;
  mimeType?: string;
};

export type UploadArtifactResult = {
  bucket: string;
  path: string;
  publicUrl: string;
};

function buildPath(owner: ArtifactOwner, name: string): string {
  const prefix = owner.kind === 'campaign' ? 'campagnes' : 'tasks';
  // On garde le nom original côté client (« fdp.md ») et on préfixe
  // par owner pour éviter les collisions inter-campagnes. La key
  // primaire d'artifacts_meta reste l'id applicatif (art_xxx) — le
  // path ici sert seulement à l'objet Storage.
  return `${prefix}/${owner.id}/${name}`;
}

export { SupabaseNotConfiguredError };

export async function uploadArtifact(
  input: UploadArtifactInput,
): Promise<UploadArtifactResult> {
  const supabase = requireServerSupabase();
  const path = buildPath(input.owner, input.name);
  const baseMime = input.mimeType ?? 'text/markdown';
  // Force `charset=utf-8` sur les types texte : sans lui, le navigateur ouvre le
  // rapport en Latin-1/Windows-1252 → mojibake (« â€" » au lieu de « — », « Ã© »
  // au lieu de « é »). Le contenu est bien de l'UTF-8.
  const mimeType =
    baseMime.startsWith('text/') && !/charset/i.test(baseMime)
      ? `${baseMime}; charset=utf-8`
      : baseMime;

  const { error: uploadError } = await supabase.storage
    .from(ARTIFACTS_BUCKET)
    .upload(path, input.content, {
      contentType: mimeType,
      // Idempotence : si on re-upload une FDP (DRH a re-validé après
      // ajustement), on écrase la précédente. La trace côté
      // artifacts_meta a son propre id donc l'historique est conservé.
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`uploadArtifact: ${uploadError.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(ARTIFACTS_BUCKET).getPublicUrl(path);

  return { bucket: ARTIFACTS_BUCKET, path, publicUrl };
}
