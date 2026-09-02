/**
 * Arrêts de l'effacement — PUR.
 * Procédure : docs/ops/purge-rgpd-candidat.md §7.5.
 *
 * Un effacement peut entrer en conflit avec un engagement en cours : un
 * entretien programmé demain, une réservation confirmée, un message de décision
 * en cours d'expédition. Ce conflit n'est PAS une erreur technique, et ORQA
 * n'a pas à le trancher — c'est un arbitrage du responsable de traitement.
 *
 * D'où deux exigences que ce fichier matérialise :
 *
 *   1. L'outil S'ARRÊTE AVANT d'écrire quoi que ce soit. Pas de purge partielle
 *      suivie d'un « au fait, il y avait un entretien ».
 *   2. Le message est ACTIONNABLE POUR LE CLIENT, pas technique. « conflit
 *      d'état sur interview_briefs » ne dit rien à personne ; « un entretien est
 *      programmé le 3 septembre à 10 h, annulez-le ou confirmez par écrit que
 *      l'effacement prime » se traite.
 *
 * Aucune option ne passe outre. Il faut lever la cause, puis relancer — sans
 * quoi l'arbitrage du responsable de traitement se réduirait à un drapeau que
 * l'opérateur ORQA finirait par cocher lui-même.
 */

export type BlockerKind =
  | 'interview_scheduled'
  | 'booking_confirmed'
  | 'validation_sending';

export type ErasureBlocker = {
  kind: BlockerKind;
  /** Phrase destinée au responsable de traitement. Sans jargon. */
  message: string;
  /** Repère technique, pour l'opérateur ORQA (jamais transmis au candidat). */
  ref: string;
};

/** Faits bruts remontés de la base, sans mise en forme. */
export type BlockerFacts = {
  scheduledInterviews: { ref: string; startAt: string | null; campaignId: string | null }[];
  confirmedBookings: { ref: string; startAt: string; campaignId: string | null }[];
  sendingValidations: { ref: string; since: string | null }[];
};

/** Fuseau de référence des équipes — le même que celui du module de réservation. */
const TZ = 'Europe/Paris';

function frDateTime(iso: string | null): string {
  if (!iso) return 'à une date non renseignée';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'à une date non renseignée';
  const date = d.toLocaleDateString('fr-FR', {
    timeZone: TZ,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('fr-FR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
  return `le ${date} à ${time}`;
}

function forCampaign(campaignId: string | null): string {
  return campaignId ? ` (campagne ${campaignId})` : '';
}

/**
 * Traduit les faits en arrêts. Liste vide = rien ne s'oppose à l'effacement.
 *
 * Les deux premiers arrêts appellent une décision humaine. Le troisième se lève
 * seul en quelques minutes (un envoi en cours se termine), et son message le
 * dit — pour qu'on ne dérange personne pour une attente de trois minutes.
 */
export function detectBlockers(facts: BlockerFacts): ErasureBlocker[] {
  const out: ErasureBlocker[] = [];

  for (const i of facts.scheduledInterviews) {
    out.push({
      kind: 'interview_scheduled',
      ref: i.ref,
      message:
        `Un entretien est programmé ${frDateTime(i.startAt)}${forCampaign(i.campaignId)}. ` +
        `L'effacement est suspendu : le responsable de traitement doit annuler ` +
        `l'entretien, ou confirmer par écrit que l'effacement prime.`,
    });
  }

  for (const b of facts.confirmedBookings) {
    out.push({
      kind: 'booking_confirmed',
      ref: b.ref,
      message:
        `Un rendez-vous est réservé ${frDateTime(b.startAt)}${forCampaign(b.campaignId)}. ` +
        `L'effacement est suspendu : le responsable de traitement doit annuler ` +
        `le rendez-vous, ou confirmer par écrit que l'effacement prime.`,
    });
  }

  for (const v of facts.sendingValidations) {
    out.push({
      kind: 'validation_sending',
      ref: v.ref,
      message:
        `Un message de décision est en cours d'expédition ` +
        `(réservé ${frDateTime(v.since)}). L'effacement est suspendu le temps ` +
        `que l'envoi aboutisse — quelques minutes. Relancez la commande ensuite ; ` +
        `aucune intervention n'est nécessaire.`,
    });
  }

  return out;
}

/**
 * Un arrêt appelle-t-il une décision HUMAINE, ou se lève-t-il seul ? Sert à
 * l'affichage : on ne renvoie pas l'opérateur vers le client pour une attente
 * de trois minutes.
 */
export function needsHumanDecision(blocker: ErasureBlocker): boolean {
  return blocker.kind !== 'validation_sending';
}
