/**
 * GET /api/recruiters/options — recruteurs ACTIFS pour le sélecteur
 * « Recruteur référent » d'une campagne. Accessible à toute session (un
 * member édite ses campagnes) : projection MINIMALE {id, displayName,
 * hasCalcomLink, hasAvailability} — ni email, ni rôle (réservés à la gestion
 * admin).
 *
 * `hasAvailability` évite de faire choisir à l'aveugle : sur une campagne en
 * réservation native, désigner un référent sans créneaux rend les liens déjà
 * envoyés inopérants (page « momentanément indisponible ») et bloque les
 * invitations suivantes. L'information doit être VISIBLE au moment du choix,
 * pas découverte après coup dans le panneau des cibles orphelines.
 */
import { NextResponse } from 'next/server';

import { listActiveRecruiters } from '@/lib/db/repos/recruiters';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { listBookableResources } from '@/lib/scheduling';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const recruiters = await listActiveRecruiters();
    // Deux requêtes au total, pas une par recruteur. Fail-soft : si le module
    // est injoignable, on rend la liste sans l'annotation plutôt que rien.
    const bookable = await (async () => {
      try {
        await ensureSchedulingConfigured();
        return new Set(await listBookableResources());
      } catch {
        return null;
      }
    })();
    return NextResponse.json({
      options: recruiters.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        // Signale un référent SANS lien (l'UI peut avertir : repli global).
        hasCalcomLink: Boolean(r.calcomLink?.trim()),
        // `null` = indéterminé (module injoignable) : l'UI n'avertit pas à tort.
        hasAvailability: bookable === null ? null : bookable.has(r.id),
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
