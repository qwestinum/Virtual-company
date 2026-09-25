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

export type ArmSettings = { provider: 'openai' | 'anthropic'; model: string; baseUrl: string | null };

/** Les réglages qui décident OÙ partent les CV et QUEL modèle les lit. `undefined` = à retirer. */
export function armEnv(s: ArmSettings): Record<string, string | undefined> {
  return {
    CV_ANALYZER_PROVIDER: s.provider,
    OPENAI_CHAT_MODEL: s.provider === 'openai' ? s.model : undefined,
    ANTHROPIC_CHAT_MODEL: s.provider === 'anthropic' ? s.model : undefined,
    OPENAI_BASE_URL: s.baseUrl ?? undefined,
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
