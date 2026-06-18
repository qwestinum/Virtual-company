import { NextResponse } from 'next/server';

import { detectDocumentNature } from '@/lib/agents/document-nature';
import { CVExtractError, extractCVText } from '@/lib/agents/cv-extract';
import { AIProviderError, AIValidationError } from '@/lib/ai/errors';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Reconnaissance LÉGÈRE de la nature d'un document déposé dans le chat, AVANT
 * toute analyse/comptabilisation. Réponse : { nature, fileName }.
 *   - nature ∈ 'cv' | 'appel_offres' | 'autre' | 'illisible'.
 *   - 'illisible' = texte non extractible (PDF scanné/image) → on ne l'analyse
 *     pas et on invite à redéposer un PDF texte.
 * Aucune écriture / persistance : c'est une classification de surface.
 */
const MAX_BYTES = 15 * 1024 * 1024;

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
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Fichier vide ou trop volumineux.' },
      { status: 400 },
    );
  }

  // Extraction du texte : si elle échoue (PDF scanné/illisible, type non
  // supporté), on renvoie 'illisible' plutôt qu'une erreur — le chat avertira
  // sans analyser ni comptabiliser.
  let text: string;
  try {
    const extracted = await extractCVText(file);
    text = extracted.text;
  } catch (err) {
    if (err instanceof CVExtractError) {
      return NextResponse.json({ nature: 'illisible', fileName: file.name });
    }
    throw err;
  }

  try {
    const { nature } = await detectDocumentNature(text);
    return NextResponse.json({ nature, fileName: file.name });
  } catch (err) {
    if (err instanceof AIValidationError || err instanceof AIProviderError) {
      // Classification indisponible : on ne devine pas — fail safe en
      // 'illisible' pour ne PAS analyser/comptabiliser un document incertain.
      const status = err instanceof AIProviderError && err.code === 'config_missing' ? 500 : 502;
      return NextResponse.json(
        { error: 'classification_unavailable', message: err.message },
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
