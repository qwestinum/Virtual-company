/**
 * Invocation EN-PROCESS des handlers de routes Next (le « client » de la
 * suite) + constructeurs du jeu de données canonique.
 *
 * `call(handler, …)` fabrique la même Request qu'un fetch client et retourne
 * { status, json }. Les routes dynamiques reçoivent `{ params: Promise<…> }`
 * (contrat Next 15+).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildEmptyFDP, type FDPInProgress } from '@/types/field-collection';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';

type Handler = (req: Request) => Promise<Response>;
type HandlerWithParams = (
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

export type ApiResult = { status: number; json: Record<string, unknown> };

async function toResult(res: Response): Promise<ApiResult> {
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // 204 / corps vide.
  }
  return { status: res.status, json };
}

export async function call(
  handler: Handler,
  init?: { method?: string; body?: unknown; form?: FormData; query?: string },
): Promise<ApiResult> {
  const url = `http://regression.test/api${init?.query ? `?${init.query}` : ''}`;
  const request = buildRequest(url, init);
  return toResult(await handler(request));
}

export async function callWithId(
  handler: HandlerWithParams,
  id: string,
  init?: { method?: string; body?: unknown; form?: FormData; query?: string },
): Promise<ApiResult> {
  const url = `http://regression.test/api${init?.query ? `?${init.query}` : ''}`;
  const request = buildRequest(url, init);
  return toResult(await handler(request, { params: Promise.resolve({ id }) }));
}

function buildRequest(
  url: string,
  init?: { method?: string; body?: unknown; form?: FormData },
): Request {
  if (init?.form) {
    return new Request(url, { method: init.method ?? 'POST', body: init.form });
  }
  if (init?.body !== undefined) {
    return new Request(url, {
      method: init.method ?? 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(init.body),
    });
  }
  return new Request(url, { method: init?.method ?? 'GET' });
}

/** Attend qu'une condition d'état (base) devienne vraie — effets `after()`. */
export async function until<T>(
  probe: () => Promise<T | null | undefined | false>,
  label: string,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`until(${label}) : condition jamais vraie en ${timeoutMs} ms`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ─── Jeu de données canonique ──────────────────────────────────────────────

export const TEST_JOB_TITLE = 'Testeur Logiciel TREG';

/**
 * LA fiche de scoring canonique de la suite : 4 critères, tous évalués par le
 * LLM (`llm_with_quote`, défaut) — les fixtures de verdicts (llm-fixtures.ts)
 * sont indexées sur CET ordre. Poids : 0 (rédhibitoire), 8, 6, 4 (total 18).
 */
export function testScoringSheet(
  campaignId: string,
  opts?: { validated?: boolean },
): ScoringSheet {
  return {
    campaignId,
    isValidated: opts?.validated ?? true,
    criteria: [
      buildCriterion({ id: 'treg-ko', label: 'Diplome informatique requis', level: 'redhibitoire' }),
      buildCriterion({ id: 'treg-c1', label: 'Experience du test logiciel', level: 'critique' }),
      buildCriterion({ id: 'treg-c2', label: 'Maitrise de SQL', level: 'tres_important' }),
      buildCriterion({ id: 'treg-c3', label: 'Anglais professionnel', level: 'important' }),
    ],
  };
}

function testFdp(campaignId: string, jobTitle: string): FDPInProgress {
  const fdp = buildEmptyFDP(campaignId);
  fdp.fields.job_title = {
    ...fdp.fields.job_title,
    status: 'filled',
    value: jobTitle,
  };
  fdp.isComplete = true;
  fdp.isValidated = true;
  return fdp;
}

export type TestCampaignInput = {
  id: string;
  name?: string;
  status?: 'draft' | 'in_progress' | 'active' | 'paused' | 'closed';
  jobTitle?: string;
  thresholdLow?: number;
  thresholdHigh?: number;
  sheetValidated?: boolean;
  /** `null` = campagne SANS fiche de scoring. */
  withSheet?: boolean;
  sources?: Array<'manual' | 'email' | 'vivier'>;
};

/** Payload complet du PUT /api/campaigns (snapshot campagne, contrat client). */
export function testCampaignPayload(input: TestCampaignInput) {
  const now = new Date().toISOString();
  return {
    id: input.id,
    name: input.name ?? `[TREG] ${input.jobTitle ?? TEST_JOB_TITLE}`,
    status: input.status ?? 'draft',
    fdp: testFdp(input.id, input.jobTitle ?? TEST_JOB_TITLE),
    scoringSheet:
      input.withSheet === false
        ? null
        : testScoringSheet(input.id, { validated: input.sheetValidated ?? true }),
    publishedChannels: [],
    sourcesConfirmed: true,
    thresholdLow: input.thresholdLow ?? 30,
    thresholdHigh: input.thresholdHigh ?? 75,
    sources: input.sources ?? ['manual', 'email'],
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Fixtures CV (PDF réels commités) ──────────────────────────────────────

export function cvPdfFile(profile: 'fort' | 'faible' | 'moyen'): File {
  const path = resolve(process.cwd(), `tests/regression/fixtures/cv-${profile}.pdf`);
  const buffer = readFileSync(path);
  return new File([new Uint8Array(buffer)], `cv-${profile}-treg.pdf`, {
    type: 'application/pdf',
  });
}

/** FormData du POST /api/cv-analyzer, tel que le client le construit. */
export function cvAnalyzerForm(args: {
  profile: 'fort' | 'faible' | 'moyen';
  campaignId: string;
  sheet: ScoringSheet;
  thresholdLow: number;
  thresholdHigh: number;
  taskId?: string;
}): FormData {
  const form = new FormData();
  form.append('cv', cvPdfFile(args.profile));
  form.append('scoringSheet', JSON.stringify(args.sheet));
  form.append('thresholdLow', String(args.thresholdLow));
  form.append('thresholdHigh', String(args.thresholdHigh));
  form.append('campaignId', args.campaignId);
  if (args.taskId) form.append('taskId', args.taskId);
  return form;
}
