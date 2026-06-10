/**
 * Charte visuelle ORQA partagée entre les templates PDF du module Reporting
 * (audit candidat, rapport de campagne…). Source unique des couleurs et des
 * styles structurels (bandeau, titres de section, pied de page) pour que tous
 * les rapports parlent le même langage visuel.
 *
 * SERVEUR UNIQUEMENT — dépend de `@react-pdf/renderer` (StyleSheet). Ne jamais
 * importer depuis un composant client.
 */

import { StyleSheet } from '@react-pdf/renderer';

export const PDF_COLORS = {
  orange: '#FF8A00', // ORQA
  ink: '#1c1917', // stone-900
  muted: '#78716c', // stone-500
  hairline: '#e7e5e4', // stone-200
  panel: '#fafaf9', // stone-50
  positive: '#15803d', // green-700
  negative: '#b91c1c', // red-700
  pending: '#b45309', // amber-700
} as const;

/** Styles structurels communs (bandeau de marque, titres, pied de page). */
export const pdfBaseStyles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 44,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: PDF_COLORS.ink,
    lineHeight: 1.4,
  },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 2,
    borderBottomColor: PDF_COLORS.orange,
    paddingBottom: 8,
    marginBottom: 14,
  },
  brand: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: PDF_COLORS.orange },
  brandSub: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: PDF_COLORS.ink },
  genMention: { fontSize: 8, color: PDF_COLORS.muted },
  h1: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: PDF_COLORS.orange,
    marginTop: 16,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  paragraph: { marginTop: 2 },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.hairline,
    paddingTop: 6,
    fontSize: 7,
    color: PDF_COLORS.muted,
  },
});
