import { describe, expect, it } from 'vitest';

import { cvTextFingerprint, normalizeCvTextForFingerprint } from '../fingerprint';

describe('empreinte du texte d’un CV — CONTRAT', () => {
  it('la mise en page du texte extrait ne change pas l’empreinte', () => {
    const a = 'Hélène  MARTIN\nChef de projet\r\n\n  hel.martin@exemple.fr ';
    const b = 'helene martin chef de projet hel.martin@exemple.fr';
    expect(cvTextFingerprint(a)).toBe(cvTextFingerprint(b));
  });

  it('les caractères invisibles et les ligatures ne changent pas l’empreinte', () => {
    expect(cvTextFingerprint('ef​ficace­ment')).toBe(cvTextFingerprint('efficacement'));
    expect(normalizeCvTextForFingerprint('ﬁnance')).toBe('finance');
  });

  it('un mot de différence change l’empreinte', () => {
    expect(cvTextFingerprint('Chef de projet senior')).not.toBe(cvTextFingerprint('Chef de projet junior'));
  });

  it('un texte vide n’a pas d’empreinte', () => {
    expect(cvTextFingerprint(' \n\t ')).toBeNull();
  });

  it('valeur ÉPINGLÉE : changer la normalisation rend les empreintes stockées inopérantes', () => {
    // Si ce test rougit, le contrat a changé : incrémenter FINGERPRINT_VERSION
    // plutôt que de mettre à jour la valeur attendue. (SHA-256 de « abc ».)
    expect(cvTextFingerprint('  ABC\n')).toBe(
      'v1:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
