/**
 * Génération du PDF d'audit candidat (cf. docs/specs/reporting.md §5.3).
 *
 * SERVEUR UNIQUEMENT — utilise `@react-pdf/renderer` (`renderToBuffer`),
 * externalisé dans next.config.ts. Ne JAMAIS importer depuis un composant
 * client : ce module est consommé par les routes API report / send.
 *
 * Le PDF matérialise la « traçabilité native d'ORQA » : profil, grille
 * appliquée critère-par-critère (verdict + citation + poids + contribution),
 * score, statut, historique et mention RGPD.
 */

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';

import {
  LLM_DECISION_COLORS,
  LLM_DECISION_LABELS,
  buildCandidateHistory,
  formatFrDate,
  formatFrDateTime,
  sortByCriticality,
} from '@/lib/reporting/audit-display';
import {
  JOURNEY_TONE_COLORS,
  journeyColumns,
} from '@/lib/reporting/candidate-journey';
import type { CandidateAnalysisDetail } from '@/types/reporting';
import {
  CANDIDATE_STATUS_LABELS,
  SCORING_LEVEL_LABELS,
} from '@/types/scoring';

const ORQA_ORANGE = '#FF8A00';
const INK = '#1c1917'; // stone-900
const MUTED = '#78716c'; // stone-500
const HAIRLINE = '#e7e5e4'; // stone-200

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 44,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: INK,
    lineHeight: 1.4,
  },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 2,
    borderBottomColor: ORQA_ORANGE,
    paddingBottom: 8,
    marginBottom: 14,
  },
  brand: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: ORQA_ORANGE },
  brandSub: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: INK },
  genMention: { fontSize: 8, color: MUTED },
  h1: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: ORQA_ORANGE,
    marginTop: 16,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scoreBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    padding: 10,
    backgroundColor: '#fafaf9',
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 4,
  },
  scoreNum: { fontSize: 22, fontFamily: 'Helvetica-Bold' },
  statusPill: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    color: '#fff',
  },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  metaItem: { width: '50%', marginBottom: 4 },
  metaLabel: { fontSize: 7.5, color: MUTED, textTransform: 'uppercase' },
  metaValue: { fontSize: 9 },
  paragraph: { marginTop: 2 },
  critRow: {
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
    paddingVertical: 5,
  },
  critHead: { flexDirection: 'row', justifyContent: 'space-between' },
  critLabel: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', flex: 1, paddingRight: 8 },
  critVerdict: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  critMeta: { fontSize: 7.5, color: MUTED, marginTop: 1 },
  critQuote: {
    fontSize: 8.5,
    color: '#44403c',
    fontFamily: 'Helvetica-Oblique',
    marginTop: 2,
  },
  bullet: { flexDirection: 'row', marginBottom: 2 },
  bulletDot: { width: 10 },
  bulletText: { flex: 1 },
  histRow: { flexDirection: 'row', marginBottom: 4 },
  histDate: { width: 110, fontSize: 8, color: MUTED },
  histBody: { flex: 1 },
  histLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 44,
    right: 44,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 6,
    fontSize: 7,
    color: MUTED,
  },
});

function statusColor(status: 'accepted' | 'rejected'): string {
  return status === 'accepted' ? '#15803d' : '#b91c1c';
}

type AuditPdfProps = {
  detail: CandidateAnalysisDetail;
  generatedAtIso: string;
  campaignLabel: string;
};

