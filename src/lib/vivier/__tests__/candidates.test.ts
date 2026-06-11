import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VivierCandidate } from '@/types/vivier';

const repo = {
  getVivierCandidate: vi.fn(),
  getVivierCandidateByEmail: vi.fn(),
  insertVivierCandidate: vi.fn(),
  setVivierCandidateCvPath: vi.fn(),
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

// Les ids sont désormais des uuid générés par la base (jamais fabriqués côté
// app) — on les représente par des uuid réalistes dans les fixtures.
const EXISTING_UUID = 'a1111111-1111-1111-1111-111111111111';
const NEW_UUID = 'b2222222-2222-2222-2222-222222222222';

function candidate(overrides: Partial<VivierCandidate> = {}): VivierCandidate {
  return {
    id: EXISTING_UUID,
    email: 'jane@doe.com',
    nom: 'Jane Doe',
    prenom: null,
    telephone: null,
    cvPath: `vivier/${EXISTING_UUID}/cv.pdf`,
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

  it('isVivierSearchable vrai seulement si indexed', async () => {
    const { isVivierSearchable } = await import('@/lib/vivier/candidates');
    expect(isVivierSearchable(candidate({ indexingStatus: 'indexed' }))).toBe(true);
    expect(isVivierSearchable(candidate({ indexingStatus: 'pending' }))).toBe(false);
    expect(isVivierSearchable(candidate({ indexingStatus: 'failed' }))).toBe(false);
  });
});

describe('upsertVivierCandidate — déduplication par email', () => {
  it('email inconnu ⇒ création insert-first (id généré par la base), upload puis cv_path', async () => {
    repo.getVivierCandidateByEmail.mockResolvedValueOnce(null);
    repo.insertVivierCandidate.mockResolvedValueOnce(
      candidate({ id: NEW_UUID, cvPath: null, indexingStatus: 'pending' }),
    );
    blob.uploadArtifactBinary.mockResolvedValueOnce({
      bucket: 'artifacts',
      path: `vivier/${NEW_UUID}/cv.pdf`,
      publicUrl: 'http://x',
    });
    repo.setVivierCandidateCvPath.mockResolvedValueOnce(
      candidate({
        id: NEW_UUID,
        cvPath: `vivier/${NEW_UUID}/cv.pdf`,
        indexingStatus: 'pending',
      }),
    );

    const { upsertVivierCandidate } = await import('@/lib/vivier/candidates');
    const res = await upsertVivierCandidate(baseInput());

    expect(repo.getVivierCandidateByEmail).toHaveBeenCalledWith('jane@doe.com');
    expect(res.created).toBe(true);
    expect(res.candidate.cvPath).toBe(`vivier/${NEW_UUID}/cv.pdf`);
    // Insert SANS id (la base génère l'uuid) et SANS cv_path (connu après upload).
    expect(repo.insertVivierCandidate).toHaveBeenCalledTimes(1);
    const insertArg = repo.insertVivierCandidate.mock.calls[0][0];
    expect(insertArg.email).toBe('jane@doe.com');
    expect(insertArg.id).toBeUndefined();
    expect(insertArg.cvPath).toBeNull();
    // Upload APRÈS l'insert, sous le chemin dérivé de l'id réel.
    expect(blob.uploadArtifactBinary.mock.calls[0][0].owner).toEqual({
      kind: 'vivier',
      id: NEW_UUID,
    });
    expect(repo.setVivierCandidateCvPath).toHaveBeenCalledWith(
      NEW_UUID,
      `vivier/${NEW_UUID}/cv.pdf`,
    );
    // Pas le chemin de mise à jour, pas d'ancien fichier à purger.
    expect(repo.updateVivierCandidateCV).not.toHaveBeenCalled();
    expect(blob.deleteArtifact).not.toHaveBeenCalled();
  });

  it('email connu ⇒ mise à jour (update), réutilise l’id existant', async () => {
    repo.getVivierCandidateByEmail.mockResolvedValueOnce(
      candidate({ id: EXISTING_UUID, cvPath: `vivier/${EXISTING_UUID}/cv.pdf` }),
    );
    blob.uploadArtifactBinary.mockResolvedValueOnce({
      bucket: 'artifacts',
      path: `vivier/${EXISTING_UUID}/cv.pdf`,
      publicUrl: 'http://x',
    });
    repo.updateVivierCandidateCV.mockResolvedValueOnce(
      candidate({ id: EXISTING_UUID, indexingStatus: 'pending' }),
    );

    const { upsertVivierCandidate } = await import('@/lib/vivier/candidates');
    const res = await upsertVivierCandidate(baseInput());

    expect(res.created).toBe(false);
    expect(blob.uploadArtifactBinary.mock.calls[0][0].owner).toEqual({
      kind: 'vivier',
      id: EXISTING_UUID,
    });
    expect(repo.updateVivierCandidateCV).toHaveBeenCalledTimes(1);
    expect(repo.insertVivierCandidate).not.toHaveBeenCalled();
    expect(repo.setVivierCandidateCvPath).not.toHaveBeenCalled();
    // Même chemin ⇒ pas de suppression d'ancien fichier.
    expect(blob.deleteArtifact).not.toHaveBeenCalled();
  });

  it('remplacement avec extension différente ⇒ purge de l’ancien fichier', async () => {
    repo.getVivierCandidateByEmail.mockResolvedValueOnce(
      candidate({ id: EXISTING_UUID, cvPath: `vivier/${EXISTING_UUID}/cv.txt` }),
    );
    blob.uploadArtifactBinary.mockResolvedValueOnce({
      bucket: 'artifacts',
      path: `vivier/${EXISTING_UUID}/cv.pdf`,
      publicUrl: 'http://x',
    });
    repo.updateVivierCandidateCV.mockResolvedValueOnce(
      candidate({ id: EXISTING_UUID, indexingStatus: 'pending' }),
    );

    const { upsertVivierCandidate } = await import('@/lib/vivier/candidates');
    await upsertVivierCandidate(baseInput());

    expect(blob.deleteArtifact).toHaveBeenCalledWith(
      `vivier/${EXISTING_UUID}/cv.txt`,
    );
  });
});

describe('deleteVivierCandidate — cascade + trace anonyme', () => {
  it('supprime fichier puis dossier, journalise sans donnée personnelle', async () => {
    repo.getVivierCandidate.mockResolvedValueOnce(
      candidate({ id: EXISTING_UUID, cvPath: `vivier/${EXISTING_UUID}/cv.pdf` }),
    );
    repo.deleteVivierCandidateRow.mockResolvedValueOnce(undefined);

    const { deleteVivierCandidate } = await import('@/lib/vivier/candidates');
    const res = await deleteVivierCandidate(EXISTING_UUID, {
      reason: 'candidate_request',
      actor: 'drh',
    });

    expect(res.deleted).toBe(true);
    expect(blob.deleteArtifact).toHaveBeenCalledWith(
      `vivier/${EXISTING_UUID}/cv.pdf`,
    );
    expect(repo.deleteVivierCandidateRow).toHaveBeenCalledWith(EXISTING_UUID);

    const entry = journal.appendJournalEntry.mock.calls[0][0];
    expect(entry.action).toBe('vivier_candidate_deleted');
    expect(entry.payload).toEqual({
      vivierId: EXISTING_UUID,
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
    const res = await deleteVivierCandidate(NEW_UUID, {
      reason: 'internal_decision',
    });
    expect(res.deleted).toBe(false);
    expect(journal.appendJournalEntry).not.toHaveBeenCalled();
    expect(repo.deleteVivierCandidateRow).not.toHaveBeenCalled();
  });
});
