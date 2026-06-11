import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VivierCandidate } from '@/types/vivier';

const repo = {
  getVivierCandidate: vi.fn(),
  getVivierCandidateByEmail: vi.fn(),
  insertVivierCandidate: vi.fn(),
  updateVivierCandidateCV: vi.fn(),
  deleteVivierCandidateRow: vi.fn(),
};
const blob = {
  uploadArtifactBinary: vi.fn(),
  deleteArtifact: vi.fn(),
};
const journal = { appendJournalEntry: vi.fn() };

vi.mock('@/lib/db/repos/vivier', () => repo);
vi.mock('@/lib/storage/blob', () => blob);
vi.mock('@/lib/db/repos/journal', () => journal);

function candidate(overrides: Partial<VivierCandidate> = {}): VivierCandidate {
  return {
    id: 'VIV-0001',
    email: 'jane@doe.com',
    nom: 'Jane Doe',
    prenom: null,
    telephone: null,
    cvPath: 'vivier/VIV-0001/cv.pdf',
    cvText: 'texte cv',
    tags: [],
    source: 'manual_upload',
    indexingStatus: 'indexed',
    indexingError: null,
    enteredAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function baseInput() {
  return {
    email: '  Jane@Doe.com ',
    nom: 'Jane Doe',
    prenom: null,
    telephone: null,
    cvContent: Buffer.from('pdf-bytes'),
    cvFileName: 'jane.pdf',
    cvMimeType: 'application/pdf',
    cvText: 'texte cv',
    source: 'manual_upload' as const,
  };
}

beforeEach(() => {
  Object.values(repo).forEach((f) => f.mockReset());
  Object.values(blob).forEach((f) => f.mockReset());
  journal.appendJournalEntry.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('helpers purs', () => {
  it('normalizeEmail trim + lowercase', async () => {
    const { normalizeEmail } = await import('@/lib/vivier/candidates');
    expect(normalizeEmail('  Jean.Dupont@Mail.COM ')).toBe(
      'jean.dupont@mail.com',
    );
  });

  it('cvExtension reconnaît pdf/txt/md, défaut .pdf', async () => {
    const { cvExtension } = await import('@/lib/vivier/candidates');
    expect(cvExtension('cv.PDF')).toBe('.pdf');
    expect(cvExtension('lettre.txt')).toBe('.txt');
    expect(cvExtension('notes.md')).toBe('.md');
    expect(cvExtension('sansext')).toBe('.pdf');
  });

  it('generateVivierId renvoie VIV-NNNN', async () => {
    const { generateVivierId } = await import('@/lib/vivier/candidates');
    expect(generateVivierId()).toMatch(/^VIV-[0-9A-Z]{4,5}$/);
  });

  it('isVivierSearchable vrai seulement si indexed', async () => {
    const { isVivierSearchable } = await import('@/lib/vivier/candidates');
    expect(isVivierSearchable(candidate({ indexingStatus: 'indexed' }))).toBe(true);
    expect(isVivierSearchable(candidate({ indexingStatus: 'pending' }))).toBe(false);
    expect(isVivierSearchable(candidate({ indexingStatus: 'failed' }))).toBe(false);
  });
});

describe('upsertVivierCandidate — déduplication par email', () => {
  it('email inconnu ⇒ création (insert), email normalisé', async () => {
    repo.getVivierCandidateByEmail.mockResolvedValueOnce(null);
    blob.uploadArtifactBinary.mockResolvedValueOnce({
      bucket: 'artifacts',
      path: 'vivier/VIV-0009/cv.pdf',
      publicUrl: 'http://x',
    });
    repo.insertVivierCandidate.mockImplementationOnce(async (i) =>
      candidate({ id: i.id, email: i.email, cvPath: i.cvPath, indexingStatus: 'pending' }),
    );

    const { upsertVivierCandidate } = await import('@/lib/vivier/candidates');
    const res = await upsertVivierCandidate(baseInput());

    expect(repo.getVivierCandidateByEmail).toHaveBeenCalledWith('jane@doe.com');
    expect(res.created).toBe(true);
    expect(repo.insertVivierCandidate).toHaveBeenCalledTimes(1);
    expect(repo.insertVivierCandidate.mock.calls[0][0].email).toBe('jane@doe.com');
    expect(repo.updateVivierCandidateCV).not.toHaveBeenCalled();
    // Pas d'ancien fichier à purger.
    expect(blob.deleteArtifact).not.toHaveBeenCalled();
  });

  it('email connu ⇒ mise à jour (update), réutilise l’id existant', async () => {
    repo.getVivierCandidateByEmail.mockResolvedValueOnce(
      candidate({ id: 'VIV-0001', cvPath: 'vivier/VIV-0001/cv.pdf' }),
    );
    blob.uploadArtifactBinary.mockResolvedValueOnce({
      bucket: 'artifacts',
      path: 'vivier/VIV-0001/cv.pdf',
      publicUrl: 'http://x',
    });
    repo.updateVivierCandidateCV.mockResolvedValueOnce(
      candidate({ id: 'VIV-0001', indexingStatus: 'pending' }),
    );

    const { upsertVivierCandidate } = await import('@/lib/vivier/candidates');
    const res = await upsertVivierCandidate(baseInput());

    expect(res.created).toBe(false);
    expect(blob.uploadArtifactBinary.mock.calls[0][0].owner).toEqual({
      kind: 'vivier',
      id: 'VIV-0001',
    });
    expect(repo.updateVivierCandidateCV).toHaveBeenCalledTimes(1);
    expect(repo.insertVivierCandidate).not.toHaveBeenCalled();
    // Même chemin ⇒ pas de suppression d'ancien fichier.
    expect(blob.deleteArtifact).not.toHaveBeenCalled();
  });

  it('remplacement avec extension différente ⇒ purge de l’ancien fichier', async () => {
    repo.getVivierCandidateByEmail.mockResolvedValueOnce(
      candidate({ id: 'VIV-0001', cvPath: 'vivier/VIV-0001/cv.txt' }),
    );
    blob.uploadArtifactBinary.mockResolvedValueOnce({
      bucket: 'artifacts',
      path: 'vivier/VIV-0001/cv.pdf',
      publicUrl: 'http://x',
    });
    repo.updateVivierCandidateCV.mockResolvedValueOnce(
      candidate({ id: 'VIV-0001', indexingStatus: 'pending' }),
    );

    const { upsertVivierCandidate } = await import('@/lib/vivier/candidates');
    await upsertVivierCandidate(baseInput());

    expect(blob.deleteArtifact).toHaveBeenCalledWith('vivier/VIV-0001/cv.txt');
  });
});

describe('deleteVivierCandidate — cascade + trace anonyme', () => {
  it('supprime fichier puis dossier, journalise sans donnée personnelle', async () => {
    repo.getVivierCandidate.mockResolvedValueOnce(
      candidate({ id: 'VIV-0001', cvPath: 'vivier/VIV-0001/cv.pdf' }),
    );
    repo.deleteVivierCandidateRow.mockResolvedValueOnce(undefined);

    const { deleteVivierCandidate } = await import('@/lib/vivier/candidates');
    const res = await deleteVivierCandidate('VIV-0001', {
      reason: 'candidate_request',
      actor: 'drh',
    });

    expect(res.deleted).toBe(true);
    expect(blob.deleteArtifact).toHaveBeenCalledWith('vivier/VIV-0001/cv.pdf');
    expect(repo.deleteVivierCandidateRow).toHaveBeenCalledWith('VIV-0001');

    const entry = journal.appendJournalEntry.mock.calls[0][0];
    expect(entry.action).toBe('vivier_candidate_deleted');
    expect(entry.payload).toEqual({
      vivierId: 'VIV-0001',
      reason: 'candidate_request',
    });
    // La trace ne contient AUCUNE donnée personnelle.
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('jane@doe.com');
    expect(serialized).not.toContain('Jane');
  });

  it('dossier inexistant ⇒ deleted:false, pas de journal', async () => {
    repo.getVivierCandidate.mockResolvedValueOnce(null);
    const { deleteVivierCandidate } = await import('@/lib/vivier/candidates');
    const res = await deleteVivierCandidate('VIV-9999', {
      reason: 'internal_decision',
    });
    expect(res.deleted).toBe(false);
    expect(journal.appendJournalEntry).not.toHaveBeenCalled();
    expect(repo.deleteVivierCandidateRow).not.toHaveBeenCalled();
  });
});
