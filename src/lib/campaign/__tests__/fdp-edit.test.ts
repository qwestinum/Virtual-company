import { beforeEach, describe, expect, it } from 'vitest';

import { resolveFdpEditSave } from '@/lib/campaign/fdp-edit';
import { useCampaignsStore } from '@/stores/campaigns-store';
import {
  buildEmptyFDP,
  FIELD_KEYS,
  type FDPInProgress,
} from '@/types/field-collection';

/** FDP complète : tous les champs requis « filled » + validée. */
function completeFDP(id: string, jobTitle = 'Data Engineer'): FDPInProgress {
  const fdp = buildEmptyFDP(id);
  for (const key of FIELD_KEYS) {
    fdp.fields[key] = {
      ...fdp.fields[key]!,
      value: key === 'job_title' ? jobTitle : `valeur-${key}`,
      status: 'filled',
    };
  }
  fdp.isComplete = true;
  fdp.isValidated = true;
  return fdp;
}

/** Reproduit l'édition d'un champ : nouvelle valeur « filled ». */
function editField(
  fdp: FDPInProgress,
  key: (typeof FIELD_KEYS)[number],
  value: unknown,
): FDPInProgress {
  const filled =
    typeof value === 'string' ? value.trim().length > 0 : value != null;
  return {
    ...fdp,
    fields: {
      ...fdp.fields,
      [key]: { ...fdp.fields[key]!, value, status: filled ? 'filled' : 'empty' },
    },
  };
}

describe('resolveFdpEditSave — règle pure', () => {
  it("l'intitulé suit le champ job_title édité", () => {
    const prev = completeFDP('CAMP-1', 'Comptable');
    const draft = editField(prev, 'job_title', 'Comptable senior');
    const { name, finalFdp } = resolveFdpEditSave(prev, draft, 'Comptable');
    expect(name).toBe('Comptable senior');
    expect(finalFdp.fields.job_title?.value).toBe('Comptable senior');
  });

  it('repli sur le nom courant si le titre est vidé', () => {
    const prev = completeFDP('CAMP-1', 'Comptable');
    const draft = editField(prev, 'job_title', '');
    const { name } = resolveFdpEditSave(prev, draft, 'Comptable');
    expect(name).toBe('Comptable');
  });

  it('PRÉSERVE la validation quand seul le titre change (pas de régression)', () => {
    const prev = completeFDP('CAMP-1', 'Comptable');
    const draft = editField(prev, 'job_title', 'Comptable senior');
    const { finalFdp } = resolveFdpEditSave(prev, draft, 'Comptable');
    expect(finalFdp.isValidated).toBe(true);
  });

  it('DÉVALIDE seulement si un champ requis rempli est vidé (régression)', () => {
    const prev = completeFDP('CAMP-1', 'Comptable');
    const draft = editField(prev, 'location', '');
    const { finalFdp } = resolveFdpEditSave(prev, draft, 'Comptable');
    expect(finalFdp.isValidated).toBe(false);
  });

  it('valide une FDP jamais validée dès qu’elle devient complète', () => {
    const prev = buildEmptyFDP('CAMP-1'); // isValidated false
    let draft = prev;
    for (const key of FIELD_KEYS) {
      draft = editField(draft, key, `v-${key}`);
    }
    const { finalFdp } = resolveFdpEditSave(prev, draft, 'X');
    expect(finalFdp.isValidated).toBe(true);
  });
});

describe('FDPEditBlock.onSave via le store réel — pas de rétrogradation', () => {
  beforeEach(() => useCampaignsStore.getState().reset());

  it("éditer le titre d'une campagne active NE la repasse PAS en brouillon", () => {
    const store = () => useCampaignsStore.getState();
    const id = 'CAMP-EDIT-1';
    // Campagne pleinement avancée → active.
    store().addCampaign({
      fdp: completeFDP(id, 'Data Engineer'),
      name: 'Data Engineer',
      scoringSheet: {
        campaignId: id,
        isValidated: true,
        criteria: [
          {
            id: 'c1',
            label: 'SQL',
            level: 'critique',
            weight: 1,
            keywords: ['sql'],
            verificationMethod: 'keywords_exact',
          },
        ],
      },
      sourcesConfirmed: true,
      sources: ['email'],
      publishedChannels: ['linkedin'],
      status: 'active',
    });
    expect(store().getById(id)?.status).toBe('active');

    // onSave : édition du titre.
    const prev = store().getById(id)!;
    const draft = editField(prev.fdp, 'job_title', 'Data Engineer Senior');
    const { finalFdp, name } = resolveFdpEditSave(prev.fdp, draft, prev.name);
    store().addCampaign({
      fdp: finalFdp,
      name,
      status: prev.status,
      scoringSheet: prev.scoringSheet,
      publishedChannels: prev.publishedChannels,
      sourcesConfirmed: prev.sourcesConfirmed,
    });
    store().recomputeStatus(id);

    const after = store().getById(id)!;
    expect(after.status).toBe('active'); // PAS draft
    expect(after.name).toBe('Data Engineer Senior'); // titre mis à jour
    expect(after.fdp.fields.job_title?.value).toBe('Data Engineer Senior');
  });
});
