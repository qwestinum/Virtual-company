/**
 * Génération du PDF « rapport multi-campagnes » (cf. docs/specs/reporting.md
 * §4). SERVEUR UNIQUEMENT (`@react-pdf/renderer`). Charte ORQA partagée
 * (`pdf-theme.ts`) — cohérence totale avec l'audit candidat et le rapport de
 * campagne. `generatedAtIso` injecté par l'appelant (déterminisme).
 */

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';

import { formatFrDate, formatFrDateTime } from '@/lib/reporting/audit-display';
import {
  HITL_METRICS_RECALIBRATION_NOTICE,
  HITL_ZONES_RECALIBRATION,
} from '@/lib/reporting/campaign-report';
import { CAMPAIGN_ISSUE_LABELS } from '@/lib/reporting/campaign-report-display';
import { PDF_COLORS, pdfBaseStyles } from '@/lib/reporting/pdf-theme';
import type { MultiCampaignReportData } from '@/types/reporting';

const s = StyleSheet.create({
  coverBox: {
    marginTop: 10,
    padding: 12,
    backgroundColor: PDF_COLORS.panel,
    borderWidth: 1,
    borderColor: PDF_COLORS.hairline,
    borderRadius: 4,
  },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  metaItem: { width: '50%', marginBottom: 5 },
  metaLabel: { fontSize: 7.5, color: PDF_COLORS.muted, textTransform: 'uppercase' },
  metaValue: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  kpiRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  kpiCard: {
    flex: 1,
    padding: 8,
    backgroundColor: PDF_COLORS.panel,
    borderWidth: 1,
    borderColor: PDF_COLORS.hairline,
    borderRadius: 4,
  },
  kpiNum: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  kpiLabel: { fontSize: 7, color: PDF_COLORS.muted, textTransform: 'uppercase' },
  note: { fontSize: 6.5, color: PDF_COLORS.muted, marginTop: 1 },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.hairline,
    paddingVertical: 3,
  },
  th: { fontSize: 7, color: PDF_COLORS.muted, textTransform: 'uppercase' },
  cMain: { flex: 2.2 },
  c1: { flex: 1 },
  cNum: { flex: 1, textAlign: 'right' },
  bar: { height: 8, backgroundColor: PDF_COLORS.orange, borderRadius: 2 },
  barTrack: { flex: 1, height: 8, backgroundColor: PDF_COLORS.hairline, borderRadius: 2 },
  bullet: { flexDirection: 'row', marginBottom: 3 },
  bulletDot: { width: 12, color: PDF_COLORS.orange, fontFamily: 'Helvetica-Bold' },
  bulletText: { flex: 1 },
});

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metaItem}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue}>{value}</Text>
    </View>
  );
}

function Kpi({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <View style={s.kpiCard}>
      <Text style={s.kpiNum}>{value}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
      {note ? <Text style={s.note}>{note}</Text> : null}
    </View>
  );
}

function filtersLine(data: MultiCampaignReportData): string {
  const parts: string[] = [];
  if (data.filters.donneurLabel) parts.push(`Donneur : ${data.filters.donneurLabel}`);
  if (data.filters.siteLabel) parts.push(`Site : ${data.filters.siteLabel}`);
  if (data.filters.search) parts.push(`Recherche : « ${data.filters.search} »`);
  return parts.length > 0 ? parts.join(' · ') : 'Aucun';
}

