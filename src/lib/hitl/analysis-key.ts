/**
 * Identifiant d'ANALYSE d'une validation suspendue — PUR.
 *
 * C'est la clé d'idempotence du lien de réservation natif : le preview et
 * l'envoi doivent en déduire exactement le même, sinon le relecteur ne voit
 * pas le jeton qui partira. Les validations créées à partir du lot 3 le
 * portent dans leur charge utile ; celles qui étaient DÉJÀ EN VOL au moment
 * de la bascule ne l'ont pas — d'où le repli, dérivé de l'identifiant de
 * validation, qui est construit à partir des mêmes éléments.
 *
 *   auto IMAP : `val_imap_<boîte>_<uid>_<décision>` → `can_imap_<boîte>_<uid>`
 *   chat      : l'uid EST déjà l'identifiant d'analyse
 */
import { imapAnalysisId } from '@/lib/imap/analysis-id';

/**
 * L'identifiant de boîte peut contenir des `_` : on ancre donc sur la FIN
 * (uid numérique, puis décision), et le reste appartient à la boîte.
 */
const IMAP_VALIDATION_ID = /^val_imap_(.+)_(\d+)_(?:accept|reject)$/;

export function analysisIdForValidation(validation: {
  id: string;
  payload?: Record<string, unknown> | null;
}): string | null {
  const carried = validation.payload?.analysisId;
  if (typeof carried === 'string' && carried) return carried;

  const derived = IMAP_VALIDATION_ID.exec(validation.id);
  if (derived) return imapAnalysisId(derived[1] as string, derived[2] as string);

  const uid = validation.payload?.uid;
  return typeof uid === 'string' && uid ? uid : null;
}
