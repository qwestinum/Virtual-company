/**
 * URL publique du service — la base de TOUT lien de réservation envoyé à un
 * candidat, et du domaine de l'UID d'agenda qui en dérive.
 *
 * Ce qui se joue ici n'est pas cosmétique : `VERCEL_URL` rend l'URL du
 * DÉPLOIEMENT, neuve à chaque mise en ligne. Un lien émis sur cette base meurt
 * au déploiement suivant, et l'UID d'agenda change avec lui — le déplacement
 * d'un rendez-vous en crée un second au lieu de bouger le premier, et
 * l'annulation est ignorée. D'où la priorité donnée à l'ALIAS DE PRODUCTION.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { schedulingBaseUrl } from '../configure';

const KEYS = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SITE_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
] as const;

let saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('schedulingBaseUrl — ordre de repli', () => {
  it('préfère la variable explicite à tout le reste', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://orqa.exemple.fr';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'alias.vercel.app';
    process.env.VERCEL_URL = 'deploiement-hash.vercel.app';
    expect(schedulingBaseUrl()).toBe('https://orqa.exemple.fr');
  });

  it("retient l'ALIAS DE PRODUCTION plutôt que l'URL de déploiement", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'orqa-bia-prod.vercel.app';
    process.env.VERCEL_URL = 'orqa-bia-prod-9f3a2b1-equipe.vercel.app';
    // C'EST LE CŒUR DU TEST : l'alias survit au déploiement suivant, pas l'URL
    // de déploiement. Inverser ces deux lignes casse les liens déjà envoyés.
    expect(schedulingBaseUrl()).toBe('https://orqa-bia-prod.vercel.app');
  });

  it("retombe sur l'URL de déploiement quand l'alias n'est pas exposé", () => {
    process.env.VERCEL_URL = 'orqa-bia-prod-9f3a2b1-equipe.vercel.app';
    expect(schedulingBaseUrl()).toBe(
      'https://orqa-bia-prod-9f3a2b1-equipe.vercel.app',
    );
  });

  it('rend localhost hors de tout hébergement', () => {
    expect(schedulingBaseUrl()).toBe('http://localhost:3000');
  });
});

describe('schedulingBaseUrl — valeurs mal renseignées', () => {
  it('saute une variable DÉFINIE MAIS VIDE au lieu de s\'y arrêter', () => {
    // Le piège du `??` : `'' ?? x` vaut `''`. Une entrée créée sur Vercel
    // sans valeur ne doit pas masquer le repli suivant.
    process.env.NEXT_PUBLIC_APP_URL = '';
    process.env.NEXT_PUBLIC_SITE_URL = '   ';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'orqa-bia-prod.vercel.app';
    expect(schedulingBaseUrl()).toBe('https://orqa-bia-prod.vercel.app');
  });

  it('complète un schéma oublié par l\'opérateur', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'orqa-bia-prod.vercel.app';
    expect(schedulingBaseUrl()).toBe('https://orqa-bia-prod.vercel.app');
  });

  it('retire le slash final, qui doublerait celui du chemin', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://orqa.exemple.fr//';
    expect(schedulingBaseUrl()).toBe('https://orqa.exemple.fr');
  });

  it('respecte un http:// explicite (dev derrière un tunnel)', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://192.168.1.20:3000';
    expect(schedulingBaseUrl()).toBe('http://192.168.1.20:3000');
  });
});
