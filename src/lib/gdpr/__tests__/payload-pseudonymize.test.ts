/**
 * Pseudonymisation des charges utiles — les deux ceintures.
 *
 * L'enjeu de ces tests n'est pas « la chaîne a-t-elle disparu » mais :
 *   · une clé nominative part TOUJOURS (ceinture 1) ;
 *   · une clé qu'on n'avait pas prévue part quand même si sa valeur porte le
 *     candidat (ceinture 2) — c'est ce qui protège des actions ajoutées
 *     demain ;
 *   · l'identité du RECRUTEUR, elle, reste : c'est la preuve qu'un humain
 *     identifié a décidé.
 */
import { describe, expect, it } from 'vitest';

import {
  buildFingerprint,
  isContaminated,
  payloadStillContaminated,
  pseudonymizePayload,
  redactString,
} from '@/lib/gdpr/payload-pseudonymize';

const MARKER = '[effacé — demande RGPD test]';

const fp = buildFingerprint({
  emails: ['jean.dupont@exemple.fr'],
  names: ['Jean Dupont'],
  phones: ['+33 6 12 34 56 78'],
});

describe('empreintes', () => {
  it('écarte les jetons trop courts', () => {
    const f = buildFingerprint({ emails: [], names: ['Le Van Duc'], phones: [] });
    expect(f.nameTokens).not.toContain('le');
    expect(f.nameTokens).toContain('van');
    expect(f.nameTokens).toContain('duc');
  });

  it('reconnaît une forme « slug » de nom de fichier', () => {
    expect(fp.slugs).toContain('jean-dupont');
    expect(isContaminated('invitation-jean-dupont.md', fp)).toBe(true);
  });

  it('reconnaît un nom accentué écrit sans accent, et l’inverse', () => {
    const f = buildFingerprint({ emails: [], names: ['Amélie Rocher'], phones: [] });
    expect(isContaminated('rapport de AMELIE ROCHER', f)).toBe(true);
    expect(isContaminated('rapport de Amélie Rocher', f)).toBe(true);
  });

  it('reconnaît un téléphone quelle que soit sa mise en forme', () => {
    expect(isContaminated('joignable au 06.12.34.56.78', fp)).toBe(true);
    expect(isContaminated('joignable au 0033612345678', fp)).toBe(true);
  });

  it('ne mord pas sur un mot qui contient le jeton', () => {
    const f = buildFingerprint({ emails: [], names: ['Art Dupond'], phones: [] });
    expect(isContaminated('un artefact quelconque', f)).toBe(false);
  });
});

describe('ceinture 1 — par clé', () => {
  it('remplace la valeur entière d’une clé nominative', () => {
    const { value, changed } = pseudonymizePayload(
      { candidate: 'Jean Dupont', uid: '1624', mode: 'reject' },
      fp,
      MARKER,
    );
    expect(changed).toBe(true);
    expect(value.candidate).toBe(MARKER);
    expect(value.uid).toBe('1624');
    expect(value.mode).toBe('reject');
  });

  it('remplace même une valeur que les empreintes ne reconnaissent pas', () => {
    // Une variante d'adresse jamais vue ailleurs : c'est précisément pour ça
    // que la ceinture par clé existe.
    const { value } = pseudonymizePayload({ candidateEmail: 'j.d@autre.fr' }, fp, MARKER);
    expect(value.candidateEmail).toBe(MARKER);
  });
});

describe('ceinture 2 — par valeur', () => {
  it('attrape une clé imprévue qui porte le candidat', () => {
    const { value } = pseudonymizePayload(
      { cléInéditeAjoutéeDemain: 'dossier de Jean Dupont' },
      fp,
      MARKER,
    );
    expect(String(value['cléInéditeAjoutéeDemain'])).not.toContain('Jean');
  });

  it('descend dans les objets imbriqués et les tableaux', () => {
    const { value } = pseudonymizePayload(
      { before: { candidate: 'Jean Dupont', score: 0 }, filenames: ['CV Jean Dupont.pdf'] },
      fp,
      MARKER,
    );
    expect(JSON.stringify(value)).not.toContain('Jean');
    expect((value.before as Record<string, unknown>).score).toBe(0);
    expect((value.filenames as unknown[]).length).toBe(1); // la longueur est un fait
  });

  it('garde le contexte lisible quand il n’est pas nominatif', () => {
    const out = redactString(
      'Candidature — Dev Java (CAMP-2026-051) - Jean Dupont',
      fp,
      MARKER,
    );
    expect(out).toContain('CAMP-2026-051');
    expect(out).not.toContain('Jean');
  });

  it('remplace la chaîne ENTIÈRE si un résidu subsiste', () => {
    // Le téléphone ne se caviarde pas par sous-chaîne : la chaîne entière part.
    const out = redactString('rappeler le 06 12 34 56 78 demain', fp, MARKER);
    expect(out).toBe(MARKER);
  });
});

describe('ce qui ne doit PAS bouger', () => {
  it('l’identité du recruteur reste — c’est la preuve de l’acte', () => {
    const { value } = pseudonymizePayload(
      { actorEmail: 'recruteur@client.fr', by: 'recruteur@client.fr', candidate: 'Jean Dupont' },
      fp,
      MARKER,
    );
    expect(value.actorEmail).toBe('recruteur@client.fr');
    expect(value.by).toBe('recruteur@client.fr');
    expect(value.candidate).toBe(MARKER);
  });

  it('une charge utile sans le candidat n’est pas réécrite', () => {
    const { changed } = pseudonymizePayload(
      { mailboxId: 'mb_1', reason: 'open_timeout' },
      fp,
      MARKER,
    );
    expect(changed).toBe(false);
  });
});

describe('rejeu', () => {
  it('n’empile pas les marqueurs', () => {
    const first = pseudonymizePayload({ candidate: 'Jean Dupont' }, fp, MARKER);
    const second = pseudonymizePayload(first.value, fp, MARKER);
    expect(second.changed).toBe(false);
    expect(second.value.candidate).toBe(MARKER);
  });

  it('le contrôle confirme qu’il ne reste rien', () => {
    const { value } = pseudonymizePayload(
      { candidate: 'Jean Dupont', sentTo: 'jean.dupont@exemple.fr', uid: '1624' },
      fp,
      MARKER,
    );
    expect(payloadStillContaminated(value, fp)).toBe(false);
  });
});
