/**
 * Section « Message au candidat » du PDF d'audit — SERVEUR UNIQUEMENT
 * (`@react-pdf/renderer`). feat/feedback-candidat, lot 5.
 *
 * Ce que le candidat a appris de la décision, par qui, quand et comment : le
 * message tel qu'envoyé, ou le canal déclaré par le recruteur qui l'a prévenu
 * lui-même, ou un envoi qui n'est pas parti. Aucun cas n'est tu : « aucun
 * message » s'écrit, et une lecture en échec aussi.
 */

import { StyleSheet, Text, View } from '@react-pdf/renderer';

import { formatFrDateTime } from '@/lib/reporting/audit-display';
import { feedbackEventLabel } from '@/lib/reporting/candidate-timeline';
import { FEEDBACK_KIND_LABELS, type CandidateFeedback } from '@/types/candidate-feedback';

const MUTED = '#78716c';
const HAIRLINE = '#e7e5e4';

const s = StyleSheet.create({
  line: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 4, marginBottom: 2 },
  box: {
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#fafaf9',
  },
  body: { fontSize: 8.5, lineHeight: 1.45 },
  meta: { fontSize: 7.5, color: MUTED, marginTop: 2 },
});

export function CandidateFeedbackSection({
  rows,
  hiredAt,
  title,
}: {
  rows: readonly CandidateFeedback[] | 'unavailable';
  /** Désignation courante du recruté, s'il l'est. */
  hiredAt: string | null;
  title: React.ReactNode;
}) {
  return (
    <View>
      {title}
      {hiredAt ? (
        <Text style={s.line}>Recruté — désigné à la clôture de la campagne, le {formatFrDateTime(hiredAt)}</Text>
      ) : null}
      {rows === 'unavailable' ? (
        <Text style={s.meta}>
          Messages au candidat : lecture indisponible au moment de la génération. Régénérez l’audit.
        </Text>
      ) : rows.length === 0 ? (
        <Text style={s.meta}>Aucun message au candidat après décision n’est enregistré.</Text>
      ) : (
        rows.map((f) => (
          <View key={f.id} wrap={false}>
            <Text style={s.line}>
              {feedbackEventLabel(f).label} — message « {FEEDBACK_KIND_LABELS[f.kind]} », le{' '}
              {formatFrDateTime(f.createdAt)}
            </Text>
            <Text style={s.meta}>
              {f.authorEmail ? `Par ${f.authorEmail}` : 'Auteur non enregistré'}
              {f.channelNote ? ` · ${f.channelNote}` : ''}
            </Text>
            {f.channel === 'mail' && f.body ? (
              <View style={s.box}>
                <Text style={s.body}>{f.subject ? `Objet : ${f.subject}\n\n` : ''}{f.body}</Text>
              </View>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}
