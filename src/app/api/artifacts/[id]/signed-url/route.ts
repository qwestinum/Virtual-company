/**
 * GET /api/artifacts/[id]/signed-url — lien signé ÉPHÉMÈRE vers un artefact.
 *
 * Le bucket `artifacts` est PRIVÉ (donnée personnelle candidat, RGPD) : aucun
 * accès public permanent. On génère un lien signé court (TTL) à l'ouverture.
 *
 * Sécurité :
 *  - le proxy gate déjà toute route `/api` (session requise). On REVÉRIFIE ici
 *    explicitement (défense en profondeur) car cette route donne accès à un CV.
 *  - on signe à partir du `storage_path` résolu côté serveur par l'id — jamais
 *    d'un chemin fourni par le client → impossible de signer un objet arbitraire.
 */
import { NextResponse } from 'next/server';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { getArtifactMeta } from '@/lib/db/repos/artifacts';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  createSignedArtifactUrl,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/storage/blob';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();

  const { id } = await context.params;
  try {
    const meta = await getArtifactMeta(id);
    if (!meta || !meta.storagePath) {
      // Inconnu, ou artefact sans objet Storage (local-only) → 404. Le client
      // retombe alors sur le téléchargement du contenu local s'il l'a.
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const url = await createSignedArtifactUrl(
      meta.storagePath,
      SIGNED_URL_TTL_SECONDS,
    );
    if (!url) {
      return NextResponse.json({ error: 'sign_failed' }, { status: 502 });
    }
    return NextResponse.json(
      { url, expiresIn: SIGNED_URL_TTL_SECONDS },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'sign_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
