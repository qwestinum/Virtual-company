/**
 * GET /api/recruiters/options — recruteurs ACTIFS pour le sélecteur
 * « Recruteur référent » d'une campagne. Accessible à toute session (un
 * member édite ses campagnes) : projection MINIMALE {id, displayName,
 * hasCalcomLink} — ni email, ni rôle (réservés à la gestion admin).
 */
import { NextResponse } from 'next/server';

import { listActiveRecruiters } from '@/lib/db/repos/recruiters';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const recruiters = await listActiveRecruiters();
    return NextResponse.json({
      options: recruiters.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        // Signale un référent SANS lien (l'UI peut avertir : repli global).
        hasCalcomLink: Boolean(r.calcomLink?.trim()),
      })),
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ options: [] });
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
