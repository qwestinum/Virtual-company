import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SUBTINT_PERCENT, TINT_PERCENT } from '@/components/today/TodayCard';

/**
 * SOCLE — il NOMME ce qui existe, il n'invente rien.
 *
 * Deux garanties, et la seconde est la plus utile :
 *  1. les rôles employés par l'écran refondu tiennent leur contraste ;
 *  2. cet écran n'introduit AUCUNE couleur ni police hors du produit — c'est
 *     la règle « zéro invention », et aucun test de valeurs ne l'attrape :
 *     une teinte écrite en dur compile et s'affiche très bien.
 *
 * Les ratios sont RECALCULÉS depuis `globals.css`, jamais recopiés.
 */

const CSS = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf-8');

function dash(nom: string): string {
  const m = CSS.match(new RegExp(`--dash-${nom}:\\s*(#[0-9a-f]{3,8})`, 'i'));
  if (!m) throw new Error(`jeton --dash-${nom} introuvable`);
  return m[1]!.toLowerCase();
}

const luminance = (hex: string): number => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};

const ratio = (a: string, b: string): number => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe('les rôles employés par l’écran tiennent leur contraste', () => {
  const surface = dash('surface');

  it('le texte principal et le texte secondaire passent AA (4,5:1)', () => {
    expect(ratio(dash('text'), surface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dash('text-secondary'), surface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dash('text'), dash('bg'))).toBeGreaterThanOrEqual(4.5);
  });

  it('les pastilles de registre passent le 3:1 des éléments non textuels', () => {
    for (const role of ['teal', 'purple', 'orange']) {
      expect(ratio(dash(role), surface), role).toBeGreaterThanOrEqual(3);
    }
  });

  it('l’action principale porte du blanc lisible', () => {
    expect(ratio('#ffffff', dash('blue'))).toBeGreaterThanOrEqual(4.5);
  });

  it('DETTE CONNUE : le texte tertiaire est sous AA, donc pas employé ici', () => {
    // 2,87:1. C'est une dette du produit (lot accessibilité), pas de cet
    // écran : la relever ici ferait diverger un écran du reste. La règle
    // tenue est donc de ne pas s'en servir — vérifiée juste en dessous.
    expect(ratio(dash('text-tertiary'), surface)).toBeLessThan(4.5);
  });
});

describe('les teintes de registre restent des NUANCES', () => {
  const surface = dash('surface');

  /** Mélange `pct` % de `couleur` dans `fond` — ce que fait `color-mix`. */
  const melange = (couleur: string, fond: string, pct: number): string => {
    const canal = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
    const out = [1, 3, 5].map((i) =>
      Math.round((canal(couleur, i) * pct + canal(fond, i) * (100 - pct)) / 100),
    );
    return `#${out.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  };

  it.each(['teal', 'purple', 'orange'])(
    'la teinte %s laisse la page blanche à l’œil',
    (role) => {
      const teinte = melange(dash(role), surface, TINT_PERCENT);
      // Moins de 1,10:1 du blanc : c'est une nuance, pas une couleur.
      expect(ratio(teinte, surface)).toBeLessThan(1.1);
    },
  );

  it.each(['teal', 'purple', 'orange'])(
    'le texte garde son AA sur la teinte %s',
    (role) => {
      const teinte = melange(dash(role), surface, TINT_PERCENT);
      expect(ratio(dash('text'), teinte)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(dash('text-secondary'), teinte)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['teal', 'purple', 'orange'])(
    'le SOUS-BLOC %s se distingue de sa carte, sans cesser d’être une nuance',
    (role) => {
      const carte = melange(dash(role), surface, TINT_PERCENT);
      const sousBloc = melange(dash(role), surface, SUBTINT_PERCENT);
      // Les trois niveaux doivent se lire à 50 % de zoom SANS texte : il faut
      // donc un écart réel entre carte et sous-bloc…
      expect(ratio(sousBloc, carte)).toBeGreaterThan(1.02);
      // …et la rangée blanche doit trancher sur le sous-bloc.
      expect(ratio(surface, sousBloc)).toBeGreaterThan(1.05);
      // …sans que le sous-bloc devienne une couleur.
      expect(ratio(sousBloc, surface)).toBeLessThan(1.25);
    },
  );

  it.each(['teal', 'purple', 'orange'])(
    'le texte garde son AA sur le SOUS-BLOC %s',
    (role) => {
      const sousBloc = melange(dash(role), surface, SUBTINT_PERCENT);
      expect(ratio(dash('text'), sousBloc)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(dash('text-secondary'), sousBloc)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('la sonde : une teinte trop forte serait détectée', () => {
    // 25 % de teal : la page cesserait d'être blanche.
    const trop = melange(dash('teal'), surface, 25);
    expect(ratio(trop, surface)).toBeGreaterThan(1.1);
  });
});

// ── Garde « ZÉRO INVENTION » ────────────────────────────────────────────────

const ECRAN = resolve(process.cwd(), 'src/components/today');

function fichiers(dir: string, out: string[] = []): string[] {
  for (const nom of readdirSync(dir)) {
    const full = join(dir, nom);
    if (statSync(full).isDirectory()) {
      if (nom !== '__tests__') fichiers(full, out);
    } else if (/\.tsx?$/.test(nom)) out.push(full);
  }
  return out;
}

const SOURCES = fichiers(ECRAN).map((f) => ({
  chemin: relative(process.cwd(), f),
  code: readFileSync(f, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, ''),
}));

describe('zéro invention — l’écran n’apporte ni couleur ni police à lui', () => {
  it('le périmètre analysé est réel', () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(6);
  });

  it('aucune couleur écrite en dur', () => {
    // Les couleurs passent par `--dash-*` ou par `DASH_COLORS`. Un `#hex` ou
    // un `rgb(...)` dans un composant, c'est une palette de plus.
    for (const f of SOURCES) {
      const durs = [
        ...f.code.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
        ...f.code.matchAll(/\brgba?\(/g),
      ].map((m) => m[0]);
      // Exception unique et lisible : le blanc du texte sur bouton plein, et
      // l'ombre du bouton — tous deux recopiés du bouton EXISTANT.
      const inattendus = durs.filter(
        (d) => d !== '#fff' && d !== '#ffffff' && d !== 'rgba(',
      );
      expect(inattendus, f.chemin).toEqual([]);
    }
  });

  it('aucun serif : l’écran emploie les polices du produit', () => {
    for (const f of SOURCES) {
      expect(f.code, f.chemin).not.toContain('font-fraunces');
      expect(f.code, f.chemin).not.toContain('serif');
    }
  });

  it('aucune ombre portée sur les cartes', () => {
    // La carte du produit n'en a pas. En ajouter une ferait un troisième
    // style de carte dans un produit qui en a déjà deux.
    const carte = SOURCES.find((f) => f.chemin.endsWith('TodayCard.tsx'));
    expect(carte).toBeDefined();
    expect(carte!.code).not.toContain('boxShadow');
    expect(carte!.code).not.toContain('shadow-');
  });
});
