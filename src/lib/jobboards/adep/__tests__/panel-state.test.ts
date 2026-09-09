/**
 * Les décisions d'affichage du panneau APEC.
 *
 * Elles sont pures exprès : la règle des 30 jours et la phase « on ne sait
 * pas » se vérifient ici, sans rendu ni navigateur.
 */
import { describe, expect, it } from 'vitest';

import {
  ADEP_IMMUTABLE_NOTICE,
  adepPhase,
  canRepublish,
  republishDaysLeft,
  republishNotice,
  type PostingLike,
  canSuspend,
  suspendUnavailableNotice,
} from '../panel-state';

const NOW = new Date('2026-09-08T10:00:00Z');

function posting(patch: Partial<PostingLike> = {}): PostingLike {
  return {
    attemptState: 'acknowledged',
    remoteStatus: 'PUBLIEE',
    publishedAt: '2026-09-01T09:00:00Z',
    apecPositionNumero: '177596708W',
    ...patch,
  };
}

describe('phase', () => {
  it('aucune publication', () => {
    expect(adepPhase(null)).toBe('none');
  });

  it('suit le statut rendu par l’Apec', () => {
    expect(adepPhase(posting({ remoteStatus: 'PUBLIEE' }))).toBe('published');
    expect(adepPhase(posting({ remoteStatus: 'SUSPENDUE' }))).toBe('suspended');
    expect(adepPhase(posting({ remoteStatus: 'FERMEE' }))).toBe('closed');
    expect(adepPhase(posting({ remoteStatus: 'AVALIDER' }))).toBe('awaiting_validation');
  });

  it('« sent » sans acquittement est une INCERTITUDE, pas un échec', () => {
    // C'est la phase où l'on ne propose ni publier ni republier : on ne sait
    // pas si l'offre existe, et le geste sûr est d'aller vérifier chez l'Apec.
    expect(adepPhase(posting({ attemptState: 'sent', remoteStatus: null }))).toBe(
      'uncertain',
    );
  });

  it('l’incertitude PRIME sur le statut connu', () => {
    // Un statut mis en cache avant l'incident ne doit pas masquer le doute.
    expect(
      adepPhase(posting({ attemptState: 'sent', remoteStatus: 'PUBLIEE' })),
    ).toBe('uncertain');
  });

  it('un échec reste un échec', () => {
    expect(adepPhase(posting({ attemptState: 'failed', remoteStatus: null }))).toBe(
      'failed',
    );
  });
});

describe('fenêtre de republication', () => {
  it('court depuis la PUBLICATION, pas depuis la suspension', () => {
    // Une offre publiée le 1er et suspendue le 28 n'a plus que deux jours.
    // Compter depuis la suspension en donnerait trente de plus, et le bouton
    // disparaîtrait sans prévenir au moment où quelqu'un s'en sert.
    expect(republishDaysLeft('2026-09-01T09:00:00Z', NOW)).toBe(23);
    expect(republishDaysLeft('2026-08-01T09:00:00Z', NOW)).toBe(-8);
  });

  it('offre le bouton tant que la fenêtre est ouverte', () => {
    expect(canRepublish(posting({ remoteStatus: 'SUSPENDUE' }), NOW)).toBe(true);
  });

  it('le retire une fois la fenêtre fermée', () => {
    expect(
      canRepublish(
        posting({ remoteStatus: 'SUSPENDUE', publishedAt: '2026-08-01T09:00:00Z' }),
        NOW,
      ),
    ).toBe(false);
  });

  it('LAISSE le bouton quand la date de publication est inconnue', () => {
    // L'Apec tranchera, et son refus est explicite (API_361). Retirer un geste
    // légitime sur un doute est pire que le laisser échouer proprement.
    expect(
      canRepublish(posting({ remoteStatus: 'SUSPENDUE', publishedAt: null }), NOW),
    ).toBe(true);
  });

  it('ne propose jamais de republier une offre fermée ou déjà publiée', () => {
    expect(canRepublish(posting({ remoteStatus: 'FERMEE' }), NOW)).toBe(false);
    expect(canRepublish(posting({ remoteStatus: 'PUBLIEE' }), NOW)).toBe(false);
    expect(canRepublish(null, NOW)).toBe(false);
  });
});

describe('la phrase qui accompagne', () => {
  it('donne la date limite quand la fenêtre est ouverte', () => {
    const notice = republishNotice(posting({ remoteStatus: 'SUSPENDUE' }), NOW);
    expect(notice).toContain('01/10/2026');
    expect(notice).toContain('23 jours');
  });

  it('DIT pourquoi le bouton a disparu — jamais un silence', () => {
    // Un bouton retiré sans explication ne déplace pas le besoin, il le
    // supprime. Même principe que « le déplacement est dans le mail ».
    const notice = republishNotice(
      posting({ remoteStatus: 'SUSPENDUE', publishedAt: '2026-08-01T09:00:00Z' }),
      NOW,
    );
    expect(notice).toContain('fermée');
    expect(notice).toContain('nouvelle offre');
  });

  it('rappelle l’échéance même sur une offre encore publiée', () => {
    expect(republishNotice(posting(), NOW)).toContain('01/10/2026');
  });

  it('se tait quand il n’y a rien à dire', () => {
    expect(republishNotice(null, NOW)).toBeNull();
    expect(republishNotice(posting({ remoteStatus: 'FERMEE' }), NOW)).toBeNull();
    expect(republishNotice(posting({ publishedAt: null }), NOW)).toBeNull();
  });
});

describe('avertissement permanent', () => {
  it('dit où corriger, pas seulement que c’est impossible', () => {
    // `updatePosition` est désactivé côté Apec, et personne ne le devine.
    expect(ADEP_IMMUTABLE_NOTICE).toContain('apec.fr');
    expect(ADEP_IMMUTABLE_NOTICE).toContain('support');
  });
});

describe('« Dépublier » n’est proposé que là où l’Apec l’accepte', () => {
  // Mesuré en environnement de test le 09/09 : une offre AVALIDER rend
  // API_352 (« changement de statut non autorisé depuis l'état actuel »).
  // Le panneau proposait pourtant le bouton — il faisait porter à
  // l'utilisateur le coût de notre ignorance.
  it('accepte une offre publiée', () => {
    expect(canSuspend('published')).toBe(true);
    expect(suspendUnavailableNotice('published')).toBeNull();
  });

  it('refuse une offre en attente de validation, et DIT pourquoi', () => {
    expect(canSuspend('awaiting_validation')).toBe(false);
    expect(suspendUnavailableNotice('awaiting_validation')).toContain('consultant Apec');
  });

  it('ne propose rien sur les états où il n’y a rien à retirer', () => {
    for (const phase of ['none', 'failed', 'uncertain', 'suspended', 'closed'] as const) {
      expect(canSuspend(phase)).toBe(false);
    }
  });
});
