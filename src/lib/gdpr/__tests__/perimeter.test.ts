/**
 * Le périmètre — ce que le contrôle a le droit de lire.
 *
 * L'incident du 02/09/2026 (rejeu sur un périmètre déjà effacé, 6525
 * « résidus » nommant tous les autres candidats de la base) tient dans deux
 * questions, et ce fichier les tient toutes les deux :
 *   · un périmètre vide est-il RECONNU comme vide ? — sinon le contrôle
 *     cherche sans terme, et une recherche sans terme rend tout ;
 *   · le nom fait-il entrer une ligne ? — il ne doit JAMAIS.
 */
import { describe, expect, it } from 'vitest';

import { buildFingerprint, strongIdentifiersOnly } from '@/lib/gdpr/payload-pseudonymize';
import {
  carriesStrongIdentifier,
  perimeterIsEmpty,
  perimeterSize,
  strongSearchPatterns,
  weakSearchPatterns,
} from '@/lib/gdpr/perimeter';
import type { ErasureIdentity } from '@/types/gdpr';

const EMPTY: ErasureIdentity = {
  emails: [],
  names: [],
  phones: [],
  analysisIds: [],
  uids: [],
  imapRefs: [],
  campaignIds: [],
  fileNames: [],
  vivierIds: [],
  briefIds: [],
  validationIds: [],
  linkTokens: [],
  bookingIds: [],
  artifactIds: [],
  unmatchedIds: [],
  storagePaths: [],
};

const fp = buildFingerprint({
  emails: ['yvan.bisseg@exemple.fr'],
  names: ['Yvan Bisseg'],
  phones: ['0600000001'],
});
const strong = strongIdentifiersOnly(fp);

describe('perimeterIsEmpty', () => {
  it('un rejeu qui ne retrouve plus rien a un périmètre VIDE', () => {
    // Le cas exact du rejeu : l'adresse est toujours connue (c'est le terme de
    // recherche), mais plus rien ne s'y rattache.
    const afterErasure: ErasureIdentity = {
      ...EMPTY,
      emails: ['yvan.bisseg@exemple.fr'],
      names: ['Yvan Bisseg'],
      phones: ['0600000001'],
    };
    expect(perimeterIsEmpty(afterErasure)).toBe(true);
    expect(perimeterSize(afterErasure)).toBe(0);
  });

  it('un seul identifiant suffit à rendre le périmètre non vide', () => {
    expect(perimeterIsEmpty({ ...EMPTY, analysisIds: ['can_imap_mb_1_42'] })).toBe(false);
    expect(perimeterIsEmpty({ ...EMPTY, vivierIds: ['uuid'] })).toBe(false);
    expect(perimeterIsEmpty({ ...EMPTY, storagePaths: ['CAMP-2026-288/cv.pdf'] })).toBe(false);
  });

  it('un couple (boîte, message) est un périmètre, même sans autre identifiant', () => {
    // `--uid mb_x:918273` est un point d'entrée légitime de la commande.
    const byUid: ErasureIdentity = { ...EMPTY, imapRefs: [{ mailboxId: 'mb_x', uid: '918273' }] };
    expect(perimeterIsEmpty(byUid)).toBe(false);
    expect(perimeterSize(byUid)).toBe(1);
  });
});

describe('carriesStrongIdentifier', () => {
  it('reconnaît l’adresse, en clair et démantelée, à toute profondeur', () => {
    expect(carriesStrongIdentifier({ email: 'YVAN.BISSEG@exemple.fr' }, strong)).toBe(true);
    expect(
      carriesStrongIdentifier({ a: { b: ['yvanbisseg_exemple.fr_PROFIL.pdf'] } }, strong),
    ).toBe(true);
  });

  it('NE fait PAS entrer une ligne sur le nom ni sur le téléphone', () => {
    // C'est la règle qui protège les tiers : « Bisseg » désigne peut-être un
    // frère, un homonyme ; le numéro peut être un fixe de foyer.
    expect(carriesStrongIdentifier({ candidate_name: 'Yvan Bisseg' }, strong)).toBe(false);
    expect(carriesStrongIdentifier({ telephone: '0600000001' }, strong)).toBe(false);
  });

  it('ne déborde pas sur une ligne quelconque', () => {
    expect(
      carriesStrongIdentifier(
        { id: 'can_imap_mb_1_42', candidate_name: 'Abdelilah Badaj', score: 71 },
        strong,
      ),
    ).toBe(false);
  });
});

describe('motifs de recherche', () => {
  const esc = (v: string) => v.replace(/[\\%_]/gu, (c) => `\\${c}`);

  it('les motifs FORTS ne dérivent que de l’adresse', () => {
    const patterns = strongSearchPatterns(
      { ...EMPTY, emails: ['yvan.bisseg@exemple.fr'] },
      fp,
      esc,
    );
    expect(patterns).toContain('%yvan.bisseg@exemple.fr%');
    // La forme démantelée — celle des noms de fichiers construits sur l'adresse.
    expect(patterns).toContain('%yvan%bisseg%exemple%fr%');
    expect(patterns.join(' ')).not.toContain('Bisseg '); // jamais le nom seul
  });

  it('un périmètre sans adresse ne produit AUCUN motif — donc aucune requête', () => {
    expect(strongSearchPatterns(EMPTY, buildFingerprint({ emails: [], names: [], phones: [] }), esc))
      .toEqual([]);
  });

  it('les motifs FAIBLES écartent les jetons courts, qui ratisseraient la base', () => {
    const weak = weakSearchPatterns(
      buildFingerprint({ emails: [], names: ['Ali Fort'], phones: [] }),
      esc,
    );
    expect(weak).toContain('%fort%');
    expect(weak).not.toContain('%ali%'); // 3 caractères : trop large pour un signal
  });
});
