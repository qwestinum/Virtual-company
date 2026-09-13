/**
 * Écran de résultats — ajustements du 14/09/2026, vérifiés sur le HTML rendu :
 *   1. une ligne par profil, REPLIÉE par défaut, dépliable ;
 *   2. AUCUN coût dans le rendu recruteur (test négatif) ;
 *   3. « 50 de plus » APRÈS le dernier résultat ; en tête, le compteur seul.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/referent/ReferentMention', () => ({ ReferentMention: () => <span>Réf. Jane R.</span> }));

import { SourcingApproachPanel } from '@/components/sourcing/SourcingApproachPanel';
import { SourcingCampaignList } from '@/components/sourcing/SourcingCampaignList';
import { SourcingRowActions, SourcingRowMarks } from '@/components/sourcing/SourcingRowMarks';
import { SourcingProfileRow } from '@/components/sourcing/SourcingProfileRow';
import { SourcingQueryPanel } from '@/components/sourcing/SourcingQueryPanel';
import { SourcingResultsList } from '@/components/sourcing/SourcingResultsList';
import { INITIAL_EXPANSION, setSingle, toggleRow } from '@/lib/sourcing/expansion';
import type { ProfilesView } from '@/lib/sourcing/profiles-view';
import type { ExaSnapshot, SourcingProfileView } from '@/types/sourcing';

const snapshot = (i: number): ExaSnapshot => ({
  url: `https://www.linkedin.com/in/p${i}`,
  name: `Personne ${i}`,
  firstName: null,
  location: 'Paris, Île-de-France, France',
  headline: null,
  current: { title: `Business Analyst ${i}`, company: `Banque ${i}`, since: '2024-05-01' },
  workHistory: [
    { title: `Business Analyst ${i}`, company: `Banque ${i}`, location: 'Paris', from: '2024-05-01', to: null },
    { title: 'Consultante AMOA', company: 'Cabinet Y', location: 'Paris', from: '2019-09-01', to: '2024-04-01' },
  ],
  education: [{ degree: 'Master SI', institution: 'Université W', from: '2014', to: '2016' }],
  about: 'Parcours digitaux et UX.',
  skills: 'UML, SQL',
  languages: null,
  certifications: null,
  highlight: 'du cadrage à la recette',
  indexedAt: '2026-08-06T10:00:00Z',
});

const row = (i: number): SourcingProfileView => ({ id: `id-${i}`, searchId: 's1', exaRank: i, state: 'to_review', snapshot: snapshot(i), inZone: true });

const view = (reserveCount: number, exhausted = false): ProfilesView => ({
  groups: [
    {
      search: { id: 's1', query: 'Business Analyst confirmé, basé à Paris', language: 'fr', queryMethod: 'llm', createdAt: '2026-09-13T10:00:00Z', returned: 100, newAfterDedup: 100 },
      profiles: [row(1), row(2), row(3)],
    },
  ],
  reserveCount,
  exhausted,
  coverage: { zoneLabel: 'Paris (Île-de-France)', inZone: 3, total: 3, limited: false },
});

const renderList = (v: ProfilesView, expansion = INITIAL_EXPANSION) =>
  renderToStaticMarkup(
    <SourcingResultsList view={v} expansion={expansion} onToggle={() => {}} onSingleChange={() => {}} onMore={() => {}} promoting={false} />,
  );

const COST = /\$|€|\bUSD\b|coût|cout\b|tarif|factur/i;

describe('1. une ligne par profil, repliée par défaut', () => {
  it('repliée : intitulé — entreprise — localisation — ancienneté, sans le détail', () => {
    const html = renderToStaticMarkup(<SourcingProfileRow profile={row(1)} expanded={false} onToggle={() => {}} />);
    // Le nom EN TÊTE de ligne, mis en évidence (demande du 14/09).
    expect(html.indexOf('Personne 1')).toBeLessThan(html.indexOf('Business Analyst 1'));
    expect(html).toMatch(/font-bold[^>]*>Personne 1</);
    expect(html).toContain('Business Analyst 1 — Banque 1');
    expect(html).toContain('Paris, Île-de-France, France');
    expect(html).toContain('depuis');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Parcours');
    expect(html).not.toContain('Formation');
    expect(html).not.toContain('Consultante AMOA');
    expect(html).not.toContain('du cadrage à la recette');
  });

  it('dépliée : parcours daté, formation, extrait', () => {
    const html = renderToStaticMarkup(<SourcingProfileRow profile={row(1)} expanded onToggle={() => {}} />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Parcours');
    expect(html).toContain('09/2019 – 04/2024');
    expect(html).toContain('Master SI — Université W');
    expect(html).toContain('du cadrage à la recette');
  });

  it('la liste rend toutes les lignes repliées à l’ouverture', () => {
    const html = renderList(view(50));
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
    expect(html).not.toContain('aria-expanded="true"');
  });

  it('plusieurs lignes ouvertes, ou une seule à la fois — au choix', () => {
    let s = toggleRow(INITIAL_EXPANSION, 'a');
    s = toggleRow(s, 'b');
    expect([...s.open]).toEqual(['a', 'b']);
    s = setSingle(s, true);
    expect([...s.open]).toEqual(['b']);
    s = toggleRow(s, 'c');
    expect([...s.open]).toEqual(['c']);
    s = toggleRow(s, 'c');
    expect(s.open.size).toBe(0);
    expect(renderList(view(0), toggleRow(INITIAL_EXPANSION, 'id-2')).match(/aria-expanded="true"/g)).toHaveLength(1);
  });
});

describe('2. aucun coût dans le rendu recruteur', () => {
  it('liste de résultats', () => {
    expect(renderList(view(50))).not.toMatch(COST);
    expect(renderList(view(0, true))).not.toMatch(COST);
  });

  it('écran de requête', () => {
    expect(renderToStaticMarkup(<SourcingQueryPanel campaignId="CAMP-2026-293" onSearched={() => {}} />)).not.toMatch(COST);
  });

  it('liste des campagnes', () => {
    const html = renderToStaticMarkup(
      <SourcingCampaignList
        campaigns={[{ campaignId: 'CAMP-2026-293', name: 'BA', referent: null, seen: 150, approached: 7, manifested: 2, lastSearchAt: null }]}
        myApproachesThisMonth={12}
        onSource={() => {}}
      />,
    );
    expect(html).not.toMatch(COST);
  });
});

describe('3. « 50 de plus » en fin de liste', () => {
  it('le bouton vient après le dernier résultat ; en tête, le compteur', () => {
    const html = renderList(view(50));
    const lastRow = html.lastIndexOf('data-profile-row="id-3"');
    const button = html.indexOf('50 de plus');
    const counter = html.indexOf('3 profils affichés · 50 en réserve');
    expect(counter).toBeGreaterThan(-1);
    expect(counter).toBeLessThan(html.indexOf('data-profile-row="id-1"'));
    expect(button).toBeGreaterThan(lastRow);
    // Une seule occurrence : pas de second bouton en tête.
    expect(html.split('de plus').length - 1).toBe(1);
  });

  it('réserve vide : le message de fin prend la place du bouton, en fin de liste', () => {
    const html = renderList(view(0, true));
    expect(html).not.toContain('de plus');
    expect(html.indexOf('100 profils examinés — modifiez la requête')).toBeGreaterThan(html.lastIndexOf('data-profile-row="id-3"'));
  });
});

// ─── Lot 3 : repères et actions ──────────────────────────────────────────

describe('lot 3 — repères de ligne et actions', () => {
  const marked = (over: Partial<SourcingProfileView> = {}, snap: Partial<ExaSnapshot> = {}): SourcingProfileView => ({
    ...row(1),
    snapshot: { ...snapshot(1), ...snap },
    mentions: [
      { criterionId: 'a', label: 'Parcours digitaux et UX', terms: ['Parcours digitaux', 'UX'], found: ['UX'] },
      { criterionId: 'b', label: 'Secteur financier', terms: ['secteur financier'], found: [] },
    ],
    vivierCandidateId: 'v1',
    ...over,
  });

  it('badges et mentions : que des indices positifs, jamais un « non »', () => {
    const html = renderToStaticMarkup(<SourcingRowMarks profile={marked({}, { availability: { expression: 'disponible immédiatement', zone: 'about' } })} />);
    expect(html).toContain('En recherche');
    expect(html).toContain('Peut-être dans votre vivier');
    expect(html).toContain('✓ UX');
    expect(html).not.toMatch(/✗|\bnon\b|0\s*\/|secteur financier/i);
  });

  it('le détail dit « — » pour un terme absent et « pas de mention » pour un critère en phrase, sans verdict', () => {
    const p = marked();
    p.mentions!.push({ criterionId: 'c', label: 'Piloter le programme', terms: [], found: [] });
    const html = renderToStaticMarkup(<SourcingProfileRow profile={p} expanded onToggle={() => {}} />);
    expect(html).toContain('pas de mention (critère rédigé en phrase)');
    expect(html).toContain('Indice de lecture, pas une évaluation.');
    expect(html).not.toMatch(/non satisfait|insuffisant|score/i);
  });

  it('« Contacter par email » n’apparaît que si une adresse du titulaire a été retenue ; « Décliner » disparaît une fois contacté', () => {
    const noEmail = renderToStaticMarkup(<SourcingRowActions profile={marked({}, { contacts: { emails: [] } })} busy={false} onDecline={() => {}} onApproach={() => {}} />);
    expect(noEmail).not.toContain('Contacter par email');
    expect(noEmail).toContain('Décliner');
    const withEmail = renderToStaticMarkup(<SourcingRowActions profile={marked({ state: 'contacted' }, { contacts: { emails: ['c@x.fr'] } })} busy={false} onDecline={() => {}} onApproach={() => {}} />);
    expect(withEmail).toContain('Contacter par email');
    expect(withEmail).not.toContain('Décliner');
  });

  it('panneau : message prêt, compteur, un seul bouton qui ouvre ET copie, aucun coût', () => {
    const url = 'https://orqa.exemple.fr/s/AbCdEfGhIjKlMnOpQrStUv';
    const html = renderToStaticMarkup(
      <SourcingApproachPanel
        prepared={{ approachId: 'a1', channel: 'linkedin', format: 'connection_note', limit: 300, url, profileUrl: 'https://www.linkedin.com/in/p1', subject: null, message: `Bonjour Claire ${url}`, mailto: null, email: null }}
        onConfirm={async () => null}
        onCancel={() => {}}
        onFormatChange={() => {}}
      />,
    );
    expect(html).toContain('Ouvrir le profil et copier le message');
    expect(html).toContain(`${`Bonjour Claire ${url}`.length} / 300 caractères`);
    expect(html).not.toMatch(COST);
  });
});
