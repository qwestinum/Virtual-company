/**
 * Section « Décision finale » du PDF d'audit candidat — SERVEUR UNIQUEMENT
 * (`@react-pdf/renderer`). Spec : docs/specs/compte-rendu-entretien.md §7.2.
 *
 * C'est le document qui rend la candidature DÉFENDABLE : le verdict, qui l'a
 * posé, et pourquoi, avec ses propres mots. Aucun des trois cas n'est tu :
 *   - le commentaire écrit pour ce verdict ;
 *   - un commentaire écrit pour un AUTRE verdict, corrigé depuis — dit comme
 *     tel, jamais présenté comme la justification du verdict courant ;
 *   - aucun commentaire (verdict antérieur à la règle, ou correction) — écrit,
 *     parce qu'un blanc se lirait « pas vérifié ».
 */

import { StyleSheet, Text, View } from '@react-pdf/renderer';

import {
  FINAL_VERDICT_LABELS,
  type FinalDecisionView,
} from '@/lib/candidatures/final-decision';
import { formatFrDateTime } from '@/lib/reporting/audit-display';

const MUTED = '#78716c';
const HAIRLINE = '#e7e5e4';

const s = StyleSheet.create({
  verdict: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  box: {
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#fafaf9',
  },
  body: { fontSize: 9, lineHeight: 1.45 },
  meta: { fontSize: 7.5, color: MUTED, marginTop: 3 },
});

/** Contenu de la section ; le titre est posé par le gabarit (sa charte). */
export function FinalDecisionSection({
  decision,
  title,
}: {
  decision: FinalDecisionView;
  title: React.ReactNode;
}) {
  const { comment } = decision;
  return (
    <View wrap={false}>
      {title}
      <Text style={s.verdict}>
        {FINAL_VERDICT_LABELS[decision.verdict]} — le {formatFrDateTime(decision.decidedAt)}
      </Text>
      {comment ? (
        <View style={s.box}>
          <Text style={s.body}>« {comment.body} »</Text>
          <Text style={s.meta}>
            Commentaire du recruteur
            {comment.authorEmail ? `, ${comment.authorEmail}` : ' (auteur non enregistré)'}, le{' '}
            {formatFrDateTime(comment.createdAt)}
            {decision.commentMatches
              ? '.'
              : ` — écrit pour le verdict « ${FINAL_VERDICT_LABELS[comment.verdict]} », corrigé depuis.`}
          </Text>
        </View>
      ) : (
        <Text style={s.meta}>
          Aucun commentaire enregistré pour ce verdict (verdict antérieur au
          commentaire obligatoire, ou posé par une correction).
        </Text>
      )}
    </View>
  );
}
