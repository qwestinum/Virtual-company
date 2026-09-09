/**
 * Le pré-remplissage de l'offre APEC — ce qu'il reprend, et ce qu'il refuse de
 * faire dans le dos du recruteur.
 *
 * Les cas qui comptent ici ne sont pas les cas nominaux : ce sont la
 * NON-troncature d'un descriptif trop long (l'écart est dit, le texte reste
 * entier) et la NON-resynchronisation d'une offre déjà publiée.
 */
import { describe, expect, it } from 'vitest';

import type { DemoJobPost } from '@/types/job-post';

import {
  describePrefillSource,
  hasMarkdownMarkup,
  prefillFromGeneration,
  prefillFromJobPost,
  prefillIssues,
} from '../prefill';
import { ADEP_LIMITS } from '../validate';

function jobPost(over: Partial<DemoJobPost> = {}): DemoJobPost {
  return {
    campaignId: 'CAMP-2026-511',
    title: 'Comptable général confirmé',
    body: 'Rejoignez une équipe de huit personnes pour tenir la comptabilité générale.',
    tags: ['Comptabilité'],
    location: 'Tours',
    contract: 'CDI',
    isVisible: true,
    publishedAt: '2026-08-12T09:30:00.000Z',
    updatedAt: '2026-08-20T11:00:00.000Z',
    ...over,
  };
}

describe('prefillFromJobPost — reprendre ce qui a été relu', () => {
  it('reprend le titre et le corps de l’annonce générique publiée', () => {
    const prefill = prefillFromJobPost(jobPost());
    expect(prefill).not.toBeNull();
    expect(prefill?.source).toBe('generic_published');
    expect(prefill?.positionTitle).toBe('Comptable général confirmé');
    expect(prefill?.positionDescription).toContain('comptabilité générale');
    // La provenance est datée sur la PUBLICATION, pas sur la dernière
    // modification de ligne : c'est la date que le recruteur reconnaît.
    expect(prefill?.label).toBe('annonce générique publiée du 12/08/2026');
  });

  it('reprend aussi une annonce DÉPUBLIÉE, en le disant', () => {
    // `unpublishJobPost` retire l'annonce de la vitrine sans effacer le texte.
    // Ce qu'un humain a relu reste ce qu'il a relu — mais on ne le fait pas
    // passer pour une annonce en ligne.
    const prefill = prefillFromJobPost(jobPost({ isVisible: false }));
    expect(prefill?.source).toBe('generic_unpublished');
    expect(prefill?.label).toContain('dépubliée');
    expect(prefill?.label).toContain('20/08/2026');
  });

  it('rend null quand il n’y a rien à reprendre', () => {
    expect(prefillFromJobPost(null)).toBeNull();
    expect(prefillFromJobPost(jobPost({ title: '  ', body: '  ' }))).toBeNull();
  });
});

describe('prefillFromGeneration — le repli, qui ne se fait pas passer pour relu', () => {
  it('se présente comme un brouillon, jamais comme un texte validé', () => {
    const prefill = prefillFromGeneration({
      title: 'Comptable général (H/F)',
      body: 'Missions variées au sein du service comptable.',
    });
    expect(prefill?.source).toBe('job_writer');
    expect(prefill?.at).toBeNull();
    expect(prefill?.label).toBe('brouillon pré-rédigé, à relire');
  });

  it('rend null sur une génération vide plutôt qu’un brouillon fantôme', () => {
    expect(prefillFromGeneration({ title: '', body: '   ' })).toBeNull();
  });
});

describe('prefillIssues — les écarts sont DITS, le texte n’est jamais coupé', () => {
  it('signale un descriptif trop long SANS le tronquer', () => {
    const long = 'x'.repeat(ADEP_LIMITS.positionDescriptionMax + 240);
    const prefill = prefillFromJobPost(jobPost({ body: long }));

    // Le texte est intégralement recopié : couper au caractère 3 000 rendrait
    // une offre amputée en plein mot, et personne ne le saurait.
    expect(prefill?.positionDescription).toHaveLength(long.length);

    const issues = prefillIssues(prefill!, {
      positionTitle: 'Comptable général confirmé',
      positionDescription: prefill!.positionDescription,
    });
    const tooLong = issues.find((i) => i.field === 'positionDescription');
    expect(tooLong?.level).toBe('error');
    expect(tooLong?.message).toContain(String(long.length));
    expect(tooLong?.message).toContain('3000');
  });

  it('signale un descriptif trop court', () => {
    const prefill = prefillFromJobPost(jobPost({ body: 'Poste à pourvoir.' }));
    const issues = prefillIssues(prefill!, {
      positionTitle: 'Comptable',
      positionDescription: 'Poste à pourvoir.',
    });
    expect(issues.some((i) => i.message.includes('200 au minimum'))).toBe(true);
  });

  it('mesure l’intitulé AVEC la mention H/F, comme ce qui part vraiment', () => {
    // 78 caractères saisis : sous la limite de 80… jusqu'à ce que « H/F »
    // s'ajoute. Mesurer la saisie laisserait passer un titre que l'Apec refuse.
    const title = 'C'.repeat(78);
    const prefill = prefillFromJobPost(jobPost({ title }));
    const issues = prefillIssues(prefill!, {
      positionTitle: title,
      positionDescription: prefill!.positionDescription,
    });
    const titleIssue = issues.find((i) => i.field === 'positionTitle');
    expect(titleIssue?.level).toBe('error');
    expect(titleIssue?.preventsCode).toBe('316');
  });

  it('avertit des marques Markdown sans rien retirer', () => {
    const body = `## Missions\n- Tenue comptable\n- **Révision** des comptes\n${'z'.repeat(220)}`;
    const prefill = prefillFromJobPost(jobPost({ body }));
    expect(prefill?.hasMarkup).toBe(true);
    expect(prefill?.positionDescription).toContain('## Missions');

    const issues = prefillIssues(prefill!, {
      positionTitle: 'Comptable',
      positionDescription: prefill!.positionDescription,
    });
    const markup = issues.find((i) => i.message.includes('mise en forme'));
    expect(markup?.level).toBe('warning');
  });

  it('ne dit rien quand le texte repris tient dans les bornes', () => {
    const body = 'Vous rejoignez le service comptable. '.repeat(12);
    const prefill = prefillFromJobPost(jobPost({ body }));
    expect(
      prefillIssues(prefill!, {
        positionTitle: 'Comptable général confirmé',
        positionDescription: body,
      }),
    ).toEqual([]);
  });
});

describe('hasMarkdownMarkup', () => {
  it('reconnaît titres, gras, listes et liens', () => {
    expect(hasMarkdownMarkup('## Missions')).toBe(true);
    expect(hasMarkdownMarkup('Une **révision** annuelle')).toBe(true);
    expect(hasMarkdownMarkup('- Tenue comptable')).toBe(true);
    expect(hasMarkdownMarkup('Voir [le site](https://exemple.fr)')).toBe(true);
  });

  it('ne crie pas sur du texte ordinaire', () => {
    expect(
      hasMarkdownMarkup(
        'Vous serez rattaché au DAF. Rémunération 45-55 k€ selon profil (13e mois).',
      ),
    ).toBe(false);
  });
});

describe('describePrefillSource', () => {
  it('reste lisible quand la date manque', () => {
    expect(describePrefillSource('generic_published', null)).toBe(
      'annonce générique publiée',
    );
    expect(describePrefillSource('generic_published', 'pas-une-date')).toBe(
      'annonce générique publiée',
    );
  });
});
