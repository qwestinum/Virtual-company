import { describe, expect, it } from 'vitest';

import { resolveCampaignFocus } from '@/lib/navigation/campaign-focus';

const IDS = Array.from({ length: 13 }, (_, i) => `CAMP-2026-${100 + i}`);

describe('resolveCampaignFocus — « retour à la campagne »', () => {
  it('aucune cible : rien ne bouge (comportement d’origine)', () => {
    expect(resolveCampaignFocus(IDS, null, 5)).toEqual({
      showAllStatuses: false,
      page: 0,
      expandedId: null,
    });
  });

  it('saute à la page qui contient la campagne', () => {
    expect(resolveCampaignFocus(IDS, 'CAMP-2026-100', 5).page).toBe(0);
    expect(resolveCampaignFocus(IDS, 'CAMP-2026-104', 5).page).toBe(0);
    expect(resolveCampaignFocus(IDS, 'CAMP-2026-105', 5).page).toBe(1);
    expect(resolveCampaignFocus(IDS, 'CAMP-2026-112', 5).page).toBe(2);
  });

  it('élargit le filtre de statut — sinon la promesse tient une fois sur deux', () => {
    // Le filtre par défaut est « Actives ». Une campagne suspendue ou clôturée
    // n'y figure pas : sans cet élargissement, le lien déposerait sur la liste
    // et la campagne resterait invisible, SANS un mot.
    expect(resolveCampaignFocus(IDS, 'CAMP-2026-107', 5).showAllStatuses).toBe(true);
  });

  it('cible inconnue : on n’élargit rien et on ne déplie rien', () => {
    // Lien vieilli, campagne supprimée, ou liste pas encore chargée. Ouvrir
    // « Toutes » sur une cible absente changerait l'écran sans rien montrer.
    expect(resolveCampaignFocus(IDS, 'CAMP-1999-001', 5)).toEqual({
      showAllStatuses: false,
      page: 0,
      expandedId: null,
    });
    expect(resolveCampaignFocus([], 'CAMP-2026-100', 5).expandedId).toBeNull();
  });

  it('la campagne visée est bien celle qu’on déplie', () => {
    expect(resolveCampaignFocus(IDS, 'CAMP-2026-108', 5).expandedId).toBe(
      'CAMP-2026-108',
    );
  });
});
