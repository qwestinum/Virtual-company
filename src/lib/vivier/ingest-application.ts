/**
 * Alimentation automatique du vivier depuis les flux de candidatures
 * (Session V2, docs/specs/vivier.md §3.1 porte 2).
 *
 * Toute candidature entrante (réception email IMAP, upload manuel DRH/chat)
 * alimente le vivier APRÈS sa persistance propre : création ou mise à jour du
 * dossier par email (déduplication V1 réutilisée telle quelle), puis indexation.
 * C'est l'effet d'accumulation : chaque campagne enrichit le stock.
 *
 * GARANTIES :
 *   - NON BLOQUANT : la fonction n'échoue JAMAIS vers l'appelant (tout est
 *     avalé + loggé). Elle est conçue pour être appelée en tâche de fond
 *     (`after()` côté route, fire-and-forget côté poller) : ni le traitement de
 *     la candidature ni la réponse utilisateur ne dépendent d'elle.
 *   - DÉDUPLICATION / IDEMPOTENCE : `upsertVivierCandidate` déduplique par email
 *     (même email ⇒ mise à jour du dossier, jamais de doublon). Un rejeu de la
 *     même candidature retombe sur le même dossier.
 *   - GARDE EMAIL : sans email résolu, pas de clé de déduplication ⇒ on
 *     n'alimente pas (la candidature reste traitée par ailleurs).
 *
 * Server-only.
 */

import { upsertVivierCandidate } from '@/lib/vivier/candidates';
import { indexVivierCandidate } from '@/lib/vivier/indexing';
import type { CVApplication } from '@/types/cv-analysis';

/** MIME déduit de l'extension quand la source ne le fournit pas (défaut PDF). */
function mimeForFileName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.md')) return 'text/markdown';
  return 'application/pdf';
}

export type FeedVivierInput = {
  application: CVApplication;
  /** Texte du CV extrait (l'indexation s'appuie dessus). */
  cvText: string;
  /** Contenu binaire d'origine du CV (stocké au vivier). */
  cvContent: Buffer;
  /** MIME d'origine ; déduit du nom de fichier si absent. */
  cvMimeType?: string;
};

/**
 * Alimente le vivier à partir d'une candidature analysée. Ne lève jamais.
 * Renvoie `true` si un dossier a été créé/mis à jour, `false` si l'alimentation
 * a été ignorée (pas d'email) ou a échoué (avalé).
 */
export async function feedVivierFromApplication(
  input: FeedVivierInput,
): Promise<boolean> {
  const { candidate } = input.application;
  const email = candidate.email?.trim();
  if (!email) {
    // Pas d'email résolu ⇒ pas de clé de déduplication. On n'alimente pas.
    console.info('[vivier] alimentation auto ignorée : aucun email résolu.');
    return false;
  }

  try {
    const { candidate: dossier } = await upsertVivierCandidate({
      email,
      nom: candidate.fullName,
      prenom: null,
      telephone: candidate.phone,
      cvContent: input.cvContent,
      cvFileName: candidate.fileName,
      cvMimeType: input.cvMimeType || mimeForFileName(candidate.fileName),
      cvText: input.cvText,
      source: 'campaign_application',
    });
    // Indexation in-process : on est déjà en tâche de fond (after()/poller),
    // l'attendre ici ne bloque aucun chemin utilisateur.
    await indexVivierCandidate(dossier.id);
    return true;
  } catch (err) {
    // Non bloquant : l'alimentation vivier ne doit jamais casser le flux de
    // candidature. On loggue et on s'arrête là.
    console.error('[vivier] alimentation auto échouée', err);
    return false;
  }
}
