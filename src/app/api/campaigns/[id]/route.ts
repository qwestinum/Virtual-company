/**
 * /api/campaigns/[id] — PATCH ciblé (Session 5, round 1).
 *
 * Sert aux mises à jour partielles fréquentes :
 *   - changement de statut (paused / closed / recompute)
 *   - ajout d'un canal publié
 *   - marquage sources confirmées
 *
 * Pour les changements lourds (FDP, scoringSheet), passer par PUT
 * /api/campaigns avec le snapshot complet.
 */
import { NextResponse, after } from 'next/server';
import { z } from 'zod';

import { getCampaign, patchCampaign } from '@/lib/db/repos/campaigns';
import {
  canReceiveReplay,
  drainPendingSheetCvs,
} from '@/lib/imap/unmatched-replay';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { setTargetLocationOverride } from '@/lib/scheduling';
import { ensureCampaignTarget } from '@/lib/scheduling-host/campaign-booking';
import { MeetingLocationSchema } from '@/types/meeting-location';
import { recruiterCanHostBookings } from '@/lib/scheduling-host/recruiter-resource';
import { CampaignStatusSchema } from '@/types/campaign-status';
import { PublicationChannelSchema } from '@/types/publication-channel';

export const runtime = 'nodejs';

const PatchSchema = z.object({
  status: CampaignStatusSchema.optional(),
  publishedChannels: z.array(PublicationChannelSchema).optional(),
  sourcesConfirmed: z.boolean().optional(),
  threshold: z.number().int().min(0).max(100).optional(),
  /** Recruteur référent — change aussi l'agenda de TOUS les liens en vol. */
  ownerUserId: z.string().uuid().nullable().optional(),
  /**
   * Réservation native pour cette campagne. SEUL chemin d'écriture du flag
   * (le PUT snapshot ne le porte pas, par construction du type
   * `CampaignSnapshot`) — un client dont l'état date d'avant l'activation ne
   * doit pas pouvoir la défaire sans le vouloir.
   */
  schedulingNative: z.boolean().optional(),
  /**
   * Lieu de rencontre PROPRE à cette campagne (surcharge du lieu par défaut du
   * référent) : un entretien sur site client n'a pas à changer le réglage
   * personnel du recruteur. `null` = retour au lieu du référent.
   */
  meetingLocationOverride: MeetingLocationSchema.nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  let parsed: z.infer<typeof PatchSchema>;
  try {
    parsed = PatchSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid request body.',
      },
      { status: 400 },
    );
  }

  try {
    // INVARIANT SERVEUR « active ⇒ fiche de scoring validée » : le verrou ne
    // vivait que côté client (campaigns-store.activateCampaign) — or c'est la
    // prémisse de tout le pipeline de réception (C4, drain, scoring). Un client
    // direct de l'API ne doit pas pouvoir activer une campagne non scorable.
    if (parsed.status === 'active') {
      const existing = await getCampaign(id);
      if (!existing) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      if (existing.scoringSheet?.isValidated !== true) {
        return NextResponse.json(
          {
            error: 'scoring_sheet_not_validated',
            message:
              'Impossible d’activer la campagne : la fiche de scoring doit être validée.',
          },
          { status: 409 },
        );
      }
    }

    // ─── Réservation native : garde-fou d'activation ────────────────────
    // Basculer une campagne dont le référent ne peut pas recevoir de
    // réservations produirait des invitations bloquées, une par candidat, sans
    // que personne ne comprenne pourquoi. On refuse AVANT, avec le geste à
    // faire. (Désactiver, en revanche, est toujours permis : c'est le retour
    // au régime historique, et il doit rester à un clic.)
    if (parsed.schedulingNative === true) {
      const existing = await getCampaign(id);
      if (!existing) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      const owner = parsed.ownerUserId ?? existing.ownerUserId;
      if (!owner || !(await recruiterCanHostBookings(owner))) {
        return NextResponse.json(
          {
            error: 'owner_not_bookable',
            message:
              'Cette campagne a besoin d’un recruteur référent actif dont les disponibilités sont configurées (Paramètres → Agendas & disponibilités).',
          },
          { status: 409 },
        );
      }
    }

    // La surcharge de lieu vit sur la CIBLE, côté module — pas sur la ligne
    // campagne : c'est le module qui la résout à la confirmation. Elle est
    // donc retirée du patch de ligne.
    const { meetingLocationOverride, ...campaignPatch } = parsed;


    // ⚠️ `patchCampaign` rend `null` pour DEUX raisons : campagne absente, ou
    // patch vide. Un corps qui ne porte QUE le lieu laisse un patch vide — le
    // lire comme « campagne absente » répondait 404 et n'enregistrait rien
    // (défaut constaté à l'usage : « Le lieu de la campagne n'a pas pu être
    // enregistré », à chaque fois). On ne lui donne plus l'occasion d'être
    // ambigu : sans champ de ligne, on relit la campagne au lieu de l'écrire.
    const updated =
      Object.keys(campaignPatch).length > 0
        ? await patchCampaign(id, campaignPatch)
        : await getCampaign(id);
    if (!updated) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // Le lieu est le geste PRINCIPAL de son écran : son échec doit se voir.
    // Avaler l'erreur affichait « enregistré » sur un lieu jamais écrit —
    // l'exact symétrique du 404 corrigé au-dessus.
    // Demander un lieu de campagne hors réservation native n'a pas de sens :
    // il n'y a pas de cible où l'écrire. On le DIT (409) au lieu de l'ignorer
    // en rendant 200 — sinon l'écran annonce un enregistrement fantôme.
    if (meetingLocationOverride !== undefined && !updated.schedulingNative) {
      return NextResponse.json(
        {
          error: 'not_native',
          message:
            'Le lieu de campagne n’existe que pour une campagne en réservation native.',
        },
        { status: 409 },
      );
    }

    let meetingLocationSaved: boolean | null = null;
    if (meetingLocationOverride !== undefined && updated.schedulingNative) {
      try {
        await ensureCampaignTarget(id, updated.ownerUserId);
        await setTargetLocationOverride(id, meetingLocationOverride);
        meetingLocationSaved = true;
      } catch (err) {
        console.error('[campaigns] lieu de campagne KO', err);
        meetingLocationSaved = false;
      }
    }

    // Le référent a bougé (ou la campagne vient de basculer) : la CIBLE suit.
    // Tous les liens déjà envoyés montrent dès maintenant le nouvel agenda ;
    // les rendez-vous déjà pris ne bougent pas — ils ont figé leur ressource.
    if (parsed.ownerUserId !== undefined || parsed.schedulingNative === true) {
      if (updated.schedulingNative) {
        await ensureCampaignTarget(id, updated.ownerUserId).catch((err) =>
          console.error('[campaigns] re-pointage de la cible KO', err),
        );
      }
    }
    // C4 : une (ré)activation d'une campagne à fiche validée draine les CV
    // reçus « en attente de fiche » (fire-and-forget, idempotent).
    if (parsed.status === 'active' && canReceiveReplay(updated)) {
      after(() => drainPendingSheetCvs(updated));
    }
    // Le lieu était la SEULE intention et il a échoué : c'est un échec, pas
    // une réussite partielle.
    if (meetingLocationSaved === false && Object.keys(campaignPatch).length === 0) {
      return NextResponse.json(
        {
          error: 'meeting_location_failed',
          message: 'Le lieu de la campagne n’a pas pu être enregistré.',
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ campaign: updated, meetingLocationSaved });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
