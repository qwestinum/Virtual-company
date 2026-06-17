import { NextResponse } from 'next/server';

import { extractCampaignPrefill } from '@/lib/agents/campaign-prefill';
import { CVExtractError, extractCVText } from '@/lib/agents/cv-extract';
import { AIProviderError, AIValidationError } from '@/lib/ai/errors';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Pré-remplissage d'une campagne à partir d'un document (appel d'offres ou
 * notes). Couche COMMUNE aux deux chemins (formulaire + chat Manager) : on
 * extrait le TEXTE (même pipeline que les CV) puis on en tire un brouillon
 * structuré. AUCUNE persistance — l'humain valide ensuite.
 */
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED_MIME = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export async function POST(request: Request): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Form data invalide.',
      },
      { status: 400 },
    );
  }

  const file = form.get('document');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Champ "document" manquant.' },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json(
      { error: 'empty_document', message: 'Le document est vide.' },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: 'document_too_large',
        message: `Le document dépasse la limite de ${Math.round(MAX_BYTES / (1024 * 1024))} Mo.`,
      },
      { status: 413 },
    );
  }
  if (file.type && !ACCEPTED_MIME.some((m) => file.type.startsWith(m))) {
    return NextResponse.json(
      {
        error: 'unsupported_mime',
        message: `Type de fichier non supporté : ${file.type}. Utilisez PDF, DOCX ou texte.`,
      },
      { status: 415 },
    );
  }

  try {
    const extracted = await extractCVText(file);
    const prefill = await extractCampaignPrefill(extracted.text);
    return NextResponse.json({ prefill, fileName: extracted.fileName });
  } catch (err) {
    if (err instanceof CVExtractError) {
      // pdf_engine_unavailable = défaillance serveur → 503 ; sinon fichier
      // client invalide → 422.
      const status = err.code === 'pdf_engine_unavailable' ? 503 : 422;
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status },
      );
    }
    if (err instanceof AIValidationError) {
      return NextResponse.json(
        {
          error: 'extraction_failed',
          message:
            "Le document n'a pas pu être analysé de façon fiable. Réessayez ou saisissez la campagne manuellement.",
        },
        { status: 502 },
      );
    }
    if (err instanceof AIProviderError) {
      const status = err.code === 'config_missing' ? 500 : 502;
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status },
      );
    }
    return NextResponse.json(
      {
        error: 'unexpected_error',
        message: err instanceof Error ? err.message : 'Unexpected error.',
      },
      { status: 500 },
    );
  }
}
