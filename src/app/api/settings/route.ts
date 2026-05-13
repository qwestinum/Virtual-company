/**
 * /api/settings — GET + PUT des settings applicatifs (Session 6 v4).
 *
 * GET renvoie l'objet « settings » courant (ou un payload neutre si
 * Supabase absent — mode démo local). PUT accepte un patch partiel
 * validé via zod et renvoie la nouvelle version persistée.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  getAppSettings,
  patchAppSettings,
  type IntegrationConfig,
} from '@/lib/db/repos/app-settings';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { invalidateEmailAddressesCache } from '@/lib/email/addresses';

export const runtime = 'nodejs';

const IntegrationSchema = z.object({
  status: z.enum(['configured', 'unconfigured']),
  credential: z.string().max(2048).optional(),
  notes: z.string().max(2048).optional(),
});

const PatchSchema = z.object({
  synthesisEmail: z.string().email().nullable().optional(),
  synthesisEmails: z.array(z.string().email()).optional(),
  senderEmail: z.string().email().nullable().optional(),
  senderEmails: z.array(z.string().email()).optional(),
  intakeEmail: z.string().email().nullable().optional(),
  fluxConfig: z.record(z.string(), IntegrationSchema).optional(),
  channelsConfig: z.record(z.string(), IntegrationSchema).optional(),
});

/**
 * Adresses email en provenance des variables d'environnement — utilisées
 * par le pipeline tant que le DRH n'a rien sauvegardé en DB. On les
 * remonte au client pour qu'il puisse afficher « le pipeline utilise
 * actuellement xxx » au lieu de prétendre qu'aucune adresse n'est
 * configurée.
 */
function envFallbacks() {
  return {
    synthesisEmail: process.env.EMAIL_DRH ?? null,
    senderEmail: process.env.EMAIL_FROM ?? null,
  };
}

function emptyPayload() {
  return {
    offline: true,
    fallbacks: envFallbacks(),
    settings: {
      synthesisEmail: null,
      synthesisEmails: [] as string[],
      senderEmail: null,
      senderEmails: [] as string[],
      intakeEmail: null,
      fluxConfig: {} as Record<string, IntegrationConfig>,
      channelsConfig: {} as Record<string, IntegrationConfig>,
      updatedAt: new Date(0).toISOString(),
    },
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const settings = await getAppSettings();
    if (!settings) return NextResponse.json(emptyPayload());
    return NextResponse.json({
      offline: false,
      fallbacks: envFallbacks(),
      settings,
    });
  } catch (err) {
    // Toute erreur côté DB (table absente, droits insuffisants, etc.)
    // est traduite en payload vide « offline » côté UI — on ne 500 jamais
    // sur le GET d'une page Settings purement de lecture.
    console.error('[api/settings] GET failed', err);
    return NextResponse.json(emptyPayload());
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
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
    const next = await patchAppSettings(parsed);
    // Force le prochain `getSynthesisEmail()` / `getSenderEmail()` à
    // relire la DB plutôt que d'attendre les 60s du TTL.
    invalidateEmailAddressesCache();
    return NextResponse.json({ settings: next });
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
