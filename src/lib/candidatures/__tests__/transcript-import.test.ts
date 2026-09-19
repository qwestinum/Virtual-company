/**
 * Import de transcription — la transcription ne survit pas, même en échec.
 * Spec : docs/specs/compte-rendu-entretien.md §5.6, §12.
 *
 * Tenu au runtime (modèle simulé qui échoue en CITANT le texte) ET
 * structurellement (aucun module de la chaîne n'importe le stockage, le
 * système de fichiers, ni ne recopie un message d'erreur).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const CANARY = 'CANARI_UNITAIRE_42';
const structureTranscript = vi.fn();
const saveInterviewReport = vi.fn(async () => ({ status: 'saved', report: { id: 'ir-1' } }));
const appendJournalEntry = vi.fn(async () => undefined);
let enabled = true;

vi.mock('@/lib/agents/interview-report-structuring', () => ({
  structureTranscript: (args: unknown) => structureTranscript(args),
}));
vi.mock('@/lib/candidatures/interview-report', () => ({
  interviewHappened: vi.fn(async () => true),
  loadCriterionPrompts: vi.fn(async () => []),
}));
vi.mock('@/lib/db/repos/app-settings', () => ({
  getAppSettings: vi.fn(async () => ({ interviewConfig: { transcriptImportEnabled: enabled } })),
}));
vi.mock('@/lib/db/repos/interview-reports', () => ({
  getInterviewReport: vi.fn(async () => null),
  saveInterviewReport: () => saveInterviewReport(),
}));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: () => appendJournalEntry() }));

const { importTranscript } = await import('@/lib/candidatures/transcript-import');

const analysis = { id: 'can_1', uid: 'uid-1', campaignId: 'CAMP-2026-001' };
const twoSpeakers = `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Sami>Bonjour et bienvenue.</v>\n\n00:00:03.000 --> 00:00:04.000\n<v Jean>Merci, ${CANARY} au passage.</v>`;
const file = (content: string, name = 'entretien.vtt', type = 'text/vtt') => new File([content], name, { type });

beforeEach(() => {
  vi.clearAllMocks();
  enabled = true;
});

describe('importTranscript', () => {
  it('réglage éteint : rien lu, rien envoyé', async () => {
    enabled = false;
    expect(await importTranscript({ analysis, file: file(twoSpeakers), candidateSpeaker: null, actor: null })).toEqual({
      status: 'disabled',
    });
    expect(structureTranscript).not.toHaveBeenCalled();
  });

  it('plusieurs locuteurs sans choix : on demande, AUCUN appel au modèle', async () => {
    const out = await importTranscript({ analysis, file: file(twoSpeakers), candidateSpeaker: null, actor: null });
    expect(out).toEqual({ status: 'choose_speaker', speakers: ['Sami', 'Jean'] });
    expect(structureTranscript).not.toHaveBeenCalled();
  });

  it('un locuteur inconnu ne vaut pas choix', async () => {
    const out = await importTranscript({ analysis, file: file(twoSpeakers), candidateSpeaker: 'Paul', actor: null });
    expect(out.status).toBe('choose_speaker');
  });

  it('format inconnu : refusé sans lecture', async () => {
    const out = await importTranscript({ analysis, file: file('x', 'entretien.odt', 'application/vnd.oasis.opendocument.text'), candidateSpeaker: null, actor: null });
    expect(out).toEqual({ status: 'unsupported_format' });
  });

  it('trop volumineux : refusé avant toute lecture', async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'e.txt');
    expect((await importTranscript({ analysis, file: big, candidateSpeaker: null, actor: null })).status).toBe('too_large');
  });

  it('ÉCHEC du modèle qui cite le texte : rien écrit, rien en console', async () => {
    structureTranscript.mockRejectedValueOnce(new SyntaxError(`Unexpected token near « ${CANARY} »`));
    const lines: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (a instanceof Error ? `${a.name} ${a.message}` : String(a))).join(' '));
      }),
    );
    const out = await importTranscript({ analysis, file: file(twoSpeakers), candidateSpeaker: 'Jean', actor: null });
    for (const spy of spies) spy.mockRestore();
    expect(out).toEqual({ status: 'generation_failed' });
    expect(saveInterviewReport).not.toHaveBeenCalled();
    expect(appendJournalEntry).not.toHaveBeenCalled();
    expect(lines.join('\n')).not.toContain(CANARY);
    expect(lines.join('\n')).toContain('SyntaxError');
  });
});

describe('garde structurelle — la chaîne d’import ne stocke rien', () => {
  const FILES = [
    'src/lib/candidatures/transcript-import.ts',
    'src/lib/agents/interview-report-structuring.ts',
    'src/lib/transcript/normalize.ts',
    'src/lib/transcript/structure.ts',
    'src/app/api/candidatures/[id]/interview-report/transcript/route.ts',
  ];

  it.each(FILES)('%s : ni stockage, ni fichier, ni message d’erreur recopié', (path) => {
    // Le CODE, pas les commentaires (qui disent justement « jamais err.message »).
    const source = readFileSync(join(process.cwd(), path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^\s*\/\/.*$/gmu, '');
    for (const forbidden of ['@/lib/storage', "from 'node:fs'", "from 'fs'", 'writeFile', 'tmpdir', '.message)', 'err.message', 'error.message']) {
      expect(source, `${path} contient « ${forbidden} »`).not.toContain(forbidden);
    }
  });
});
