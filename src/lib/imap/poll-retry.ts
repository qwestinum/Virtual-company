/**
 * Rails de réessai du poller IMAP (correctif audit C2/C3, juillet 2026).
 *
 * Constat d'audit : `last_uid_seen` avançait sur QUASIMENT TOUS les échecs de
 * traitement d'une PJ — une panne OpenAI (rate limit 429, timeout), un hoquet
 * Supabase ou des verdicts LLM inexploitables « consommaient » le CV
 * définitivement (perte silencieuse), voire envoyaient un REFUS AUTO à tort
 * (score fantôme sur verdicts dégradés). Le seul rembobinage existant était le
 * différé HITL (`RetryableOutreachError`).
 *
 * Principe : UN SEUL RAIL. `RetryablePollError` est la classe de base testée
 * par le poller (`instanceof`) pour geler le curseur ; le différé HITL
 * (`RetryableOutreachError`) en hérite, et les échecs d'analyse re-tentables
 * empruntent le même mécanisme via `classifyProcessingError` + un compteur
 * DURABLE en base (`imap_cv_retries` — la mémoire de process ne survit pas au
 * serverless).
 *
 * Règle de classification (validée avec le DRH) : PERMANENT = défaut prouvé du
 * document (PDF corrompu, texte vide, format non supporté) — re-tenter ne
 * changera rien. TOUT LE RESTE = re-tentable sous plafond : le plafond
 * (`MAX_CV_ANALYSIS_ATTEMPTS` + backoff) protège du CV « poison » qui
 * bloquerait la boîte indéfiniment, et l'abandon est SIGNALÉ (journal +
 * binaire sauvegardé), jamais un refus auto.
 */

import { CVExtractError } from '@/lib/agents/cv-extract';

/**
 * Classe de base des erreurs qui GÈLENT le curseur `last_uid_seen` : le
 * message courant (et tous ceux après lui) seront re-fetchés au prochain poll
 * plutôt que perdus. Le poller la teste par `instanceof` — un seul rail pour
 * le différé HITL et les échecs d'analyse re-tentables.
 */
export class RetryablePollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryablePollError';
  }
}

export type ProcessingErrorClass = 'retryable' | 'permanent';

/**
 * Classe un échec de traitement de PJ. PURE.
 *
 * - `permanent` : défaut inhérent au DOCUMENT (`CVExtractError` hors panne
 *   moteur) — re-tenter le même fichier échouera pareil ⇒ trace
 *   `imap_cv_failed` et le curseur avance.
 * - `retryable` : tout le reste — panne LLM (transport `AIProviderError` :
 *   rate_limit/timeout/api_error/config_missing), verdicts inexploitables
 *   (`AnalysisUnavailableError`), hoquet DB, inconnu. Le défaut re-tentable
 *   est DÉLIBÉRÉ : consommer un CV sur une panne transitoire est pire qu'un
 *   réessai de trop (le plafond borne le pire cas).
 */
export function classifyProcessingError(err: unknown): ProcessingErrorClass {
  if (err instanceof CVExtractError) {
    // `pdf_engine_unavailable` = panne serveur (polyfill manquant), pas un
    // défaut du document — re-tentable.
    return err.code === 'pdf_engine_unavailable' ? 'retryable' : 'permanent';
  }
  return 'retryable';
}

/**
 * Plafond de tentatives RÉELLES d'analyse par (mailbox, uid). Au-delà :
 * abandon signalé (journal `imap_cv_analysis_abandoned` + binaire sauvegardé
 * en artefact pour traitement manuel), le curseur peut avancer — la boîte
 * n'est plus bloquée par un CV « poison ».
 */
export const MAX_CV_ANALYSIS_ATTEMPTS = 5;

/**
 * Backoff entre tentatives (minutes), indexé par le numéro de la tentative qui
 * vient d'échouer (1-based). Couverture totale ≈ 7 h 15 : une panne OpenAI ou
 * une saturation TPM de plusieurs heures ne consomme aucun CV. Pendant la
 * fenêtre, le poller gèle le curseur SANS re-tenter (zéro coût LLM).
 */
const RETRY_BACKOFF_MINUTES = [1, 15, 60, 360] as const;

/**
 * Prochaine échéance de réessai après la `attempts`-ième tentative échouée.
 * PURE (l'horloge est injectée). `null` = plafond atteint, plus de réessai
 * (l'appelant déclenche l'abandon signalé).
 */
export function computeNextRetryAt(attempts: number, now: Date): string | null {
  if (attempts >= MAX_CV_ANALYSIS_ATTEMPTS) return null;
  const idx = Math.min(Math.max(attempts, 1), RETRY_BACKOFF_MINUTES.length) - 1;
  const delayMinutes = RETRY_BACKOFF_MINUTES[idx];
  return new Date(now.getTime() + delayMinutes * 60_000).toISOString();
}

/**
 * Vrai si le message est encore dans sa fenêtre de backoff : ne pas re-tenter
 * (zéro coût LLM), geler le curseur ici. PURE.
 */
export function isInBackoffWindow(
  nextRetryAt: string | null,
  now: Date,
): boolean {
  if (!nextRetryAt) return false;
  const t = Date.parse(nextRetryAt);
  return Number.isFinite(t) && t > now.getTime();
}
