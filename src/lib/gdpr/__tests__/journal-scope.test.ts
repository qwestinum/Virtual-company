/**
 * Périmètre du journal — LE test de non-débordement.
 *
 * Une ligne entre par un IDENTIFIANT ou par un identifiant FORT (adresse,
 * téléphone). Jamais par le nom. Si ce test tombe, l'outil est devenu capable
 * de caviarder le dossier d'un homonyme : un dommage irréversible infligé à
 * quelqu'un qui n'a rien demandé.
 */
import { describe, expect, it } from 'vitest';

import { isInScope, type JournalRow } from '@/lib/gdpr/journal-scope';
import { buildFingerprint } from '@/lib/gdpr/payload-pseudonymize';
import type { ErasureIdentity } from '@/types/gdpr';

const identity: ErasureIdentity = {
  emails: ['jean.dupont@exemple.fr'],
  names: ['Jean Dupont'],
  phones: ['+33 6 12 34 56 78'],
  analysisIds: ['can_imap_mb_1_1624'],
  uids: ['1624'],
  imapRefs: [{ mailboxId: 'mb_1', uid: '1624' }],
  campaignIds: ['CAMP-2026-051'],
  fileNames: ['CV-Jean-Dupont.pdf'],
  vivierIds: ['11111111-1111-1111-1111-111111111111'],
  briefIds: ['brief-1'],
  validationIds: ['val_imap_mb_1_1624_reject'],
  linkTokens: ['tok-1'],
  bookingIds: ['book-1'],
  artifactIds: ['art_imap_cvfile_mb_1_1624'],
  unmatchedIds: [],
  storagePaths: [],
};

const fp = buildFingerprint({
  emails: identity.emails,
  names: identity.names,
  phones: identity.phones,
});

const row = (payload: Record<string, unknown>): JournalRow => ({
  id: 1,
  action: 'test',
  campaign_id: 'CAMP-2026-051',
  payload,
});

describe('entrent dans le périmètre', () => {
  it('par le uid', () => {
    expect(isInScope(row({ uid: '1624', mode: 'reject' }), identity, fp)).toBe(true);
  });

  it('par l’identifiant d’analyse', () => {
    expect(isInScope(row({ analysisId: 'can_imap_mb_1_1624' }), identity, fp)).toBe(true);
  });

  it('par le dossier de vivier', () => {
    expect(
      isInScope(row({ candidateId: '11111111-1111-1111-1111-111111111111' }), identity, fp),
    ).toBe(true);
  });

  it('par l’adresse, même sous une clé imprévue et imbriquée', () => {
    expect(
      isInScope(row({ détail: { destinataire: 'jean.dupont@exemple.fr' } }), identity, fp),
    ).toBe(true);
  });

});

describe('N’ENTRENT PAS dans le périmètre', () => {
  it('un HOMONYME — même nom, aucune autre correspondance', () => {
    const homonyme = row({ candidate: 'Jean Dupont', uid: '9999' });
    expect(isInScope(homonyme, identity, fp)).toBe(false);
  });

  it('une ligne de la MÊME campagne qui ne concerne pas la personne', () => {
    expect(isInScope(row({ uid: '9999', candidate: 'Marie Martin' }), identity, fp)).toBe(false);
  });

  it('une ligne technique sans identité', () => {
    expect(
      isInScope(row({ mailboxId: 'mb_1', reason: 'open_timeout' }), identity, fp),
    ).toBe(false);
  });

  it('un TÉLÉPHONE partagé — un fixe de foyer n’est pas une identité', () => {
    // Trois candidats des fixtures de régression portent le même numéro. Si
    // le téléphone faisait entrer une ligne, purger l'un caviarderait les
    // deux autres.
    expect(isInScope(row({ note: 'rappeler au 06 12 34 56 78' }), identity, fp)).toBe(false);
  });

  it('une adresse simplement PROCHE', () => {
    expect(
      isInScope(row({ sentTo: 'jean.dupont@exemple.com' }), identity, fp),
    ).toBe(false);
  });

  it('l’adresse d’un recruteur', () => {
    expect(
      isInScope(row({ actorEmail: 'recruteur@client.fr', uid: '9999' }), identity, fp),
    ).toBe(false);
  });
});
