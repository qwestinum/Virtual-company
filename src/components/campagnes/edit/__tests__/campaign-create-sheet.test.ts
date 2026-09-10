import { describe, expect, it } from 'vitest';

import {
  deriveCampaignName,
  nextOpenSection,
} from '@/components/campagnes/edit/CampaignCreateSheet';
import { buildSchedulingPatch } from '@/lib/campaign/apply-draft-scheduling';
import {
  hasChannelContent,
  listPostActivationSurfaces,
} from '@/lib/campaign/post-activation-surfaces';
import {
  resolveDraftOwner,
  type RecruiterOption,
} from '@/lib/campaign/use-recruiter-options';
import { buildEmptyFDP, type FDPInProgress } from '@/types/field-collection';

/** FDP avec un job_title donné (vide = champ effacé). */
function fdpWithTitle(title: string): FDPInProgress {
  const fdp = buildEmptyFDP('CAMP-1');
  fdp.fields.job_title = {
    ...fdp.fields.job_title!,
    value: title,
    status: title ? 'filled' : 'empty',
  };
  return fdp;
}

describe('nextOpenSection — flux « Enregistrer → section suivante »', () => {
  it('ouvre la section juste après celle enregistrée', () => {
    expect(nextOpenSection(['fdp'], 'fdp')).toBe('scoring');
    expect(nextOpenSection(['fdp', 'scoring'], 'scoring')).toBe('channels');
  });

  it('saute les sections déjà enregistrées', () => {
    // scoring déjà enregistré : après fdp on passe directement à channels.
    expect(nextOpenSection(['fdp', 'scoring'], 'fdp')).toBe('channels');
    // tout l'aval déjà enregistré sauf threshold.
    expect(nextOpenSection(['fdp', 'scoring', 'channels', 'flux'], 'fdp')).toBe(
      'threshold',
    );
  });

  it('renvoie null après la dernière section (on replie tout)', () => {
    expect(nextOpenSection(['scheduling'], 'scheduling')).toBeNull();
    // enregistrer l'avant-dernière ouvre la dernière.
    expect(nextOpenSection(['owner'], 'owner')).toBe('scheduling');
  });

  it('enchaîne les sections ajoutées après les seuils (référent, réservation)', () => {
    // Le régime de réservation s'appuie sur les disponibilités du référent :
    // il vient donc APRÈS lui, jamais l'inverse.
    expect(
      nextOpenSection(['fdp', 'scoring', 'channels', 'flux', 'threshold'], 'threshold'),
    ).toBe('owner');
  });

  it('null quand toutes les sections suivantes sont déjà enregistrées', () => {
    expect(
      nextOpenSection(
        [
          'scoring',
          'channels',
          'flux',
          'threshold',
          'owner',
          'scheduling',
          'fdp',
        ],
        'fdp',
      ),
    ).toBeNull();
  });
});

describe('deriveCampaignName — le nom suit le job_title édité', () => {
  it("l'intitulé ÉDITÉ en étape 2 prime sur celui de l'étape 1", () => {
    // Le bug : l'étape 1 était prioritaire et écrasait la modification.
    expect(deriveCampaignName(fdpWithTitle('Comptable senior'), 'Comptable')).toBe(
      'Comptable senior',
    );
  });

  it("repli sur l'intitulé d'étape 1 si le champ FDP est vidé", () => {
    expect(deriveCampaignName(fdpWithTitle(''), 'Comptable')).toBe('Comptable');
  });

  it('défaut quand tout est vide', () => {
    expect(deriveCampaignName(fdpWithTitle(''), '   ')).toBe('Nouvelle campagne');
  });

  it('trim de la valeur éditée', () => {
    expect(deriveCampaignName(fdpWithTitle('  Data Engineer  '), 'X')).toBe(
      'Data Engineer',
    );
  });
});


