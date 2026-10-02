/**
 * Le serveur peut-il s'authentifier auprès de l'Apec ? — dit AVANT le clic,
 * et avec la même phrase au clic (incident s2i-talents, 02/10/2026 : clé
 * précalculée absente, module de calcul absent de la production, vérification
 * « prête à partir » puis `publish_failed` brut).
 */
import { describe, expect, it } from 'vitest';

import { AdepArgon2Error, adepKeyProblem } from '../argon2';
import { adepServerBlockers, describeAdepKeyError } from '../key-readiness';
import { MockAdepTransport } from '../mock-transport';
import { AdepSepPublisher } from '../publisher';

const KEY = 'k'.repeat(342);
const RAW = { ADEP_ATS_PASSWORD: 'secret', ADEP_ARGON2_SALT: 'c2Vs' };

describe('adepKeyProblem — mêmes règles que la résolution, sans rien calculer', () => {
  it('clé précalculée de 342 caractères ⇒ rien à dire, module ou pas', () => {
    expect(adepKeyProblem({ ADEP_ATS_PASSWORD_HASH: KEY }, false)).toBeNull();
  });

  it('clé précalculée de mauvaise longueur ⇒ signalée (le piège des 43 caractères)', () => {
    expect(adepKeyProblem({ ADEP_ATS_PASSWORD_HASH: 'k'.repeat(43) }, true)).toEqual({
      kind: 'bad_length',
      length: 43,
    });
  });

  it('mot de passe + sel SANS module (la production) ⇒ le cas de l’incident', () => {
    expect(adepKeyProblem(RAW, false)).toEqual({ kind: 'module_unavailable' });
    expect(adepKeyProblem(RAW, true)).toBeNull();
  });

  it('ni clé ni mot de passe ⇒ absente', () => {
    expect(adepKeyProblem({}, true)).toEqual({ kind: 'missing' });
  });
});

describe('adepServerBlockers — avant le bouton Publier', () => {
  it('serveur prêt ⇒ aucun préalable', () => {
    expect(adepServerBlockers({ ADEP_ATS_ID: '138', ADEP_ATS_PASSWORD_HASH: KEY }, false)).toEqual(
      [],
    );
  });

  it('clé absente ⇒ une phrase qui dit quoi faire et à qui', () => {
    const [b] = adepServerBlockers({ ADEP_ATS_ID: '138', ...RAW }, false);
    expect(b).toMatch(/connexion à l’Apec n’est pas configurée/);
    expect(b).toContain('ADEP_ATS_PASSWORD_HASH');
    expect(b).toContain('administrateur');
  });

  it('identifiant éditeur absent ⇒ signalé aussi', () => {
    const blockers = adepServerBlockers({ ADEP_ATS_PASSWORD_HASH: KEY }, false);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('ADEP_ATS_ID');
  });
});

describe('au clic — la même phrase, et la vérité sur ce qui est parti', () => {
  it('dit que rien n’a été envoyé (l’erreur précède la réservation)', () => {
    const msg = describeAdepKeyError(new AdepArgon2Error('module_unavailable', 'technique'));
    expect(msg).toContain('Rien n’a été envoyé à l’Apec.');
    expect(msg).not.toContain('@node-rs');
  });

  it('suspendre / republier : la phrase, jamais le message technique', async () => {
    const transport = new MockAdepTransport();
    const publisher = new AdepSepPublisher({
      transport,
      credentials: async () => {
        throw new AdepArgon2Error('module_unavailable', "Le module @node-rs/argon2 n'est pas installé.");
      },
      trackingId: (ref) => `test-${ref}`,
    });
    const outcome = await publisher.suspend({ clientReference: 'CAMP-2026-001', remoteId: '1W' });
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind !== 'unavailable') return;
    expect(outcome.reason).toMatch(/connexion à l’Apec n’est pas configurée/);
    expect(outcome.reason).not.toContain('@node-rs');
  });
});
