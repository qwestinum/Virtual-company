import { afterEach, describe, expect, it, vi } from 'vitest';

import { dedupeFetch } from '@/lib/net/dedupe-fetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Un `fetch` qu'on résout à la main, pour tenir deux appels « en même temps ».
 *
 * ⚠️ On garde UN résolveur PAR APPEL, et `livrer` les résout TOUS. Une
 * première version n'en gardait qu'un — le dernier — et laissait donc la
 * première requête pendante à jamais : l'entrée restait dans la table des
 * requêtes en vol, et le test suivant qui demandait la même adresse attendait
 * indéfiniment. Le piège est réel hors des tests aussi : un appel qui ne se
 * résout JAMAIS condamne son adresse pour tous les appelants suivants.
 */
function fauxFetch() {
  const resolveurs: ((r: Response) => void)[] = [];
  const appels: string[] = [];
  const f = vi.fn((url: string) => {
    appels.push(url);
    return new Promise<Response>((r) => {
      resolveurs.push(r);
    });
  });
  vi.stubGlobal('fetch', f);
  return {
    appels,
    livrer: (corps: unknown) => {
      for (const r of resolveurs) r(new Response(JSON.stringify(corps)));
    },
  };
}

describe('deux appelants simultanés font UNE requête', () => {
  it('et reçoivent tous deux le corps', async () => {
    const { appels, livrer } = fauxFetch();
    const a = dedupeFetch('/api/validations');
    const b = dedupeFetch('/api/validations');
    livrer({ total: 7 });
    const [ra, rb] = await Promise.all([a, b]);
    expect(appels).toEqual(['/api/validations']);
    // ⚠️ Un corps ne se lit qu'une fois : sans clone, le second appelant
    // recevrait un flux déjà consommé.
    expect(await ra.json()).toEqual({ total: 7 });
    expect(await rb.json()).toEqual({ total: 7 });
  });

  it('deux adresses DIFFÉRENTES ne se partagent rien', async () => {
    const { appels, livrer } = fauxFetch();
    void dedupeFetch('/api/validations');
    void dedupeFetch('/api/interviews');
    livrer({});
    expect(appels).toEqual(['/api/validations', '/api/interviews']);
  });
});

describe('ce n’est PAS un cache', () => {
  it('une requête faite APRÈS la résolution repart pour de bon', async () => {
    // Réponses immédiates : ici on ne teste pas la simultanéité, mais le
    // contraire — que rien ne SURVIT à la résolution.
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        n += 1;
        return Promise.resolve(new Response(JSON.stringify({ total: n })));
      }),
    );

    expect(await (await dedupeFetch('/api/validations')).json()).toEqual({ total: 1 });
    // Le compteur doit pouvoir CHANGER : servir l'ancienne réponse dirait
    // « 1 chose vous attend » à quelqu'un qui vient d'en traiter une.
    expect(await (await dedupeFetch('/api/validations')).json()).toEqual({ total: 2 });
    expect(n).toBe(2);
  });
});
