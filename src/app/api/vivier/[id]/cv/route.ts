/**
 * /api/vivier/[id]/cv — sert le fichier CV d'origine d'un dossier vivier
 * (Session V3 — accès au CV depuis la validation). Streamé côté serveur
 * (contrôle d'accès, pas d'URL publique exposée). `inline` ⇒ ouverture en
 * onglet (PDF) plutôt que téléchargement forcé.
 */
import { NextResponse } from 'next/server';

import { getVivierCandidate } from '@/lib/db/repos/vivier';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { downloadArtifact } from '@/lib/storage/blob';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

function contentTypeForName(name: string | null): string {
  const n = (name ?? '').toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (n.endsWith('.md')) return 'text/markdown; charset=utf-8';
  return 'application/octet-stream';
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const candidate = await getVivierCandidate(id);
    if (!candidate?.cvPath) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const buffer = await downloadArtifact(candidate.cvPath);
    if (!buffer) {
      return NextResponse.json({ error: 'cv_unavailable' }, { status: 404 });
    }
    const fileName = candidate.cvFileName ?? 'cv';
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentTypeForName(candidate.cvFileName),
        'Content-Disposition': `inline; filename="${fileName.replace(/"/g, '')}"`,
      },
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'cv_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
