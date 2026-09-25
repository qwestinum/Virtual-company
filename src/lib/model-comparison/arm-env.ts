/**
 * Réglages d'un bras et environnement de son processus — PUR.
 *
 * Le fournisseur lit le modèle UNE fois, au chargement : chaque bras tourne
 * donc dans son propre processus, dont l'environnement est posé ICI, par le
 * script — jamais dans un fichier `.env` (le modèle en service ne change pas).
 * Le bras refuse de démarrer si son environnement effectif diffère de ce qu'il
 * demande : un bras qui tournerait en réalité sur un autre modèle ou chez un
 * autre fournisseur rendrait un « accord parfait ».
 */

export type ArmSettings = {
  provider: 'openai' | 'anthropic';
  /** Modèle de TOUTES les phases, sauf celles surchargées ci-dessous. */
  model: string;
  baseUrl: string | null;
  /** Bras hybride : un autre modèle pour le relevé de faits seulement. */
  ledgerModel?: string | null;
};

/** Les modèles qu'un bras a le droit de voir revenir de l'API. */
export function allowedModels(s: ArmSettings): string[] {
  return [s.model, ...(s.ledgerModel ? [s.ledgerModel] : [])];
}

/**
 * Lit une définition de bras candidat :
 *   `nom,provider=openai,model=gpt-4o[,ledger=gpt-4o-mini][,base-url=https://…]`
 * Rend `null` si la définition est incomplète ou incohérente.
 */
export function parseArmSpec(spec: string): { name: string; settings: ArmSettings } | { error: string } {
  const [name, ...pairs] = spec.split(',').map((p) => p.trim());
  if (!name || !/^[a-z0-9-]+$/.test(name)) return { error: `nom de bras invalide dans « ${spec} » (a-z, 0-9, tiret)` };
  const kv = Object.fromEntries(pairs.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
  const provider = kv.provider ?? 'openai';
  if (provider !== 'openai' && provider !== 'anthropic') return { error: `fournisseur inconnu : ${provider}` };
  if (!kv.model) return { error: `modèle manquant pour le bras « ${name} »` };
  const baseUrl = kv['base-url'] || null;
  if (baseUrl && provider !== 'openai') return { error: 'base-url ne vaut que pour un point d’accès compatible OpenAI' };
  return { name, settings: { provider, model: kv.model, baseUrl, ledgerModel: kv.ledger || null } };
}

/** Les réglages qui décident OÙ partent les CV et QUEL modèle les lit. `undefined` = à retirer. */
export function armEnv(s: ArmSettings): Record<string, string | undefined> {
  return {
    CV_ANALYZER_PROVIDER: s.provider,
    OPENAI_CHAT_MODEL: s.provider === 'openai' ? s.model : undefined,
    ANTHROPIC_CHAT_MODEL: s.provider === 'anthropic' ? s.model : undefined,
    OPENAI_BASE_URL: s.baseUrl ?? undefined,
    // TOUJOURS retiré : le modèle du relevé est posé par le script, bras par
    // bras (`phaseModels.ledger`). Laissé à l'ambiant, un fichier .env qui
    // active le mode hybride rendrait la RÉFÉRENCE hybride en silence.
    CV_ANALYZER_LEDGER_MODEL: undefined,
  };
}

/** L'environnement du processus d'un bras : l'ambiant, réglages du bras imposés (et retraits appliqués). */
export function childEnv(ambient: Readonly<Record<string, string | undefined>>, s: ArmSettings): Record<string, string | undefined> {
  const env = { ...ambient };
  for (const [k, v] of Object.entries(armEnv(s))) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

/** Écarts entre l'environnement effectif et les réglages demandés — vide si conforme. */
export function envMismatches(s: ArmSettings, env: Readonly<Record<string, string | undefined>>): string[] {
  const out: string[] = [];
  for (const [k, want] of Object.entries(armEnv(s))) {
    const got = env[k]?.trim() || undefined;
    if (want !== got) out.push(`${k} : attendu « ${want ?? '(absent)'} », trouvé « ${got ?? '(absent)'} »`);
  }
  return out;
}