describe('resolveDraftOwner — le défaut est le créateur, et il est dérivé', () => {
  const me = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const option = (id: string): RecruiterOption => ({
    id,
    displayName: id.slice(0, 4),
    hasCalcomLink: true,
    hasAvailability: true,
  });

  it('propose le créateur quand il est un recruteur actif', () => {
    expect(resolveDraftOwner(undefined, [option(me), option(other)], me)).toBe(me);
  });

  it("ne propose PAS un créateur absent du référentiel (inactif, non enregistré)", () => {
    // Un référent inactif porterait un agenda dont aucun candidat ne peut rien
    // faire — mieux vaut « aucun référent », qui est vrai et visible.
    expect(resolveDraftOwner(undefined, [option(other)], me)).toBeNull();
  });

  it('ne devine rien tant que la liste n’est pas arrivée', () => {
    expect(resolveDraftOwner(undefined, null, me)).toBeNull();
  });

  it('un choix explicite prime — « aucun référent » compris', () => {
    expect(resolveDraftOwner(null, [option(me)], me)).toBeNull();
    expect(resolveDraftOwner(other, [option(me), option(other)], me)).toBe(other);
  });
});

describe('buildSchedulingPatch — le flag ne voyage que par le PATCH ciblé', () => {
  it('rien à appliquer en régime Cal.com (le défaut en base)', () => {
    expect(buildSchedulingPatch({ native: false, location: null })).toBeNull();
  });

  it('DÉFAIT le natif quand une tentative précédente l’avait déjà écrit', () => {
    // « Compléter la campagne » ramène au formulaire : décocher puis re-créer
    // doit défaire, sinon l'écran annonce Cal.com et la base reste en natif.
    expect(
      buildSchedulingPatch({ native: false, location: null }, true),
    ).toEqual({ schedulingNative: false });
  });

  it('un lieu ne part JAMAIS sans le régime natif (le serveur répond 409)', () => {
    expect(
      buildSchedulingPatch({
        native: false,
        location: { type: 'phone', payload: { instructions: 'On vous appelle.' } },
      }),
    ).toBeNull();
  });

  it('bascule seule quand le lieu est hérité du référent', () => {
    expect(buildSchedulingPatch({ native: true, location: null })).toEqual({
      schedulingNative: true,
    });
  });

  it('bascule et lieu dans le MÊME patch (l’ordre côté serveur le permet)', () => {
    const location = {
      type: 'in_person' as const,
      payload: { address: '12 rue de la Paix, 75002 Paris' },
    };
    expect(buildSchedulingPatch({ native: true, location })).toEqual({
      schedulingNative: true,
      meetingLocationOverride: location,
    });
  });
});

describe('hasChannelContent — seuls les canaux qui PUBLIENT un texte', () => {
  it('annonce générique et APEC portent un contenu', () => {
    expect(hasChannelContent('generic')).toBe(true);
    expect(hasChannelContent('apec')).toBe(true);
  });

  it('les autres canaux ne sont qu’une intention de diffusion', () => {
    expect(hasChannelContent('linkedin')).toBe(false);
    expect(hasChannelContent('indeed')).toBe(false);
    expect(hasChannelContent('france_travail')).toBe(false);
    expect(hasChannelContent('welcome_to_the_jungle')).toBe(false);
  });
});


describe('listPostActivationSurfaces — ce qui n’ouvre qu’après l’activation', () => {
  it('rien à attendre quand aucun canal ne publie et que le vivier est absent', () => {
    expect(listPostActivationSurfaces(['linkedin', 'indeed'], ['email']).any).toBe(
      false,
    );
  });

  it('les annonces publiables sortent dans l’ordre canonique, pas celui du clic', () => {
    // Deux campagnes aux mêmes canaux doivent montrer le même écran.
    expect(
      listPostActivationSurfaces(['apec', 'linkedin', 'generic'], []).contentChannels,
    ).toEqual(['generic', 'apec']);
  });

  it('le flux vivier ouvre la présélection — à lui seul', () => {
    const surfaces = listPostActivationSurfaces(['linkedin'], ['vivier']);
    expect(surfaces).toEqual({ contentChannels: [], vivier: true, any: true });
  });

  it('un canal sans contenu n’ouvre rien, même actif', () => {
    expect(
      listPostActivationSurfaces(['france_travail'], ['manual']),
    ).toEqual({ contentChannels: [], vivier: false, any: false });
  });
});
