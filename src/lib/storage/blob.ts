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

/**
 * Durée de vie d'un lien signé vers un artefact (CV, rapport…). Le bucket est
 * PRIVÉ (donnée personnelle candidat, RGPD) : aucun accès permanent, on génère
 * un lien éphémère à chaque ouverture. 10 min = assez pour ouvrir/lire un PDF,
 * assez court pour ne pas être une fuite durable.
 */
export const SIGNED_URL_TTL_SECONDS = 600;

export type ArtifactOwner =
  | { kind: 'campaign'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'vivier'; id: string };

export type UploadArtifactInput = {
  owner: ArtifactOwner;
  name: string;
  content: string;
  mimeType?: string;
};

export type UploadArtifactResult = {
  bucket: string;
  path: string;
  /**
   * TOUJOURS `null` : le bucket est privé, on n'expose plus d'URL publique
   * permanente. L'accès se fait via un lien signé éphémère généré à l'ouverture
   * (`createSignedArtifactUrl`). Champ conservé pour compat de forme.
   */
  publicUrl: null;
};

const OWNER_PREFIX: Record<ArtifactOwner['kind'], string> = {
  campaign: 'campagnes',
  task: 'tasks',
  vivier: 'vivier',
};

function buildPath(owner: ArtifactOwner, name: string): string {
  const prefix = OWNER_PREFIX[owner.kind];
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

  // Bucket privé : pas d'URL publique. L'accès passe par un lien signé.
  return { bucket: ARTIFACTS_BUCKET, path, publicUrl: null };
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
  // Bucket privé : pas d'URL publique. L'accès passe par un lien signé.
  return { bucket: ARTIFACTS_BUCKET, path, publicUrl: null };
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

/**
 * URL SIGNÉE à durée limitée vers un objet Storage (RGPD : donnée personnelle
 * candidat → jamais d'URL publique permanente). Sert au lien CV dans
 * l'invitation agenda .ics. `null` si l'objet est absent / Storage non
 * configuré (dégradation douce — l'appelant omet alors le lien).
 */
export async function createSignedArtifactUrl(
  path: string,
  expiresInSeconds: number,
): Promise<string | null> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase.storage
      .from(ARTIFACTS_BUCKET)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/**
 * Supprime un objet du Storage (suppression cascade du vivier — RGPD §8.2).
 * Idempotent : retirer un objet déjà absent ne lève pas. Lève uniquement sur
 * une vraie erreur Storage, pour que la cascade s'interrompe et signale l'échec.
 */
export async function deleteArtifact(path: string): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase.storage.from(ARTIFACTS_BUCKET).remove([path]);
  if (error) {
    throw new Error(`deleteArtifact: ${error.message}`);
  }
}
