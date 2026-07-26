/**
 * Génère les 3 CV PDF fixtures de la suite de régression (commités).
 * PDF 1.4 minimal (Helvetica, ASCII uniquement — pas d'accents : encodage
 * WinAnsi non déclaré), un texte par ligne. Les MARQUEURS PROFIL_*_TREG
 * pilotent le routage des fixtures LLM ; les emails @test.local ancrent la
 * résolution déterministe d'email et le clean.
 *
 * Usage : npx tsx tests/regression/fixtures/generate-cv-pdfs.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function escapePdfText(line: string): string {
  return line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdf(lines: string[]): Buffer {
  const content = [
    'BT',
    '/F1 12 Tf',
    '50 780 Td',
    '16 TL',
    ...lines.map((l, i) => `${i === 0 ? '' : 'T* '}(${escapePdfText(l)}) Tj`),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const CVS: Record<string, string[]> = {
  fort: [
    'Victor Fort - Testeur Logiciel TREG',
    'Email : fort@test.local - Telephone : 0600000001',
    'PROFIL_FORT_TREG',
    'Diplome : Master Informatique (obtenu)',
    'Experience : 8 ans - Testeur Logiciel TREG chez Qwestinum Labs',
    'Competences : TREGSKILL, SQL, automatisation des tests, Agile',
    'Anglais professionnel courant.',
  ],
  faible: [
    'Fabien Faible - Comptable TREG',
    'Email : faible@test.local - Telephone : 0600000002',
    'PROFIL_FAIBLE_TREG',
    'Diplome : aucun diplome informatique',
    'Experience : 3 ans - comptabilite generale',
    'Competences : saisie comptable',
  ],
  moyen: [
    'Marc Moyen - Analyste TREG',
    'Email : moyen@test.local - Telephone : 0600000003',
    'PROFIL_MOYEN_TREG',
    'Diplome : Master Informatique (obtenu)',
    'Experience : 4 ans - analyse fonctionnelle et tests',
    'Competences : recette fonctionnelle, un peu de SQL',
  ],
};

for (const [profile, lines] of Object.entries(CVS)) {
  const path = resolve(__dirname, `cv-${profile}.pdf`);
  writeFileSync(path, buildPdf(lines));
  console.log(`OK ${path}`);
}
