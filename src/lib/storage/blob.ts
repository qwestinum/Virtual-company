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
import { withUtf8Bom } from '@/lib/storage/utf8';

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
  const mimeType = input.mimeType ?? 'text/markdown';
  // Encodage : BOM UTF-8 sur les contenus texte (cf. lib/storage/utf8.ts) — on
  // ne touche PAS au content-type (un `charset=utf-8` y faisait échouer l'upload
  // Storage → plus de publicUrl → l'icône « ouvrir » disparaissait).
  const body = withUtf8Bom(input.content, mimeType);

  const { error: uploadError } = await supabase.storage
    .from(ARTIFACTS_BUCKET)
    .upload(path, body, {
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

/**
 * Upload BINAIRE (PDF du rapport de campagne…). Pas de BOM, content-type
 * réel, `upsert` pour écraser le cache à la régénération. Renvoie le chemin
 * Storage + l'URL publique, comme `uploadArtifact`.
 */
export async function uploadArtifactBinary(input: {
  owner: ArtifactOwner;
  name: string;
  content: Buffer;
  mimeType: string;
}): Promise<UploadArtifactResult> {
  const supabase = requireServerSupabase();
  const path = buildPath(input.owner, input.name);
  const { error: uploadError } = await supabase.storage
    .from(ARTIFACTS_BUCKET)
    .upload(path, input.content, {
      contentType: input.mimeType,
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`uploadArtifactBinary: ${uploadError.message}`);
  }
  const {
    data: { publicUrl },
  } = supabase.storage.from(ARTIFACTS_BUCKET).getPublicUrl(path);
  return { bucket: ARTIFACTS_BUCKET, path, publicUrl };
}

/**
 * Télécharge le contenu binaire d'un artefact depuis Storage. Sert au cache
 * stable du rapport de campagne (re-sert le PDF mis en cache). Retourne null
 * si l'objet est absent (cache invalidé / jamais généré).
 */
export async function downloadArtifact(path: string): Promise<Buffer | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase.storage
    .from(ARTIFACTS_BUCKET)
    .download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
