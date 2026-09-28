/**
 * Rapport de campagne — « Du CV au recrutement » (feat/feedback-candidat,
 * lot 5). SERVEUR UNIQUEMENT (`@react-pdf/renderer`).
 *
 * L'entonnoir en trajectoires (reçues → invités → entretiens → retenus →
 * recrutés), le taux de placement quand un recruté est désigné, et combien
 * de candidats reçus en entretien ont été informés de la décision. Un
 * INDICATEUR, jamais le contenu des messages.
 */

import { StyleSheet, Text, View } from '@react-pdf/renderer';

import { PDF_COLORS, pdfBaseStyles } from '@/lib/reporting/pdf-theme';
import type { InterviewFunnel } from '@/lib/reporting/interview-funnel';

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginTop: 4 },
  card: {
    flex: 1,
    padding: 8,
    backgroundColor: PDF_COLORS.panel,
    borderWidth: 1,
    borderColor: PDF_COLORS.hairline,
    borderRadius: 4,
  },
  num: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  label: { fontSize: 7, color: PDF_COLORS.muted, textTransform: 'uppercase' },
});

export function CampaignFunnelPdfSection({ funnel }: { funnel: InterviewFunnel }) {
  const etapes: [number, string][] = [
    [funnel.received, 'Reçues'],
    [funnel.invited, 'Invités'],
    [funnel.interviewed, 'Entretiens'],
    [funnel.retained, 'Retenus'],
    [funnel.hired, 'Recrutés'],
  ];
  return (
    <View wrap={false}>
      <Text style={pdfBaseStyles.sectionTitle}>Du CV au recrutement</Text>
      <View style={s.row}>
        {etapes.map(([n, label]) => (
          <View key={label} style={s.card}>
            <Text style={s.num}>{n}</Text>
            <Text style={s.label}>{label}</Text>
          </View>
        ))}
      </View>
      {funnel.conversionRate !== null ? (
        <Text style={[pdfBaseStyles.paragraph, { marginTop: 8 }]}>
          Taux de conversion : {funnel.conversionRate} % (recrutés / candidatures reçues).
        </Text>
      ) : null}
      {funnel.placementRate !== null ? (
        <Text style={[pdfBaseStyles.paragraph, { marginTop: 4 }]}>
          Taux de placement : {funnel.placementRate} % (recrutés / retenus présentés).
        </Text>
      ) : null}
      {funnel.informed ? (
        <Text style={[pdfBaseStyles.paragraph, { marginTop: 4 }]}>
          Candidats reçus en entretien informés de la décision : {funnel.informed.informed}/
          {funnel.informed.total}.
        </Text>
      ) : null}
    </View>
  );
}
