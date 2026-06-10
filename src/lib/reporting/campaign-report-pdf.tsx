/**
 * Génération du PDF « rapport de campagne » (cf. docs/specs/reporting.md §3).
 *
 * SERVEUR UNIQUEMENT — `@react-pdf/renderer` (`renderToBuffer`). Charte ORQA
 * partagée (`pdf-theme.ts`) pour rester cohérent avec l'audit candidat.
 * `generatedAtIso` injecté par l'appelant (déterminisme / testabilité).
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
  CAMPAIGN_ISSUE_LABELS,
  donneurOrdreLabel,
} from '@/lib/reporting/campaign-report-display';
import { PDF_COLORS, pdfBaseStyles } from '@/lib/reporting/pdf-theme';
import type { CampaignReportData } from '@/types/reporting';

const s = StyleSheet.create({
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  metaItem: { width: '50%', marginBottom: 5 },
  metaLabel: { fontSize: 7.5, color: PDF_COLORS.muted, textTransform: 'uppercase' },
  metaValue: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  coverBox: {
    marginTop: 10,
    padding: 12,
    backgroundColor: PDF_COLORS.panel,
    borderWidth: 1,
    borderColor: PDF_COLORS.hairline,
    borderRadius: 4,
  },
  warnBox: {
    marginTop: 10,
    padding: 8,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 4,
  },
  warnText: { fontSize: 8.5, color: PDF_COLORS.pending, fontFamily: 'Helvetica-Bold' },
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
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.hairline,
    paddingVertical: 3,
  },
  th: { fontSize: 7.5, color: PDF_COLORS.muted, textTransform: 'uppercase' },
  cellL: { flex: 2 },
  cell: { flex: 1, textAlign: 'right' },
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

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.kpiCard}>
      <Text style={s.kpiNum}>{value}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
    </View>
  );
}

function CampaignReportDocument({
  data,
  generatedAtIso,
}: {
  data: CampaignReportData;
  generatedAtIso: string;
}) {
  const { summary, performance, channels, scoring, rgpd } = data;
  const period = `${formatFrDate(summary.launchedAt)} → ${formatFrDate(summary.closedAt)}`;
  const maxBucket = Math.max(1, ...scoring.distribution.map((b) => b.count));

  return (
    <Document
      title={`Rapport de campagne — ${summary.jobTitle}`}
      author="ORQA"
      subject="Rapport de campagne"
    >
      <Page size="A4" style={pdfBaseStyles.page}>
        <View style={pdfBaseStyles.brandRow} fixed>
          <View>
            <Text style={pdfBaseStyles.brand}>ORQA</Text>
            <Text style={pdfBaseStyles.brandSub}>Rapport de campagne</Text>
          </View>
          <Text style={pdfBaseStyles.genMention}>
            Rapport généré le {formatFrDateTime(generatedAtIso)}
          </Text>
        </View>

        {/* 1. Couverture */}
        <Text style={pdfBaseStyles.h1}>{summary.campaignName}</Text>
        <Text style={pdfBaseStyles.genMention}>
          Poste : {summary.jobTitle} · {summary.campaignId}
        </Text>
        <View style={s.coverBox}>
          <View style={s.metaGrid}>
            <MetaItem label="Période" value={period} />
            <MetaItem label="Durée" value={`${summary.durationDays} jours`} />
            <MetaItem label="Donneur d'ordre" value={donneurOrdreLabel(summary)} />
            <MetaItem label="Site" value={summary.siteLabel ?? '—'} />
            <MetaItem label="Issue" value={CAMPAIGN_ISSUE_LABELS[summary.issue]} />
            <MetaItem
              label="Recrutements"
              value={String(summary.recruitedCount)}
            />
          </View>
        </View>
        {data.lowVolume ? (
          <View style={s.warnBox}>
            <Text style={s.warnText}>
              Note : moins de {summary.volumes.received < 1 ? 'une' : '5'}{' '}
              candidature{summary.volumes.received > 1 ? 's' : ''} traitée
              {summary.volumes.received > 1 ? 's' : ''} — statistiques peu
              significatives.
            </Text>
          </View>
        ) : null}

        {/* 2. Synthèse du déroulé */}
        <Text style={pdfBaseStyles.sectionTitle}>Synthèse du déroulé</Text>
        <View style={s.kpiRow}>
          <Kpi value={String(summary.volumes.received)} label="Reçues" />
          <Kpi value={String(summary.volumes.retained)} label="Retenues" />
          <Kpi value={String(summary.volumes.rejected)} label="Écartées" />
          <Kpi value={String(summary.volumes.arbitrated)} label="Arbitrées" />
        </View>
        <Text style={[pdfBaseStyles.paragraph, { marginTop: 8 }]}>
          {summary.issue === 'recruited'
            ? `${summary.recruitedCount} recrutement(s) finalisé(s).`
            : 'Campagne clôturée sans recrutement finalisé.'}
        </Text>

        {/* 3. Performance globale */}
        <Text style={pdfBaseStyles.sectionTitle}>Performance globale</Text>
        <View style={s.kpiRow}>
          <Kpi value={`${performance.retentionRate}%`} label="Taux de retenue" />
          <Kpi
            value={
              performance.timeToHireDays !== null
                ? `${performance.timeToHireDays} j`
                : '—'
            }
            label="Time-to-hire"
          />
          <Kpi
            value={`${Math.round(performance.arbitrationRate * 100)}%`}
            label="Arbitrage manuel"
          />
          <Kpi value={`${performance.responseRate}%`} label="Taux de réponse" />
        </View>

        {/* 4. Performance par canal */}
        <Text style={pdfBaseStyles.sectionTitle}>
          Performance par canal de réception
        </Text>
        <View style={s.row}>
          <Text style={[s.th, s.cellL]}>Canal</Text>
          <Text style={[s.th, s.cell]}>Volume</Text>
          <Text style={[s.th, s.cell]}>Taux retenue</Text>
          <Text style={[s.th, s.cell]}>Recrutés</Text>
        </View>
        {channels.length === 0 ? (
          <Text style={[pdfBaseStyles.paragraph, { color: PDF_COLORS.muted }]}>
            Aucun canal exploitable.
          </Text>
        ) : (
          channels.map((c, i) => (
            <View key={i} style={s.row}>
              <Text style={s.cellL}>{c.channelLabel}</Text>
              <Text style={s.cell}>{c.volume}</Text>
              <Text style={s.cell}>{c.retentionRate}%</Text>
              <Text style={s.cell}>{c.recruited}</Text>
            </View>
          ))
        )}
        {data.topChannelLabels.length > 0 ? (
          <Text style={[pdfBaseStyles.paragraph, { marginTop: 4 }]}>
            Canal le plus performant : {data.topChannelLabels.join(', ')}.
          </Text>
        ) : null}

        {/* 5. Synthèse du scoring */}
        <Text style={pdfBaseStyles.sectionTitle}>Synthèse du scoring</Text>
        {scoring.distribution.map((b, i) => (
          <View
            key={i}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}
          >
            <Text style={{ width: 44, fontSize: 8 }}>{b.label}</Text>
            <View style={s.barTrack}>
              <View style={[s.bar, { width: `${(b.count / maxBucket) * 100}%` }]} />
            </View>
            <Text style={{ width: 18, fontSize: 8, textAlign: 'right' }}>
              {b.count}
            </Text>
          </View>
        ))}
        <Text style={[pdfBaseStyles.paragraph, { marginTop: 4 }]}>
          Score moyen : {scoring.average ?? '—'} · écart-type :{' '}
          {scoring.stdDev ?? '—'} · taux de cas arbitrés :{' '}
          {Math.round(scoring.arbitrationRate * 100)}%
        </Text>

        {/* 6. Enseignements & recommandations */}
        <Text style={pdfBaseStyles.sectionTitle}>
          Enseignements et recommandations
        </Text>
        {data.recommendations.map((r, i) => (
          <View key={i} style={s.bullet}>
            <Text style={s.bulletDot}>•</Text>
            <Text style={s.bulletText}>{r}</Text>
          </View>
        ))}

        {/* 7. Conformité RGPD */}
        <Text style={pdfBaseStyles.sectionTitle}>Conformité RGPD</Text>
        <Text style={pdfBaseStyles.paragraph}>
          Durée de conservation : {rgpd.retentionMonths} mois à compter de la
          clôture. Suppression planifiée le {formatFrDate(rgpd.plannedDeletionAt)}.
          Chaque action (réception, scoring, arbitrage, communication, envoi de
          rapport) est tracée dans le journal d&apos;audit ORQA, consultable sur
          demande (audit logs — usage interne / DPO).
        </Text>

        {/* 8. Pied de page */}
        <View style={pdfBaseStyles.footer} fixed>
          <Text>
            ORQA — Rapport généré le {formatFrDate(generatedAtIso)} — Document
            confidentiel
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

/** Rend le PDF du rapport de campagne en Buffer. */
export async function renderCampaignReportPdf(props: {
  data: CampaignReportData;
  generatedAtIso: string;
}): Promise<Buffer> {
  return renderToBuffer(<CampaignReportDocument {...props} />);
}
