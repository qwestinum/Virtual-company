import { describe, expect, it } from 'vitest';

import {
  etatDepuisStatutDistant,
  joursAvantRefus,
  joursDepuis,
  ligneApec,
  ligneGenerique,
  trierDiffusion,
  type LigneDiffusion,
} from '../rows';

const MAINTENANT = new Date('2026-09-21T12:00:00.000Z');
const ilYA = (jours: number) =>
  new Date(MAINTENANT.getTime() - jours * 24 * 60 * 60 * 1000).toISOString();

describe('âge d’une publication', () => {
  it('compte des jours ENTIERS', () => {
    expect(joursDepuis(ilYA(0), MAINTENANT)).toBe(0);
    expect(joursDepuis(ilYA(29.9), MAINTENANT)).toBe(29);
    expect(joursDepuis(ilYA(30), MAINTENANT)).toBe(30);
  });

  it('une date absente ou illisible ne rend pas un nombre au hasard', () => {
    expect(joursDepuis(null, MAINTENANT)).toBeNull();
    expect(joursDepuis('pas-une-date', MAINTENANT)).toBeNull();
  });

  it('les jours restants passent sous zéro, et on le dit', () => {
    // ⚠️ On ne borne PAS à zéro : « -4 » dit que la borne est franchie depuis
    // quatre jours, « 0 » laisserait croire qu'il reste la journée.
    expect(joursAvantRefus(ilYA(26), MAINTENANT)).toBe(4);
    expect(joursAvantRefus(ilYA(34), MAINTENANT)).toBe(-4);
  });
});

describe('état d’une publication distante', () => {
  it('suspendue reste suspendue, quel que soit son âge', () => {
    expect(etatDepuisStatutDistant('SUSPENDUE', ilYA(40), MAINTENANT)).toBe('suspendue');
  });

  it('publiée au-delà de la borne devient « à republier », jamais « expirée »', () => {
    // L'annonce est TOUJOURS en ligne chez le diffuseur. Ce qui change, c'est
    // que le geste de republication va être refusé.
    expect(etatDepuisStatutDistant('PUBLIEE', ilYA(31), MAINTENANT)).toBe('a_republier');
    expect(etatDepuisStatutDistant('PUBLIEE', ilYA(29), MAINTENANT)).toBe('publiee');
  });

  it('un statut inconnu ou absent ne se prend pas pour « publiée »', () => {
    for (const s of [null, 'EN_COURS_DE_VALIDATION', 'REFUSEE']) {
      expect(etatDepuisStatutDistant(s, ilYA(1), MAINTENANT)).toBe('brouillon');
    }
  });
});

describe('les deux sources donnent la même forme de ligne', () => {
  it('l’Apec porte la fraîcheur de son statut', () => {
    const l = ligneApec(
      {
        campaignId: 'CAMP-2026-001',
        channel: 'apec',
        remoteStatus: 'PUBLIEE',
        remoteStatusAt: ilYA(2),
        remoteUrl: 'https://apec.fr/offre/1',
        publishedAt: ilYA(10),
        suspendedAt: null,
      },
      MAINTENANT,
    );
    expect(l.canal).toBe('APEC');
    expect(l.etat).toBe('publiee');
    expect(l.joursAvantRefus).toBe(20);
    // ⚠️ La fraîcheur du statut est PORTÉE : un écran qui affiche l'état sans
    // dire quand il l'a lu ment sur ce qu'il sait.
    expect(l.statutLuLe).toBe(ilYA(2));
  });

  it('l’annonce générique n’a ni cache ni borne de 30 jours', () => {
    const l = ligneGenerique({
      campaignId: 'CAMP-2026-002',
      isVisible: true,
      publishedAt: ilYA(90),
      updatedAt: ilYA(1),
    });
    expect(l.etat).toBe('publiee');
    // Servie par ORQA : l'état est exact, il n'y a rien à dater.
    expect(l.statutLuLe).toBeNull();
    // La borne des 30 jours est une règle de l'Apec, pas une règle générale.
    expect(l.joursAvantRefus).toBeNull();
    expect(l.url).toBe('/jobs/CAMP-2026-002');
  });

  it('une annonce générique masquée ne donne pas de lien public', () => {
    const l = ligneGenerique({
      campaignId: 'CAMP-2026-003',
      isVisible: false,
      publishedAt: null,
      updatedAt: ilYA(1),
    });
    expect(l.etat).toBe('brouillon');
    expect(l.url).toBeNull();
  });
});

describe('ordre d’affichage', () => {
  const l = (cle: string, etat: LigneDiffusion['etat'], restant: number | null) =>
    ({
      cle,
      campaignId: cle,
      canal: 'APEC',
      etat,
      publieeLe: null,
      statutLuLe: null,
      joursAvantRefus: restant,
      url: null,
    }) satisfies LigneDiffusion;

  it('ce qui appelle un geste passe devant', () => {
    const ordre = trierDiffusion([
      l('d', 'brouillon', null),
      l('c', 'publiee', 25),
      l('b', 'suspendue', 10),
      l('a', 'a_republier', -3),
    ]).map((x) => x.cle);
    expect(ordre).toEqual(['a', 'b', 'c', 'd']);
  });

  it('à état égal, la plus proche de la borne d’abord', () => {
    // Une annonce à 2 jours de la borne doit se voir avant une publiée hier :
    // c'est elle qui va basculer.
    const ordre = trierDiffusion([
      l('recente', 'publiee', 29),
      l('bientot', 'publiee', 2),
    ]).map((x) => x.cle);
    expect(ordre).toEqual(['bientot', 'recente']);
  });

  it('sans borne, la ligne ne remonte pas en tête par accident', () => {
    // ⚠️ `null` doit compter comme « très loin », pas comme 0 — sinon une
    // annonce générique passerait devant une Apec à deux jours de la borne.
    const ordre = trierDiffusion([
      l('generique', 'publiee', null),
      l('apec', 'publiee', 2),
    ]).map((x) => x.cle);
    expect(ordre).toEqual(['apec', 'generique']);
  });
});
