import { describe, expect, it } from 'vitest';

import { normalizeTranscript, renderTurns } from '@/lib/transcript/normalize';

describe('WebVTT (Teams : balises <v>, identifiants de repère)', () => {
  const vtt = [
    'WEBVTT',
    'Kind: captions',
    '',
    '3f2a-1',
    '00:00:03.120 --> 00:00:06.000',
    '<v Sami Benali>Bonjour, merci d’être là.</v>',
    '',
    '3f2a-2',
    '00:00:06.500 --> 00:00:09.000',
    '<v Jean Dupont>Bonjour, avec plaisir.</v>',
    '',
    '3f2a-3',
    '00:00:09.100 --> 00:00:12.000',
    '<v Jean Dupont>J’ai piloté la recette de bout en bout.</v>',
  ].join('\n');

  it('locuteurs, horodatages, tours fusionnés', () => {
    const t = normalizeTranscript(vtt);
    expect(t.speakers).toEqual(['Sami Benali', 'Jean Dupont']);
    expect(t.turns).toEqual([
      { speaker: 'Sami Benali', at: '00:00:03', text: 'Bonjour, merci d’être là.' },
      { speaker: 'Jean Dupont', at: '00:00:06', text: 'Bonjour, avec plaisir. J’ai piloté la recette de bout en bout.' },
    ]);
  });

  it('rien de l’en-tête, des identifiants ni des minutages dans le texte', () => {
    const { plainText } = normalizeTranscript(vtt);
    expect(plainText).not.toMatch(/WEBVTT|Kind:|3f2a|-->/u);
  });
});

describe('SubRip (Zoom : « Nom : texte » dans le repère)', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:04,000',
    'Sami Benali: Parlez-moi de votre dernier poste.',
    '',
    '2',
    '00:00:04,500 --> 00:00:09,000',
    'Jean Dupont: J’étais consultant AMOA.',
    '',
    '3',
    '00:00:09,500 --> 00:00:12,000',
    'Sami Benali: Et la recette ?',
  ].join('\n');

  it('numéros de repère retirés, étiquettes reconnues', () => {
    const t = normalizeTranscript(srt);
    expect(t.speakers).toEqual(['Sami Benali', 'Jean Dupont']);
    expect(t.turns.map((x) => x.at)).toEqual(['00:00:01', '00:00:04', '00:00:09']);
    expect(t.plainText).toBe('Parlez-moi de votre dernier poste. J’étais consultant AMOA. Et la recette ?');
  });
});

describe('texte (Otter / Teams .docx : en-tête « Nom  0:03 »)', () => {
  const otter = [
    'Sami Benali  0:03',
    'Parlez-moi de vous.',
    '',
    'Jean Dupont  0:10',
    'Consultant depuis six ans,',
    'surtout en banque.',
  ].join('\n');

  it('en-têtes reconnus, lignes de texte rattachées', () => {
    const t = normalizeTranscript(otter);
    expect(t.turns).toEqual([
      { speaker: 'Sami Benali', at: '00:00:03', text: 'Parlez-moi de vous.' },
      { speaker: 'Jean Dupont', at: '00:00:10', text: 'Consultant depuis six ans, surtout en banque.' },
    ]);
  });
});

describe('texte (tl;dv : « [00:03] Nom : texte »)', () => {
  it('horodatage et locuteur sur la même ligne', () => {
    const t = normalizeTranscript('[00:03] Sami : Bonjour\n[00:07] Jean : Bonjour à vous');
    expect(t.turns).toEqual([
      { speaker: 'Sami', at: '00:00:03', text: 'Bonjour' },
      { speaker: 'Jean', at: '00:00:07', text: 'Bonjour à vous' },
    ]);
  });
});

describe('texte brut sans locuteurs', () => {
  it('aucune attribution inventée', () => {
    const t = normalizeTranscript('Nous avons parlé du poste.\nLe candidat connaît la recette.');
    expect(t.speakers).toEqual([]);
    expect(t.turns).toEqual([
      { speaker: null, at: null, text: 'Nous avons parlé du poste. Le candidat connaît la recette.' },
    ]);
  });

  it('« Remarque : … » isolé n’est PAS un locuteur (l’étiquette doit revenir)', () => {
    const t = normalizeTranscript('Remarque : il préfère le télétravail.\nSuite de l’échange.');
    expect(t.speakers).toEqual([]);
  });
});

describe('renderTurns', () => {
  it('une ligne par tour, étiquetée quand on le peut', () => {
    expect(
      renderTurns([
        { speaker: 'Jean', at: '00:00:07', text: 'Bonjour' },
        { speaker: null, at: null, text: 'Suite' },
      ]),
    ).toBe('[00:00:07] Jean : Bonjour\nSuite');
  });
});
