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
 * Classe de base des erreurs DIFFÉRABLES (différé HITL, claim `in_flight`) :
 * l'uid est mis de côté dans `imap_cv_retries` avec son échéance et re-fetché
 * nommément — la file continue, le curseur avance (découplage, cf.
 * `buildFetchSet`). Compte dans le plafond (validé DRH) : un différé qui ne se
 * résout pas en ~21 min finit en abandon signalé, jamais en attente invisible.
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
 * en artefact pour traitement manuel). Resserré 5 → 3 (validé DRH, incident
 * 07/2026) : l'objectif du rail est d'absorber un aléa PASSAGER, pas de
 * couvrir une panne de plusieurs heures au prix d'un CV immobilisé.
 */
export const MAX_CV_ANALYSIS_ATTEMPTS = 3;

/**
 * Backoff entre tentatives (minutes), indexé par le numéro de la tentative qui
 * vient d'échouer (1-based). Couverture totale ≈ 21 min (resserré depuis
 * 1/15/60/360 ≈ 7 h 15, validé DRH) : un rate limit qui se calme ou un réseau
 * qui revient est couvert ; au-delà, abandon SIGNALÉ (binaire sauvegardé,
 * rejouable) plutôt qu'une file immobilisée des heures. Pendant la fenêtre,
 * l'uid n'est simplement PAS re-fetché (zéro coût LLM) — il attend dans
 * `imap_cv_retries` SANS geler le curseur (découplage, cf. `buildFetchSet`).
 */
const RETRY_BACKOFF_MINUTES = [1, 5, 15] as const;

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
 * (zéro coût LLM) — l'uid attend dans `imap_cv_retries`, la file continue.
 * PURE.
 */
export function isInBackoffWindow(
  nextRetryAt: string | null,
  now: Date,
): boolean {
  if (!nextRetryAt) return false;
  const t = Date.parse(nextRetryAt);
  return Number.isFinite(t) && t > now.getTime();
}

/**
 * DÉCOUPLAGE curseur / retry (correctif incident 07/2026 — « un CV en retry
 * paralysait toute la file »). Le curseur `last_uid_seen` avance sur tous les
 * uids vus ; un uid en retry passe DERRIÈRE lui, mémorisé dans
 * `imap_cv_retries`, et est re-fetché NOMMÉMENT à son échéance via le set UID
 * IMAP construit ici : `"1624,1626,1701:*"` = les retries échus (≤ curseur)
 * + la plage des nouveaux messages. PURE.
 *
 * Sûreté anti-double-envoi : le re-traitement d'un uid est couvert par les
 * claims deux-phases `(mailbox, uid, mode)` — la contrainte historique qui
 * imposait le « min bloquant + break » (rembobiner re-présentait les uids
 * suivants et les re-mailait) a sauté, et le curseur ne rembobinant plus, les
 * uids SUIVANTS ne sont plus jamais re-présentés.
 */
export function buildFetchSet(
  lastUidSeen: number | null,
  dueRetryUids: number[],
): string {
  if (lastUidSeen === null) return '1:*';
  const range = `${lastUidSeen + 1}:*`;
  // Seuls les uids ≤ curseur ont besoin d'un fetch nommé — les autres sont
  // déjà couverts par la plage (un set qui se recouvre reste un set, mais
  // autant rester univoque). Tri + dédup pour un set IMAP propre.
  const named = [...new Set(dueRetryUids.filter((u) => u <= lastUidSeen))].sort(
    (a, b) => a - b,
  );
  if (named.length === 0) return range;
  return `${named.join(',')},${range}`;
}

/**
 * Garde de boucle du poll : un uid ≤ curseur n'est traité QUE s'il fait
 * partie des retries échus re-fetchés nommément (sinon c'est un re-fetch
 * parasite du serveur IMAP — ex. sémantique Gmail du `*`). PURE.
 */
export function shouldProcessUid(
  uid: number,
  previousLastUid: number,
  dueRetryUids: ReadonlySet<number>,
): boolean {
  return uid > previousLastUid || dueRetryUids.has(uid);
}

/**
 * Cible du COMMIT PAR MESSAGE du curseur (durcissement Vercel : la fonction
 * cron est tuée net à `maxDuration` — seul ce qui est déjà écrit survit).
 * `maxUidSeen` = plus haut uid NOUVEAU dont le traitement est résolu (ou en
 * cours — l'appelant committe AVANT d'inclure le message courant), clampé
 * sous le frein « état final inécrivable » (`minRetryUid`), et on n'écrit
 * que si ça AVANCE (`committedSoFar`) — le curseur ne recule jamais.
 * `null` = rien à committer. PURE.
 */
export function nextCommitTarget(
  maxUidSeen: number,
  minRetryUid: number | null,
  committedSoFar: number,
): number | null {
  let target = maxUidSeen;
  if (minRetryUid !== null) target = Math.min(target, minRetryUid - 1);
  return target > committedSoFar ? target : null;
}
