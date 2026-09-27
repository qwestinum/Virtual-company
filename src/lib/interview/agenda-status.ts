/**
 * État RÉEL du lien d'agenda, campagne par campagne — PUR.
 *
 * Le réglage « Lien d'agenda » des Paramètres affichait « non configuré — les
 * acceptations ne pourront pas être envoyées » dès que le champ était vide.
 * Faux depuis que la réservation native est le régime par défaut : une
 * campagne native envoie un lien NOMINATIF sur les disponibilités de son
 * référent et ne lit jamais ce champ. L'avertissement disait l'état d'un
 * champ, pas l'état des campagnes (27/09/2026).
 *
 * Ce module ne décide rien : il RÉSUME ce que la sonde d'envoi
 * (`campaignAgendaState`, côté serveur) a constaté, puis choisit ce que
 * l'écran en dit. Le champ n'est plus bloquant que s'il porte réellement
 * une campagne.
 */

/** Ce que l'envoi d'une invitation trouverait, pour une campagne. */
export type CampaignAgendaState =
  /** Lien nominatif émis sur l'agenda du référent — `bookable` = la sonde d'envoi passe. */
  | { regime: 'native'; bookable: boolean }
  /**
   * Lien statique. `referent` = lien personnel du référent (le champ n'y est
   * pour rien) ; `field` = le réglage des Paramètres ou, à défaut, rien.
   */
  | { regime: 'external'; source: 'referent' | 'field' };

export type AgendaStatus = {
  /** Campagnes actives en réservation native. */
  native: number;
  /** …dont l'invitation est bloquée (référent sans disponibilités, sans lieu, inactif ou absent). */
  nativeBlocked: number;
  /** Campagnes actives sans réservation native qui dépendent du champ des Paramètres. */
  externalOnField: number;
  /** Un lien de secours est posé hors de l'écran (variable d'environnement historique). */
  envFallback: boolean;
};

export function summarizeAgendaStatus(
  states: readonly CampaignAgendaState[],
  envFallback: boolean,
): AgendaStatus {
  let native = 0;
  let nativeBlocked = 0;
  let externalOnField = 0;
  for (const s of states) {
    if (s.regime === 'native') {
      native += 1;
      if (!s.bookable) nativeBlocked += 1;
    } else if (s.source === 'field') {
      externalOnField += 1;
    }
  }
  return { native, nativeBlocked, externalOnField, envFallback };
}

export type AgendaNotice = { tone: 'ok' | 'warn'; text: string };

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/**
 * Ce que l'écran dit des CAMPAGNES, selon leur état et ce qui est SAISI dans le
 * lien externe (le brouillon : le vider doit prévenir avant d'enregistrer).
 * L'agenda interne est le défaut : on ne parle du lien externe que si une
 * campagne en dépend réellement.
 * `status === null` = état indisponible : ni fausse alarme, ni faux « tout va
 * bien » — rien.
 */
export function agendaFieldNotices(
  status: AgendaStatus | null,
  draftLink: string,
): AgendaNotice[] {
  if (!status) return [];
  const fieldEmpty = draftLink.trim().length === 0;
  const notices: AgendaNotice[] = [];
  if (status.native > 0 && status.nativeBlocked === 0) {
    notices.push({
      tone: 'ok',
      text: `${status.native} ${plural(status.native, 'campagne active invite', 'campagnes actives invitent')} sur l’agenda interne de ${plural(status.native, 'son', 'leur')} référent.`,
    });
  }
  if (status.nativeBlocked > 0) {
    notices.push({
      tone: 'warn',
      text: `${status.nativeBlocked} ${plural(status.nativeBlocked, 'campagne ne peut', 'campagnes ne peuvent')} pas inviter : ${plural(status.nativeBlocked, 'son', 'leur')} référent n’a pas de disponibilités ou de lieu de rendez-vous (voir « Agendas & disponibilités »).`,
    });
  }
  if (status.externalOnField > 0 && fieldEmpty && !status.envFallback) {
    notices.push({
      tone: 'warn',
      text: `${status.externalOnField} ${plural(status.externalOnField, 'campagne active a', 'campagnes actives ont')} la réservation native désactivée et aucun lien externe : ${plural(status.externalOnField, 'ses', 'leurs')} acceptations sont bloquées. Réactivez la réservation native (Campagnes → édition) ou renseignez un lien externe ci-dessous.`,
    });
  }
  return notices;
}
