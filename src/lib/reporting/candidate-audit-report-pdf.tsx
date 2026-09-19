/**
 * Section « Compte rendu d'entretien » du PDF d'audit — SERVEUR UNIQUEMENT.
 * Spec : docs/specs/compte-rendu-entretien.md §7.2.
 *
 * Seul un compte rendu VALIDÉ entre au dossier (un brouillon n'est pas une
 * pièce). Sa mention est rendue des colonnes de vérification — « établi à
 * partir d'une transcription, vérifié par X le JJ/MM » — jamais stockée.
 */

import { StyleSheet, Text, View } from '@react-pdf/renderer';

import { interviewReportMention } from '@/lib/candidatures/interview-report-mention';
import { sectionLabels, type InterviewReport } from '@/types/interview-report';

const MUTED = '#78716c';

const s = StyleSheet.create({
  mention: { fontSize: 7.5, color: MUTED, marginBottom: 4 },
  label: { fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  body: { fontSize: 9, lineHeight: 1.45 },
});

export function InterviewReportPdfSection({
  report,
  title,
}: {
  report: InterviewReport;
  /** Le titre est posé par le gabarit (sa charte). */
  title: React.ReactNode;
}) {
  const labels = sectionLabels(report.source);
  const { sections } = report;
  const blocks: { label: string; text: string }[] = [
    { label: labels.topics, text: sections.topics },
    ...sections.criteria.map((c) => ({ label: `${labels.criteria} — ${c.label}`, text: c.text })),
    { label: labels.highlights, text: sections.highlights },
    { label: labels.reservations, text: sections.reservations },
    { label: labels.followUps, text: sections.followUps },
  ].filter((b) => b.text.trim() !== '');

  return (
    <View>
      {title}
      <Text style={s.mention}>{interviewReportMention(report)}</Text>
      {blocks.map((b, i) => (
        <View key={i} wrap={false}>
          <Text style={s.label}>{b.label}</Text>
          <Text style={s.body}>{b.text}</Text>
        </View>
      ))}
    </View>
  );
}