function AuditDocument({ detail, generatedAtIso, campaignLabel }: AuditPdfProps) {
  const { application } = detail;
  const { candidate, scoringResult, narration } = application;
  const ordered = sortByCriticality(scoringResult.breakdown);
  const history = buildCandidateHistory(detail);

  return (
    <Document
      title={`Audit candidat — ${candidate.fullName}`}
      author="ORQA"
      subject="Audit candidat"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.brandRow} fixed>
          <View>
            <Text style={styles.brand}>ORQA</Text>
            <Text style={styles.brandSub}>Audit candidat</Text>
          </View>
          <Text style={styles.genMention}>
            Audit généré le {formatFrDateTime(generatedAtIso)}
          </Text>
        </View>

        <Text style={styles.h1}>{candidate.fullName}</Text>
        <Text style={styles.genMention}>
          {campaignLabel} · Candidature {detail.id}
        </Text>

        <View style={styles.scoreBox}>
          <Text style={styles.scoreNum}>{scoringResult.totalScore}/100</Text>
          <Text
            style={[
              styles.statusPill,
              { backgroundColor: statusColor(scoringResult.status) },
            ]}
          >
            {CANDIDATE_STATUS_LABELS[scoringResult.status]}
          </Text>
          <Text style={{ flex: 1, fontSize: 8.5, color: MUTED }}>
            {narration.justification}
          </Text>
        </View>

        {detail.journey ? (
          <>
            <Text style={styles.sectionTitle}>Parcours candidat</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {journeyColumns(detail.journey).map((col) => (
                <View
                  key={col.key}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: HAIRLINE,
                    borderRadius: 4,
                    paddingVertical: 5,
                    paddingHorizontal: 6,
                    backgroundColor: col.reached ? '#fff' : '#fafaf9',
                  }}
                >
                  <Text style={{ fontSize: 6.5, color: MUTED, textTransform: 'uppercase' }}>
                    {col.title}
                  </Text>
                  <Text
                    style={{
                      marginTop: 2,
                      fontSize: 8,
                      fontFamily: 'Helvetica-Bold',
                      color: col.reached ? JOURNEY_TONE_COLORS[col.tone] : '#a8a29e',
                    }}
                  >
                    {col.label}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={[styles.paragraph, { marginTop: 4, color: MUTED }]}>
              Intervention humaine : {detail.journey.humanIntervention ? 'Oui' : 'Non'}
              {detail.journey.humanIntervention
                ? ' — la décision a été modifiée par rapport au verdict IA du screening.'
                : '.'}
            </Text>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Profil du candidat</Text>
        <View style={styles.metaGrid}>
          <MetaItem label="Email" value={candidate.email ?? '— manquant'} />
          <MetaItem label="Téléphone" value={candidate.phone ?? '—'} />
          <MetaItem label="Localisation" value={candidate.location ?? '—'} />
          <MetaItem label="Langue détectée" value={candidate.detectedLanguage ?? '—'} />
          <MetaItem label="Canal de réception" value={candidate.source} />
          <MetaItem label="Reçu le" value={formatFrDate(candidate.receivedAt)} />
          <MetaItem label="Fichier" value={candidate.fileName} />
          <MetaItem label="Grille appliquée" value={scoringResult.criteriaVersion} />
        </View>
        <Text style={[styles.paragraph, { marginTop: 6 }]}>{narration.summary}</Text>

        <Text style={styles.sectionTitle}>Grille de scoring — critère par critère</Text>
        {ordered.map((b, i) => (
          <View key={`${b.criterionId}-${i}`} style={styles.critRow} wrap={false}>
            <View style={styles.critHead}>
              <Text style={styles.critLabel}>{b.criterionLabel}</Text>
              <Text
                style={[styles.critVerdict, { color: LLM_DECISION_COLORS[b.llmDecision] }]}
              >
                {LLM_DECISION_LABELS[b.llmDecision]}
              </Text>
            </View>
            <Text style={styles.critMeta}>
              {SCORING_LEVEL_LABELS[b.criticityLevel]} · poids {b.weight} ·
              contribution {b.contribution > 0 ? '+' : ''}
              {b.contribution} pts
            </Text>
            {b.llmCVQuote ? (
              <Text style={styles.critQuote}>« {b.llmCVQuote} »</Text>
            ) : null}
            <Text style={[styles.critMeta, { marginTop: 1 }]}>{b.llmJustification}</Text>
          </View>
        ))}

        {scoringResult.hardFailures.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Échecs sur critères durs</Text>
            {scoringResult.hardFailures.map((h, i) => (
              <Bullet
                key={`${h.criterionId}-${i}`}
                text={`${h.criterionLabel} — ${
                  h.reason === 'unsatisfied' ? 'non satisfait' : 'non vérifiable'
                }`}
              />
            ))}
          </>
        ) : null}

        {narration.strengths.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Points forts</Text>
            {narration.strengths.map((s, i) => (
              <Bullet key={i} text={s} />
            ))}
          </>
        ) : null}

        {narration.weaknesses.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Points d&apos;attention</Text>
            {narration.weaknesses.map((w, i) => (
              <Bullet key={i} text={w} />
            ))}
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Historique des actions</Text>
        {history.map((e, i) => (
          <View key={i} style={styles.histRow} wrap={false}>
            <Text style={styles.histDate}>{formatFrDateTime(e.at)}</Text>
            <View style={styles.histBody}>
              <Text style={styles.histLabel}>{e.label}</Text>
              {e.detail ? <Text style={styles.critMeta}>{e.detail}</Text> : null}
            </View>
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>
            Document généré par ORQA — traçabilité native du processus de
            recrutement. Conformité RGPD : les données candidat sont conservées
            le temps de la procédure de recrutement puis supprimées selon la
            politique de rétention de l&apos;organisation. Ce rapport est
            destiné à un usage interne / DPO.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

/**
 * Rend le PDF d'audit candidat en Buffer. `generatedAtIso` est injecté par
 * l'appelant (déterminisme / testabilité) — jamais `new Date()` ici.
 */
export async function renderCandidateAuditPdf(props: AuditPdfProps): Promise<Buffer> {
  return renderToBuffer(<AuditDocument {...props} />);
}
