/**
 * Ce que l'écran DIT après « Inviter » (point 1) — PUR, client-safe. Une
 * invitation qui n'est pas partie ne s'annonce jamais comme envoyée.
 */
export type VivierInviteMailStatus = 'sent' | 'duplicate' | 'send_failed' | 'skipped';

export function vivierInviteNotice(name: string, mail: VivierInviteMailStatus): {
  tone: 'ok' | 'warn';
  text: string;
} {
  const who = name.trim() || 'Ce profil';
  switch (mail) {
    case 'sent':
      return {
        tone: 'ok',
        text: `${who} est invité : la candidature est créée (étape « Invité ») et l’invitation est partie avec son lien de réservation.`,
      };
    case 'duplicate':
      return {
        tone: 'ok',
        text: `${who} avait déjà reçu son invitation : aucun second message n’est parti.`,
      };
    case 'send_failed':
      return {
        tone: 'warn',
        text: `La candidature de ${who} est créée, mais l’invitation n’est pas partie. Vous pouvez la renvoyer depuis Entretiens.`,
      };
    case 'skipped':
      return {
        tone: 'warn',
        text: `La candidature de ${who} est créée, mais aucun lien de réservation n’a pu être émis : l’invitation n’est pas partie. Vérifiez le référent et ses disponibilités, puis renvoyez-la depuis Entretiens.`,
      };
  }
}