function MultiCampaignDocument({
  data,
  generatedAtIso,
}: {
  data: MultiCampaignReportData;
  generatedAtIso: string;
}) {
  const { aggregateVolumes, rates, channels, scoring } = data;
  const period = `Du ${formatFrDate(data.period.from)} au ${formatFrDate(data.period.to)}`;
  const maxBucket = Math.max(1, ...scoring.distribution.map((b) => b.count));

  return (
    <Document title="Rapport multi-campagnes" author="ORQA" subject="Rapport multi-campagnes">
      <Page size="A4" style={pdfBaseStyles.page}>
        <View style={pdfBaseStyles.brandRow} fixed>
          <View>
            <Text style={pdfBaseStyles.brand}>ORQA</Text>
            <Text style={pdfBaseStyles.brandSub}>Rapport multi-campagnes</Text>
          </View>
          <Text style={pdfBaseStyles.genMention}>
            Rapport généré le {formatFrDateTime(generatedAtIso)}
          </Text>
        </View>

        {/* 1. Couverture */}
        <Text style={pdfBaseStyles.h1}>{period}</Text>
        <View style={s.coverBox}>
          <View style={s.metaGrid}>
            <MetaItem label="Campagnes incluses" value={String(data.campaignCount)} />
            <MetaItem label="Filtres appliqués" value={filtersLine(data)} />
            <MetaItem label="Candidatures" value={String(aggregateVolumes.received)} />
            <MetaItem
              label="Généré le"
              value={formatFrDateTime(generatedAtIso)}
            />
          </View>
        </View>

        {HITL_ZONES_RECALIBRATION ? (
          <View
            style={{
              marginTop: 8,
              padding: 8,
              borderRadius: 4,
              backgroundColor: '#fef3c7',
              borderWidth: 1,
              borderColor: '#f59e0b',
            }}
          >
            <Text style={{ fontSize: 7.5, color: '#92400e' }}>
              ⚠ {HITL_METRICS_RECALIBRATION_NOTICE}
            </Text>
          </View>
        ) : null}

        {/* 2. Vue d'ensemble agrégée */}
        <Text style={pdfBaseStyles.sectionTitle}>Vue d&apos;ensemble agrégée</Text>
        <View style={s.kpiRow}>
          <Kpi value={String(aggregateVolumes.received)} label="Reçues" />
          <Kpi value={String(aggregateVolumes.retained)} label="Retenus" />
          <Kpi value={String(aggregateVolumes.rejected)} label="Écartés" />
          <Kpi value={String(aggregateVolumes.arbitrated)} label="Arbitrés" />
        </View>
        <View style={[s.kpiRow, { marginTop: 6 }]}>
          <Kpi value={`${rates.retentionRate}%`} label="Taux de retenue" />
          <Kpi
            value={rates.avgTimeToHireDays !== null ? `${rates.avgTimeToHireDays} j` : '—'}
            label="Time-to-hire moyen"
            note="calculé sur les campagnes ayant abouti à un recrutement"
          />
          <Kpi value={`${Math.round(rates.arbitrationRate * 100)}%`} label="Arbitrage manuel" />
          <Kpi value={`${rates.responseRate}%`} label="Taux de réponse" />
        </View>

        {/* 3. Répartition par campagne */}
        <Text style={pdfBaseStyles.sectionTitle}>Répartition par campagne</Text>
        <View style={s.row}>
          <Text style={[s.th, s.cMain]}>Campagne</Text>
          <Text style={[s.th, s.c1]}>Site</Text>
          <Text style={[s.th, s.cNum]}>Durée</Text>
          <Text style={[s.th, s.cNum]}>Reçu</Text>
          <Text style={[s.th, s.cNum]}>Retenue</Text>
          <Text style={[s.th, s.cNum]}>TTH</Text>
        </View>
        {data.perCampaign.map((c) => (
          <View key={c.campaignId} style={s.row} wrap={false}>
            <View style={s.cMain}>
              <Text style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold' }}>
                {c.jobTitle}
              </Text>
              <Text style={{ fontSize: 7, color: PDF_COLORS.muted }}>
                {c.donneurLabel} · {CAMPAIGN_ISSUE_LABELS[c.issue]} ·{' '}
                {formatFrDate(c.closedAt)}
              </Text>
            </View>
            <Text style={[s.c1, { fontSize: 8 }]}>{c.siteLabel}</Text>
            <Text style={[s.cNum, { fontSize: 8 }]}>{c.durationDays} j</Text>
            <Text style={[s.cNum, { fontSize: 8 }]}>{c.received}</Text>
            <Text style={[s.cNum, { fontSize: 8 }]}>{c.retentionRate}%</Text>
            <Text style={[s.cNum, { fontSize: 8 }]}>
              {c.timeToHireDays !== null ? `${c.timeToHireDays} j` : '—'}
            </Text>
          </View>
        ))}

        {/* 4. Performance par canal */}
        <Text style={pdfBaseStyles.sectionTitle}>
          Performance par canal de diffusion
        </Text>
        <View style={s.row}>
          <Text style={[s.th, s.cMain]}>Canal</Text>
          <Text style={[s.th, s.cNum]}>Volume</Text>
          <Text style={[s.th, s.cNum]}>Taux retenue</Text>
          <Text style={[s.th, s.cNum]}>Recrutés</Text>
        </View>
        {channels.length === 0 ? (
          <Text style={[pdfBaseStyles.paragraph, { color: PDF_COLORS.muted }]}>
            Aucun canal exploitable.
          </Text>
        ) : (
          channels.map((c, i) => (
            <View key={i} style={s.row}>
              <Text style={s.cMain}>{c.channelLabel}</Text>
              <Text style={s.cNum}>{c.volume}</Text>
              <Text style={s.cNum}>{c.retentionRate}%</Text>
              <Text style={s.cNum}>{c.recruited}</Text>
            </View>
          ))
        )}
        {data.topChannelLabels.length > 0 ? (
          <Text style={[pdfBaseStyles.paragraph, { marginTop: 4 }]}>
            Canal le plus performant : {data.topChannelLabels.join(', ')}.
          </Text>
        ) : null}
        {data.underperformingChannelLabels.length > 0 ? (
          <Text style={[pdfBaseStyles.paragraph, { color: PDF_COLORS.muted }]}>
            Canaux sans retenu : {data.underperformingChannelLabels.join(', ')}.
          </Text>
        ) : null}

        {/* 5. Analyse du scoring */}
        <Text style={pdfBaseStyles.sectionTitle}>Analyse du scoring</Text>
        {scoring.distribution.map((b, i) => (
          <View
            key={i}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}
          >
            <Text style={{ width: 44, fontSize: 8 }}>{b.label}</Text>
            <View style={s.barTrack}>
              <View style={[s.bar, { width: `${(b.count / maxBucket) * 100}%` }]} />
            </View>
            <Text style={{ width: 18, fontSize: 8, textAlign: 'right' }}>{b.count}</Text>
          </View>
        ))}
        <Text style={[pdfBaseStyles.paragraph, { marginTop: 4 }]}>
          Score moyen : {scoring.average ?? '—'} · écart-type :{' '}
          {scoring.stdDev ?? '—'} · taux d&apos;arbitrage manuel :{' '}
          {Math.round(scoring.arbitrationRate * 100)}%
        </Text>

        {/* 6. Recommandations transverses */}
        <Text style={pdfBaseStyles.sectionTitle}>
          Enseignements et recommandations transverses
        </Text>
        {data.recommendations.map((r, i) => (
          <View key={i} style={s.bullet}>
            <Text style={s.bulletDot}>•</Text>
            <Text style={s.bulletText}>{r}</Text>
          </View>
        ))}

        {/* 7. Conformité et traçabilité */}
        <Text style={pdfBaseStyles.sectionTitle}>Conformité et traçabilité</Text>
        <Text style={pdfBaseStyles.paragraph}>
          {data.rgpd.totalCandidates} candidats dans le périmètre. Conservation :{' '}
          {data.rgpd.retentionMonths} mois à compter de la clôture de chaque
          campagne. Le détail des actions (réception, scoring, arbitrage,
          communications) est tracé dans le journal d&apos;audit ORQA, disponible
          à la demande (usage interne / DPO).
        </Text>

        {/* Pied de page */}
        <View style={pdfBaseStyles.footer} fixed>
          <Text>
            ORQA — Rapport multi-campagnes généré le {formatFrDate(generatedAtIso)}{' '}
            — Document confidentiel
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderMultiCampaignReportPdf(props: {
  data: MultiCampaignReportData;
  generatedAtIso: string;
}): Promise<Buffer> {
  return renderToBuffer(<MultiCampaignDocument {...props} />);
}
