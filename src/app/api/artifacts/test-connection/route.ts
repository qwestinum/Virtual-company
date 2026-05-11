/**
 * GET /api/artifacts/test-connection — vérification rapide du setup
 * Supabase Storage (Session 5 round 2).
 *
 * Réponses :
 *   200 { ok: true, bucket, fileSizeLimit }     → bucket OK
 *   503 { ok: false, error: 'supabase_not_configured' }
 *   502 { ok: false, error: 'storage_unavailable', message }
 *                                                → bucket manquant,
 *                                                  RLS, etc.
 */
import { NextResponse } from 'next/server';

import {
  getServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';
import { ARTIFACTS_BUCKET } from '@/lib/storage/blob';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: 'supabase_not_configured' },
      { status: 503 },
    );
  }

  try {
    // listBuckets nécessite la service_role_key — chemin de validation
    // qu'on a bien la bonne clé en plus de l'URL.
    const { data, error } = await supabase.storage.getBucket(ARTIFACTS_BUCKET);
    if (error) {
      const hint = /not found/i.test(error.message)
        ? `Le bucket "${ARTIFACTS_BUCKET}" n'existe pas. Re-run scripts/migrate.sql dans le SQL editor Supabase pour le créer.`
        : null;
      return NextResponse.json(
        {
          ok: false,
          error: 'storage_unavailable',
          message: error.message,
          ...(hint ? { hint } : {}),
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      bucket: data.name,
      public: data.public,
      fileSizeLimit: data.file_size_limit,
      allowedMimeTypes: data.allowed_mime_types,
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { ok: false, error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'storage_unavailable',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
