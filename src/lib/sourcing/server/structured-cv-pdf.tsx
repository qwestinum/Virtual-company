/**
 * CV structuré en PDF — ce que la personne a confirmé sur la page, et rien
 * d'autre. SERVEUR UNIQUEMENT (`@react-pdf/renderer`).
 *
 * Le texte vient de `buildStructuredCvText` : le PDF et le texte analysé sont
 * la MÊME matière, ligne pour ligne. Aucun modèle n'écrit ce document.
 */

import { Document, Page, StyleSheet, Text, renderToBuffer } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { paddingVertical: 48, paddingHorizontal: 52, fontSize: 10.5, fontFamily: 'Helvetica', color: '#1c1917' },
  name: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  heading: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4, letterSpacing: 0.6 },
  mention: { fontSize: 9, color: '#78716c', marginTop: 6 },
  line: { marginBottom: 2, lineHeight: 1.4 },
});

const HEADINGS = new Set(['RÉSUMÉ', 'EXPÉRIENCE PROFESSIONNELLE', 'FORMATION']);

function StructuredCv({ text }: { text: string }) {
  const [name, ...rest] = text.split('\n');
  return (
    <Document title={`CV — ${name}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.name}>{name}</Text>
        {rest.map((line, i) =>
          line === '' ? null : HEADINGS.has(line) ? (
            <Text key={i} style={styles.heading}>{line}</Text>
          ) : line.startsWith('Profil confirmé par le candidat') ? (
            <Text key={i} style={styles.mention}>{line}</Text>
          ) : (
            <Text key={i} style={styles.line}>{line}</Text>
          ),
        )}
      </Page>
    </Document>
  );
}

export async function renderStructuredCvPdf(text: string): Promise<Buffer> {
  return renderToBuffer(<StructuredCv text={text} />);
}
