/**
 * /api/vivier — liste paginée (GET) + upload manuel d'un CV (POST).
 *
 * L'upload réutilise le pipeline d'extraction existant (texte + identité), crée
 * ou met à jour le dossier (déduplication par email), puis DÉCLENCHE
 * l'indexation en tâche de fond via `after()` : la réponse part immédiatement
 * (dossier en `pending`), l'embedding + les entités se calculent après le flush
 * sans bloquer l'utilisateur. Sur VPS (process long-running), le traitement
 * continue même si l'utilisateur quitte la page.
 */
import { NextResponse, after } from 'next/server';

import { extractCandidateIdentity } from '@/lib/agents/candidate-identity';
import { CVExtractError, extractCVText } from '@/lib/agents/cv-extract';
import { AIValidationError } from '@/lib/ai/errors';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { listVivierCandidates } from '@/lib/db/repos/vivier';
import { upsertVivierCandidate } from '@/lib/vivier/candidates';
import { indexVivierCandidate } from '@/lib/vivier/indexing';
import { isSupportedUploadType, unsupportedFormatMessage } from '@/lib/vivier/upload-batch';
import type { VivierIndexingStatus } from '@/types/vivier';

export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024; // 10 Mo (aligné sur le bucket Storage)

function notConfigured(): NextResponse {
  return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
}

/** MIME normalisé à partir de l'extension (file.type parfois vide côté navigateur). */
function mimeForName(name: string): string {
  if (name.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  if (name.toLowerCase().endsWith('.md')) return 'text/markdown';
  return 'text/plain';
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const status = params.get('status');
  const filters = {
    search: params.get('search') ?? undefined,
    status: (status as VivierIndexingStatus | null) ?? undefined,
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    offset: params.get('offset') ? Number(params.get('offset')) : undefined,
  };
  try {
    const { items, total } = await listVivierCandidates(filters);
    return NextResponse.json({ items, total });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get('cv');
    if (value instanceof File) file = value;
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Requête multipart invalide.' },
      { status: 400 },
    );
  }

  if (!file) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Aucun fichier « cv » fourni.' },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'file_too_large', message: 'Fichier trop volumineux (max 10 Mo).' },
      { status: 413 },
    );
  }
  if (!isSupportedUploadType(file.name)) {
    return NextResponse.json(
      { error: 'unsupported_type', message: unsupportedFormatMessage(file.name) },
      { status: 415 },
    );
  }

  // 1. Extraction du texte (pipeline existant).
  let cvText: string;
  try {
    const extracted = await extractCVText(file);
    cvText = extracted.text;
  } catch (err) {
    if (err instanceof CVExtractError) {
      // Message métier (illisible / PDF scanné / moteur indisponible).
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.code === 'pdf_engine_unavailable' ? 503 : 422 },
      );
    }
    return NextResponse.json(
      { error: 'extract_failed', message: (err as Error).message },
      { status: 500 },
    );
  }

  // 2. Extraction de l'identité (mêmes prompts que le CV Analyzer).
  let identity;
  try {
    identity = await extractCandidateIdentity(cvText, file.name);
  } catch (err) {
    if (err instanceof AIValidationError) {
      return NextResponse.json(
        {
          error: 'identity_failed',
          message:
            "Impossible d'extraire l'identité du candidat. Vérifiez le CV (il doit contenir un nom et un email lisibles).",
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: 'identity_failed', message: (err as Error).message },
      { status: 500 },
    );
  }

  // Sans email, pas de dossier (clé de déduplication) — message explicite.
  if (!identity.email) {
    return NextResponse.json(
      {
        error: 'email_missing',
        message:
          "Aucune adresse email trouvée dans ce CV. Le dossier ne peut pas être créé sans email — vérifiez que le CV en contient une.",
      },
      { status: 422 },
    );
  }

  // 3. Upsert (déduplication par email) + déclenchement de l'indexation.
  try {
    const content = Buffer.from(await file.arrayBuffer());
    const { candidate, created } = await upsertVivierCandidate({
      email: identity.email,
      nom: identity.fullName,
      prenom: null,
      telephone: identity.phone,
      cvContent: content,
      cvFileName: file.name,
      cvMimeType: file.type || mimeForName(file.name),
      cvText,
      source: 'manual_upload',
    });

    // Indexation APRÈS la réponse (non bloquante). Les échecs sont matérialisés
    // par le statut du dossier (failed) ; rien ne casse le retour utilisateur.
    after(async () => {
      try {
        await indexVivierCandidate(candidate.id);
      } catch (err) {
        console.error(`[vivier] background indexing failed for ${candidate.id}`, err);
      }
    });

    return NextResponse.json({ candidate, created, email: identity.email });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
