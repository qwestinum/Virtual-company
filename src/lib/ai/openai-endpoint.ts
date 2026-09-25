/**
 * Point d'accès « compatible OpenAI » — PUR (25/09/2026).
 *
 * Le SDK OpenAI parle à tout fournisseur qui expose la même API de chat
 * (Mistral, OVHcloud AI Endpoints, Scaleway Generative APIs…) : il suffit de
 * changer l'URL de base et la clé. Ce module décide, à partir de
 * l'environnement, À QUI les appels de CHAT partent — la transcription
 * (Whisper) reste chez OpenAI dans tous les cas.
 *
 *   OPENAI_BASE_URL             absente ⇒ OpenAI, clé OPENAI_API_KEY (inchangé)
 *                               présente ⇒ ce point d'accès, en https seulement
 *   OPENAI_COMPATIBLE_API_KEY   clé du fournisseur tiers — OBLIGATOIRE dès que
 *                               l'URL n'est pas celle d'OpenAI : on n'envoie
 *                               jamais la clé OpenAI à un tiers.
 *
 * ⚠️ REFUS NON NÉGOCIABLE : aucune URL deepseek.com (ni sous-domaine). Les CV
 * sont des données personnelles ; leur traitement doit rester dans un cadre
 * contractuel et géographique maîtrisé. Le refus est ici, au seul point où le
 * client est construit, pour qu'aucun chemin (script, route, réglage) ne le
 * contourne.
 *
 * ⚠️ Ce qui n'est PAS garanti chez un tiers et reste à vérifier fournisseur
 * par fournisseur avant tout usage réel : la graine (`seed` — Mistral attend
 * `random_seed`), le mode JSON (`response_format`), le nom de modèle renvoyé
 * (qui sert au tarif), le tarif lui-même (absent de `pricing.ts` ⇒ coût 0).
 */

export const OPENAI_DEFAULT_HOST = 'api.openai.com';

/** Hôtes refusés, sous-domaines compris. */
export const REFUSED_HOSTS = ['deepseek.com'] as const;

export type OpenAiEndpointConfig =
  | { ok: true; apiKey: string; baseURL: string | null; host: string; thirdParty: boolean }
  | { ok: false; reason: string };

type Env = Readonly<Record<string, string | undefined>>;

const clean = (v: string | undefined): string => (v ?? '').trim();

export function isRefusedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return REFUSED_HOSTS.some((r) => h === r || h.endsWith(`.${r}`));
}

export function resolveOpenAiEndpoint(env: Env): OpenAiEndpointConfig {
  const rawBase = clean(env.OPENAI_BASE_URL);
  if (rawBase === '') {
    const apiKey = clean(env.OPENAI_API_KEY);
    if (!apiKey) return { ok: false, reason: 'OPENAI_API_KEY is not set in the environment.' };
    return { ok: true, apiKey, baseURL: null, host: OPENAI_DEFAULT_HOST, thirdParty: false };
  }

  let url: URL;
  try {
    url = new URL(rawBase);
  } catch {
    return { ok: false, reason: `OPENAI_BASE_URL illisible : « ${rawBase} ».` };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'OPENAI_BASE_URL doit être en https.' };
  }
  const host = url.hostname.toLowerCase();
  if (isRefusedHost(host)) {
    return { ok: false, reason: `Point d'accès refusé : ${host} (fournisseur exclu pour le traitement des CV).` };
  }

  const thirdParty = host !== OPENAI_DEFAULT_HOST;
  const apiKey = thirdParty ? clean(env.OPENAI_COMPATIBLE_API_KEY) : clean(env.OPENAI_API_KEY);
  if (!apiKey) {
    return {
      ok: false,
      reason: thirdParty
        ? `OPENAI_COMPATIBLE_API_KEY absente pour ${host} — la clé OpenAI n'est jamais envoyée à un tiers.`
        : 'OPENAI_API_KEY is not set in the environment.',
    };
  }
  return { ok: true, apiKey, baseURL: url.toString().replace(/\/$/, ''), host, thirdParty };
}
