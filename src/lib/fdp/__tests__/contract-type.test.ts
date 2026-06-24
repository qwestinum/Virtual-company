import { describe, expect, it } from 'vitest';

import {
  addContract,
  asContractList,
  canonicalizeContract,
  hasContract,
  isPredefinedContract,
  joinContracts,
  normalizeContractList,
  toggleContract,
} from '@/lib/fdp/contract-type';

describe('asContractList', () => {
  it('lit un tableau (trim, vides retirés)', () => {
    expect(asContractList(['CDI', ' CDD ', '', '  '])).toEqual(['CDI', 'CDD']);
  });

  it('RÉTRO-COMPAT : une ancienne valeur unique (string) → liste à 1 élément', () => {
    expect(asContractList('CDI')).toEqual(['CDI']);
    expect(asContractList('  freelance ')).toEqual(['freelance']);
  });

  it('ne SPLIT pas une string legacy sur la virgule (un seul contrat)', () => {
    // Une valeur legacy reste UNE entrée même si elle contient une virgule.
    expect(asContractList('CDI, CDD')).toEqual(['CDI, CDD']);
  });

  it('null / undefined / vide → liste vide', () => {
    expect(asContractList(null)).toEqual([]);
    expect(asContractList(undefined)).toEqual([]);
    expect(asContractList('')).toEqual([]);
    expect(asContractList(42)).toEqual([]);
  });
});

describe('canonicalizeContract', () => {
  it('canonicalise vers une option prédéfinie (casse/accents ignorés)', () => {
    expect(canonicalizeContract('cdi')).toBe('CDI');
    expect(canonicalizeContract('  CDD ')).toBe('CDD');
    expect(canonicalizeContract('INTERIM')).toBe('intérim');
    expect(canonicalizeContract('Intérim')).toBe('intérim');
  });

  it('conserve une saisie libre inconnue (trimée)', () => {
    expect(canonicalizeContract('  Bénévolat ')).toBe('Bénévolat');
  });

  it('vide → ""', () => {
    expect(canonicalizeContract('   ')).toBe('');
  });
});

describe('addContract — dédup insensible casse/accents', () => {
  it('fusionne « cdi » sur l’option CDI au lieu d’un doublon', () => {
    expect(addContract(['CDI'], 'cdi')).toEqual(['CDI']);
    expect(addContract(['intérim'], 'INTERIM')).toEqual(['intérim']);
  });

  it('ajoute une vraie nouvelle valeur (canonicalisée)', () => {
    expect(addContract(['CDI'], 'cdd')).toEqual(['CDI', 'CDD']);
    expect(addContract(['CDI'], 'Saisonnier')).toEqual(['CDI', 'Saisonnier']);
  });

  it('entrée vide → liste inchangée (même référence)', () => {
    const list = ['CDI'];
    expect(addContract(list, '   ')).toBe(list);
  });
});

describe('toggleContract', () => {
  it('ajoute si absent, retire si présent (casse/accents ignorés)', () => {
    expect(toggleContract([], 'CDI')).toEqual(['CDI']);
    expect(toggleContract(['CDI', 'CDD'], 'cdi')).toEqual(['CDD']);
  });
});

describe('normalizeContractList', () => {
  it('canonicalise + déduplique une liste entière', () => {
    expect(normalizeContractList(['cdi', 'CDI', ' CDD ', 'interim'])).toEqual([
      'CDI',
      'CDD',
      'intérim',
    ]);
  });
});

describe('hasContract / isPredefinedContract', () => {
  it('hasContract est insensible casse/accents', () => {
    expect(hasContract(['intérim'], 'INTERIM')).toBe(true);
    expect(hasContract(['CDI'], 'CDD')).toBe(false);
  });

  it('isPredefinedContract distingue option vs saisie libre', () => {
    expect(isPredefinedContract('cdi')).toBe(true);
    expect(isPredefinedContract('CDI de chantier')).toBe(true);
    expect(isPredefinedContract('Bénévolat')).toBe(false);
  });
});

describe('joinContracts', () => {
  it('joint en « CDI, CDD » depuis un tableau', () => {
    expect(joinContracts(['CDI', 'CDD'])).toBe('CDI, CDD');
  });

  it('RÉTRO-COMPAT : un scalaire legacy se joint en lui-même', () => {
    expect(joinContracts('CDI')).toBe('CDI');
  });

  it('vide → ""', () => {
    expect(joinContracts(null)).toBe('');
    expect(joinContracts([])).toBe('');
  });
});
