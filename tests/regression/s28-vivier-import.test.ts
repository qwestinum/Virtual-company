/**
 * S28 — Import initial du vivier (`npm run vivier:import`, 29/09/2026).
 *
 * Sur la base réelle, par le SEUL chemin d'écriture de l'import
 * (`createImportedCandidate`, celui qu'appelle le script) :
 *   1. le dossier importé porte sa source, sa provenance, sa date de
 *      référence de rétention (marquée comme telle) et son empreinte ; son CV
 *      est dans le stockage ;
 *   2. le dédoublonnage lit la base : même CV ⇒ doublon d'empreinte (y compris
 *      contre un dossier ANTÉRIEUR sans empreinte stockée, recalculée en
 *      mémoire), même adresse ⇒ doublon d'adresse, et une seconde écriture sur
 *      la même adresse ne crée RIEN (jamais de mise à jour) ;
 *   3. un candidat importé se PURGE comme les autres, par son adresse : ligne,
 *      fichier et contrôle final.
 *
 * ⚠️ Exige la migration du 29/09/2026 (`cv_fingerprint`, `provenance`,
 * `retention_reference_*`, CHECK `source` étendu à `import`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executeErasure } from '@/lib/gdpr/execute';
import { erasureMarker } from '@/lib/gdpr/marker';
import { buildFingerprint } from '@/lib/gdpr/payload-pseudonymize';
import { resolveIdentity } from '@/lib/gdpr/resolve';
import { planStorage } from '@/lib/gdpr/storage-plan';
import { verifyErasure } from '@/lib/gdpr/verify';
import { insertVivierCandidate, listVivierDedupIndex } from '@/lib/db/repos/vivier';
import { ARTIFACTS_BUCKET } from '@/lib/storage/blob';
import { cvTextFingerprint } from '@/lib/vivier/import/fingerprint';
import { DedupIndex, surveyFile } from '@/lib/vivier/import/pipeline';
import type { ImportFile } from '@/lib/vivier/import/sources';
import { createImportedCandidate } from '@/lib/vivier/import/write';

import { cleanAll, db, readRows } from './helpers/db';

const suffix = Math.random().toString(36).slice(2, 8);
const EMAIL = `s28-import-${suffix}@test.local`;
const LEGACY_EMAIL = `s28-ancien-${suffix}@test.local`;
const TEXT = `Camille Importée — cheffe de projet — ${EMAIL}`;
const LEGACY_TEXT = `Dossier antérieur à l'import — ${LEGACY_EMAIL}`;
const PROVENANCE = 'import initial du 29/09/2026, fonds du cabinet';
let importedId = '';

function asFile(name: string, text: string): ImportFile {
  return {
    displayPath: name,
    fileName: name,
    mimeType: 'application/pdf',
    modifiedAt: null,
    load: async () => Buffer.from(text),
  };
}
const extractAsIs = {
  extractText: async (b: Buffer) => b.toString(),
  extractErrorCode: () => null,
};
const retention = () => ({ at: '2026-09-29T00:00:00.000Z', kind: 'import_date' as const });

async function freshIndex(): Promise<DedupIndex> {
  const rows = await listVivierDedupIndex();
  return new DedupIndex(
    rows.map((r) => ({
      email: r.email,
      cvFingerprint: r.cvFingerprint ?? (r.cvText ? cvTextFingerprint(r.cvText) : null),
    })),
  );
}

beforeAll(async () => {
  await cleanAll();
  // Un dossier ANTÉRIEUR à l'import : aucune empreinte stockée.
  await insertVivierCandidate({
    email: LEGACY_EMAIL,
    nom: 'Dossier Ancien',
    prenom: null,
    telephone: null,
    cvPath: null,
    cvFileName: 'ancien.pdf',
    cvText: LEGACY_TEXT,
    source: 'manual_upload',
  });
});

afterAll(async () => {
  await cleanAll();
});

describe('S28.1 — le dossier importé dit d’où il vient', () => {
  it('source, provenance, rétention marquée, empreinte, fichier stocké', async () => {
    const created = await createImportedCandidate({
      email: EMAIL.toUpperCase(),
      fullName: 'Camille Importée',
      phone: null,
      fileName: 'CV Camille.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('%PDF-1.4 s28'),
      text: TEXT,
      fingerprint: cvTextFingerprint(TEXT)!,
      provenance: PROVENANCE,
      retention: { at: '2024-03-14T00:00:00.000Z', kind: 'application_date' },
    });
    if (created === 'duplicate_email') throw new Error('doublon inattendu');
    importedId = created.id;

    const [row] = await readRows<{
      email: string;
      source: string;
      provenance: string;
      cv_fingerprint: string;
      retention_reference_at: string;
      retention_reference_kind: string;
      indexing_status: string;
      cv_path: string;
    }>('vivier_candidates', { id: importedId });
    expect(row).toMatchObject({
      email: EMAIL,
      source: 'import',
      provenance: PROVENANCE,
      cv_fingerprint: cvTextFingerprint(TEXT),
      retention_reference_kind: 'application_date',
      indexing_status: 'pending',
    });
    expect(new Date(row!.retention_reference_at).toISOString()).toBe('2024-03-14T00:00:00.000Z');
    const file = await db().storage.from(ARTIFACTS_BUCKET).download(row!.cv_path);
    expect(file.error).toBeNull();
  });

  it('la base refuse une date de rétention sans sa nature', async () => {
    const { error } = await db()
      .from('vivier_candidates')
      .update({ retention_reference_kind: null })
      .eq('id', importedId);
    expect(error).not.toBeNull();
  });
});

describe('S28.2 — le dédoublonnage lit la base', () => {
  it('même CV (mis en page autrement) : doublon d’empreinte', async () => {
    const r = await surveyFile('b', asFile('copie.pdf', `\n${TEXT.toUpperCase()}  `), await freshIndex(), retention, extractAsIs);
    expect(r.result.outcome).toBe('duplicate_fingerprint');
  });

  it('dossier antérieur SANS empreinte : l’empreinte est recalculée, le doublon attrapé', async () => {
    const r = await surveyFile('b', asFile('ancien-bis.pdf', LEGACY_TEXT), await freshIndex(), retention, extractAsIs);
    expect(r.result.outcome).toBe('duplicate_fingerprint');
  });

  it('autre CV, même adresse : doublon d’adresse', async () => {
    const r = await surveyFile('b', asFile('v2.pdf', `Version 2 — ${EMAIL}`), await freshIndex(), retention, extractAsIs);
    expect(r.result.outcome).toBe('duplicate_email');
  });

  it('une seconde écriture sur la même adresse ne crée rien et ne touche à rien', async () => {
    const again = await createImportedCandidate({
      email: EMAIL,
      fullName: 'Autre Nom',
      phone: null,
      fileName: 'autre.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('%PDF-1.4 autre'),
      text: 'autre texte',
      fingerprint: cvTextFingerprint('autre texte')!,
      provenance: PROVENANCE,
      retention: retention(),
    });
    expect(again).toBe('duplicate_email');
    const rows = await readRows<{ nom: string }>('vivier_candidates', { email: EMAIL });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nom).toBe('Camille Importée');
  });
});

describe('S28.3 — un candidat importé se purge comme les autres', () => {
  it('par son adresse : ligne et fichier effacés, contrôle final propre', async () => {
    const identity = await resolveIdentity(db(), { emails: [EMAIL] });
    expect(identity.vivierIds).toContain(importedId);
    const fp = buildFingerprint({ emails: identity.emails, names: identity.names, phones: identity.phones });
    const plan = await planStorage(db(), identity, fp);
    const result = await executeErasure({
      db: db(),
      identity,
      fingerprint: fp,
      marker: erasureMarker('S28 — instruction de test'),
      storage: plan.targets,
      purgeAnalyses: false,
      sourcingOppositionFingerprints: [],
      dryRun: false,
      actor: 's28',
    });
    expect(result.error).toBeNull();
    expect(result.counts.vivierDossiers).toBe(1);
    expect(await readRows('vivier_candidates', { id: importedId })).toHaveLength(0);
    const listing = await db().storage.from(ARTIFACTS_BUCKET).list(`vivier/${importedId}`);
    expect(listing.data ?? []).toHaveLength(0);

    const outcome = await verifyErasure(db(), identity, fp);
    expect(outcome.residues).toEqual([]);
    expect(outcome.status).toBe('clean');
  });
});
