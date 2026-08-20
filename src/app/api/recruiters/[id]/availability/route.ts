/**
 * /api/recruiters/[id]/availability — disponibilités et lieu d'entretien d'un
 * recruteur. Remplace le champ « lien Cal.com » de la fiche.
 *
 * AUTORISATION : son propre agenda, ou administrateur. C'est la seule route
 * du référentiel qui ne soit pas réservée aux administrateurs, et c'est
 * délibéré — un recruteur qui ne peut pas déclarer ses créneaux sans passer
 * par quelqu'un d'autre ne les tiendra pas à jour.
 *
 * GET  : réglages + règles hebdomadaires + exceptions + aperçu des prochains
 *        créneaux (le MÊME moteur que la page candidat : ce que le recruteur
 *        voit ici est exactement ce qui sera proposé).
 * PUT  : remplace l'ensemble (réglages, grille, exceptions). Remplacement
 *        plutôt que fusion : l'écran édite une grille entière, et un
 *        « ajouter/retirer » incrémental sur deux niveaux inventerait des
 *        conflits sans utilité.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  forbiddenResponse,
  getAdminApiUser,
  getApiUser,
  unauthorizedResponse,
} from '@/lib/auth/require-api-user';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  addException,
  listExceptions,
  listWeeklyRules,
  previewSlots,
  removeException,
  setWeeklyRules,
} from '@/lib/scheduling';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';
import {
  getRecruiterResource,
  upsertRecruiterResource,
} from '@/lib/scheduling-host/recruiter-resource';
import { MeetingLocationSchema } from '@/types/meeting-location';

export const runtime = 'nodejs';

/** Fenêtre de l'aperçu : deux semaines suffisent à voir si la grille tient. */
const PREVIEW_DAYS = 14;

const PutSchema = z.object({
  timezone: z.string().min(1).max(64).optional(),
  slotDurationMinutes: z.number().int().min(5).max(480).optional(),
  bufferMinutes: z.number().int().min(0).max(240).optional(),
  minNoticeMinutes: z.number().int().min(0).max(20_160).optional(),
  horizonDays: z.number().int().min(1).max(365).optional(),
  meetingLocation: MeetingLocationSchema.nullable().optional(),
  /** Plages LIBRES par jour — plusieurs par jour, aucune grille imposée. */
  rules: z
    .array(
      z.object({
        weekday: z.number().int().min(1).max(7),
        startMinute: z.number().int().min(0).max(1440),
        endMinute: z.number().int().min(0).max(1440),
      }),
    )
    .max(100)
    .optional(),
  exceptions: z
    .array(
      z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        startMinute: z.number().int().min(0).max(1440).nullable().optional(),
        endMinute: z.number().int().min(0).max(1440).nullable().optional(),
        label: z.string().max(200).nullable().optional(),
      }),
    )
    .max(200)
    .optional(),
});

/** `null` = autorisé ; sinon la réponse d'erreur à rendre. */
async function guard(targetId: string): Promise<NextResponse | null> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();
  if (user.id === targetId) return null;
  return (await getAdminApiUser()) ? null : forbiddenResponse();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const denied = await guard(id);
  if (denied) return denied;

  try {
    await ensureSchedulingConfigured();
    const resource = await getRecruiterResource(id);
    if (!resource) {
      // Jamais configuré : on rend un état vide explicite plutôt qu'un 404 —
      // l'écran doit pouvoir proposer de créer la grille.
      return NextResponse.json({
        configured: false,
        resource: null,
        rules: [],
        exceptions: [],
        preview: [],
      });
    }
    const from = new Date().toISOString();
    const to = new Date(Date.now() + PREVIEW_DAYS * 86_400_000).toISOString();
    const [rules, exceptions, preview] = await Promise.all([
      listWeeklyRules(id),
      listExceptions(id, { from: from.slice(0, 10) }),
      previewSlots(id, { from, to }),
    ]);
    return NextResponse.json({
      configured: true,
      resource,
      rules,
      exceptions,
      preview: preview.slice(0, 12),
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'availability_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const denied = await guard(id);
  if (denied) return denied;

  let parsed: z.infer<typeof PutSchema>;
  try {
    parsed = PutSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid request body.',
      },
      { status: 400 },
    );
  }

  // Une plage qui se termine avant de commencer est un créneau invisible : le
  // moteur l'ignorerait en silence, l'écran afficherait une grille menteuse.
  const badRule = (parsed.rules ?? []).find((r) => r.endMinute <= r.startMinute);
  if (badRule) {
    return NextResponse.json(
      {
        error: 'invalid_rule',
        message: 'Une plage doit se terminer après son début.',
      },
      { status: 422 },
    );
  }

  try {
    const recruiter = await getRecruiter(id);
    if (!recruiter) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const resource = await upsertRecruiterResource(recruiter, {
      ...(parsed.timezone !== undefined ? { timezone: parsed.timezone } : {}),
      ...(parsed.slotDurationMinutes !== undefined
        ? { slotDurationMinutes: parsed.slotDurationMinutes }
        : {}),
      ...(parsed.bufferMinutes !== undefined
        ? { bufferMinutes: parsed.bufferMinutes }
        : {}),
      ...(parsed.minNoticeMinutes !== undefined
        ? { minNoticeMinutes: parsed.minNoticeMinutes }
        : {}),
      ...(parsed.horizonDays !== undefined ? { horizonDays: parsed.horizonDays } : {}),
      ...(parsed.meetingLocation !== undefined
        ? { meetingLocation: parsed.meetingLocation }
        : {}),
    });

    if (parsed.rules) await setWeeklyRules(id, parsed.rules);

    if (parsed.exceptions) {
      // Remplacement : on retire ce qui n'est plus là, on ajoute le reste.
      const existing = await listExceptions(id);
      const wanted = new Set(
        parsed.exceptions.map(
          (e) => `${e.day}|${e.startMinute ?? ''}|${e.endMinute ?? ''}`,
        ),
      );
      for (const ex of existing) {
        const key = `${ex.day}|${ex.startMinute ?? ''}|${ex.endMinute ?? ''}`;
        if (!wanted.has(key)) await removeException(ex.id);
      }
      const known = new Set(
        existing.map(
          (ex) => `${ex.day}|${ex.startMinute ?? ''}|${ex.endMinute ?? ''}`,
        ),
      );
      for (const ex of parsed.exceptions) {
        const key = `${ex.day}|${ex.startMinute ?? ''}|${ex.endMinute ?? ''}`;
        if (!known.has(key)) {
          await addException(id, {
            day: ex.day,
            startMinute: ex.startMinute ?? null,
            endMinute: ex.endMinute ?? null,
            label: ex.label ?? null,
          });
        }
      }
    }

    const from = new Date().toISOString();
    const to = new Date(Date.now() + PREVIEW_DAYS * 86_400_000).toISOString();
    const [rules, exceptions, preview] = await Promise.all([
      listWeeklyRules(id),
      listExceptions(id, { from: from.slice(0, 10) }),
      previewSlots(id, { from, to }),
    ]);
    return NextResponse.json({
      configured: true,
      resource,
      rules,
      exceptions,
      preview: preview.slice(0, 12),
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'availability_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
