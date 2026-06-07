import { beforeEach, describe, expect, it } from 'vitest';

import { useCampaignsStore } from '@/stores/campaigns-store';
import { buildEmptyFDP } from '@/types/field-collection';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';

function makeFDP(id: string, validated = false) {
  const fdp = buildEmptyFDP(id);
  fdp.fields.job_title = {
    ...fdp.fields.job_title!,
    value: 'Comptable senior',
    status: 'filled',
  };
  if (validated) {
    fdp.isComplete = true;
    fdp.isValidated = true;
  }
  return fdp;
}

describe('campaigns-store', () => {
  beforeEach(() => {
    useCampaignsStore.getState().reset();
  });

  it('addCampaign derives draft status from a non-validated FDP', () => {
    const c = useCampaignsStore
      .getState()
      .addCampaign({ fdp: makeFDP('CAMP-2026-001') });
    expect(c.status).toBe('draft');
  });

  it('addCampaign derives in_progress status from a validated FDP', () => {
    const c = useCampaignsStore
      .getState()
      .addCampaign({ fdp: makeFDP('CAMP-2026-002', true) });
    expect(c.status).toBe('in_progress');
  });

  it('addCampaign preserves the existing status when re-adding the same id', () => {
    const fdp = makeFDP('CAMP-2026-003', true);
    useCampaignsStore.getState().addCampaign({ fdp });
    useCampaignsStore
      .getState()
      .updateStatus('CAMP-2026-003', 'active');
    // Re-add (cas du wipe sur une campagne déjà active).
    useCampaignsStore.getState().addCampaign({ fdp });
    expect(useCampaignsStore.getState().getById('CAMP-2026-003')?.status).toBe(
      'active',
    );
  });

  it('addCampaign accepts an explicit status override', () => {
    const fdp = makeFDP('CAMP-2026-004');
    useCampaignsStore
      .getState()
      .addCampaign({ fdp, status: 'closed' });
    expect(useCampaignsStore.getState().getById('CAMP-2026-004')?.status).toBe(
      'closed',
    );
  });

  it('updateStatus mutates the entry and bumps updatedAt', async () => {
    const fdp = makeFDP('CAMP-2026-005', true);
    const before = useCampaignsStore.getState().addCampaign({ fdp });
    // Petit délai pour s'assurer que updatedAt change (ms granularity).
    await new Promise((r) => setTimeout(r, 5));
    useCampaignsStore.getState().updateStatus('CAMP-2026-005', 'closed');
    const after = useCampaignsStore.getState().getById('CAMP-2026-005');
    expect(after?.status).toBe('closed');
    expect(after?.updatedAt).not.toBe(before.updatedAt);
    // createdAt préservé.
    expect(after?.createdAt).toBe(before.createdAt);
  });

  it('updateStatus is a no-op when the id is unknown', () => {
    useCampaignsStore.getState().updateStatus('CAMP-NOPE', 'closed');
    expect(Object.keys(useCampaignsStore.getState().byId)).toHaveLength(0);
  });

  it('addCampaign stores the optional scoringSheet snapshot', () => {
    const fdp = makeFDP('CAMP-2026-006', true);
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-006',
      isValidated: true,
      criteria: [
        buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
      ],
    };
    useCampaignsStore
      .getState()
      .addCampaign({ fdp, scoringSheet: sheet });
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-006')?.scoringSheet
        ?.criteria,
    ).toHaveLength(1);
  });

  it('addCampaign preserves an existing scoringSheet when input is undefined', () => {
    const fdp = makeFDP('CAMP-2026-007', true);
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-007',
      isValidated: true,
      criteria: [
        buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
      ],
    };
    useCampaignsStore
      .getState()
      .addCampaign({ fdp, scoringSheet: sheet });
    // Second appel sans scoringSheet ne doit PAS l'effacer.
    useCampaignsStore.getState().addCampaign({ fdp });
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-007')?.scoringSheet,
    ).not.toBeNull();
  });

  it('markPublishedChannel is idempotent and bumps updatedAt', async () => {
    const fdp = makeFDP('CAMP-2026-PUB', true);
    const before = useCampaignsStore.getState().addCampaign({ fdp });
    await new Promise((r) => setTimeout(r, 5));
    useCampaignsStore
      .getState()
      .markPublishedChannel('CAMP-2026-PUB', 'linkedin');
    useCampaignsStore
      .getState()
      .markPublishedChannel('CAMP-2026-PUB', 'linkedin');
    const after = useCampaignsStore.getState().getById('CAMP-2026-PUB');
    expect(after?.publishedChannels).toEqual(['linkedin']);
    expect(after?.updatedAt).not.toBe(before.updatedAt);
  });

  it('markSourcesConfirmed flips the flag once', () => {
    const fdp = makeFDP('CAMP-2026-SRC', true);
    useCampaignsStore.getState().addCampaign({ fdp });
    useCampaignsStore.getState().markSourcesConfirmed('CAMP-2026-SRC');
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-SRC')?.sourcesConfirmed,
    ).toBe(true);
  });

  it('recomputeStatus stays draft when FDP is not validated', () => {
    const fdp = makeFDP('CAMP-2026-REC1', false);
    useCampaignsStore.getState().addCampaign({ fdp });
    useCampaignsStore.getState().recomputeStatus('CAMP-2026-REC1');
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-REC1')?.status,
    ).toBe('draft');
  });

  it('recomputeStatus → in_progress when FDP validated but artefacts missing', () => {
    const fdp = makeFDP('CAMP-2026-REC2', true);
    useCampaignsStore.getState().addCampaign({ fdp });
    useCampaignsStore.getState().recomputeStatus('CAMP-2026-REC2');
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-REC2')?.status,
    ).toBe('in_progress');
  });

  it('recomputeStatus → active when FDP + ad + sources + scoring all aligned', () => {
    const fdp = makeFDP('CAMP-2026-REC3', true);
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-REC3',
      isValidated: true,
      criteria: [
        buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
      ],
    };
    const store = useCampaignsStore.getState();
    store.addCampaign({ fdp, scoringSheet: sheet });
    store.markPublishedChannel('CAMP-2026-REC3', 'linkedin');
    store.setSources('CAMP-2026-REC3', ['manual']); // ≥1 source → intake done
    // 2c-3 — annonce/publication sont pilotées par transitions (le flux
    // les complète explicitement), plus par markPublishedChannel.
    store.completePhase('CAMP-2026-REC3', 'announcement');
    store.completePhase('CAMP-2026-REC3', 'publication');
    store.recomputeStatus('CAMP-2026-REC3');
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-REC3')?.status,
    ).toBe('active');
  });

  it('recomputeStatus does NOT override paused or closed', () => {
    const fdp = makeFDP('CAMP-2026-REC4', true);
    useCampaignsStore.getState().addCampaign({ fdp });
    useCampaignsStore.getState().updateStatus('CAMP-2026-REC4', 'paused');
    useCampaignsStore
      .getState()
      .markPublishedChannel('CAMP-2026-REC4', 'linkedin');
    useCampaignsStore.getState().markSourcesConfirmed('CAMP-2026-REC4');
    useCampaignsStore.getState().recomputeStatus('CAMP-2026-REC4');
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-REC4')?.status,
    ).toBe('paused');
    useCampaignsStore.getState().updateStatus('CAMP-2026-REC4', 'closed');
    useCampaignsStore.getState().recomputeStatus('CAMP-2026-REC4');
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-REC4')?.status,
    ).toBe('closed');
  });

  it('activateCampaign refuse une campagne pas prête et ne touche pas le statut', () => {
    const store = useCampaignsStore.getState();
    store.addCampaign({ fdp: makeFDP('CAMP-2026-ACT1') }); // FDP non validée → draft
    expect(store.activateCampaign('CAMP-2026-ACT1')).toBe(false);
    expect(store.getById('CAMP-2026-ACT1')?.status).toBe('draft');
  });

  it('activateCampaign active dès les obligatoires faites et REPORTE les optionnelles pending', () => {
    const fdp = makeFDP('CAMP-2026-ACT2', true);
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-ACT2',
      isValidated: true,
      criteria: [buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' })],
    };
    const store = useCampaignsStore.getState();
    store.addCampaign({ fdp, scoringSheet: sheet });
    store.setSources('CAMP-2026-ACT2', ['manual']); // ≥1 source → intake done
    // Annonce + publication laissées PENDING (le DRH ne les a pas touchées).
    // La campagne est donc 'in_progress', pas encore 'active'.
    expect(store.getById('CAMP-2026-ACT2')?.status).toBe('in_progress');
    expect(store.activateCampaign('CAMP-2026-ACT2')).toBe(true);
    const after = store.getById('CAMP-2026-ACT2');
    expect(after?.status).toBe('active');
    // Les optionnelles ont été reportées (cohérence machine ↔ statut).
    expect(after?.lifecycle.phases.announcement.status).toBe('postponed');
    expect(after?.lifecycle.phases.publication.status).toBe('postponed');
  });

  it('activateCampaign no-op si la campagne est paused/closed (pas draft/in_progress)', () => {
    const store = useCampaignsStore.getState();
    store.addCampaign({ fdp: makeFDP('CAMP-2026-ACT3', true) });
    store.updateStatus('CAMP-2026-ACT3', 'paused');
    expect(store.activateCampaign('CAMP-2026-ACT3')).toBe(false);
    expect(store.getById('CAMP-2026-ACT3')?.status).toBe('paused');
  });

  it('resumeCampaign re-dérive le statut au lieu de forcer active', () => {
    const store = useCampaignsStore.getState();
    // FDP validée seule → in_progress (scoring/intake/optionnelles non réglés).
    store.addCampaign({ fdp: makeFDP('CAMP-2026-RES1', true) });
    store.updateStatus('CAMP-2026-RES1', 'paused');
    store.resumeCampaign('CAMP-2026-RES1');
    // Pas de faux 'active' : la campagne n'était pas prête.
    expect(store.getById('CAMP-2026-RES1')?.status).toBe('in_progress');
  });

  it('intake : aucune source par défaut → non activable tant qu\'aucun flux n\'est actif', () => {
    const store = useCampaignsStore.getState();
    const fdp = makeFDP('CAMP-2026-INT1', true);
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-INT1',
      isValidated: true,
      criteria: [buildCriterion({ id: 'c1', label: 'X', level: 'obligatoire' })],
    };
    // Défaut : sources=[] → aucun flux de réception.
    store.addCampaign({ fdp, scoringSheet: sheet });
    expect(store.getById('CAMP-2026-INT1')?.sources).toEqual([]);
    // FDP + scoring validés MAIS aucun flux → activation refusée.
    expect(store.activateCampaign('CAMP-2026-INT1')).toBe(false);
    // Activer une source → intake done → activable.
    store.setSources('CAMP-2026-INT1', ['manual']);
    expect(store.activateCampaign('CAMP-2026-INT1')).toBe(true);
    expect(store.getById('CAMP-2026-INT1')?.status).toBe('active');
  });

  it('intake : vider les sources rouvre la phase (pas d\'« actif sans flux »)', () => {
    const store = useCampaignsStore.getState();
    const fdp = makeFDP('CAMP-2026-INT2', true);
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-INT2',
      isValidated: true,
      criteria: [buildCriterion({ id: 'c1', label: 'X', level: 'obligatoire' })],
    };
    store.addCampaign({ fdp, scoringSheet: sheet });
    store.setSources('CAMP-2026-INT2', ['manual']);
    store.activateCampaign('CAMP-2026-INT2');
    expect(store.getById('CAMP-2026-INT2')?.status).toBe('active');
    // On retire TOUTES les sources → intake rouvert → plus 'active'.
    store.setSources('CAMP-2026-INT2', []);
    expect(store.getById('CAMP-2026-INT2')?.status).not.toBe('active');
    expect(
      store.getById('CAMP-2026-INT2')?.lifecycle.phases.intake.status,
    ).toBe('pending');
  });

  it('addCampaign sets scoringSheet to null explicitly when null is passed', () => {
    const fdp = makeFDP('CAMP-2026-008', true);
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-008',
      isValidated: true,
      criteria: [
        buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
      ],
    };
    useCampaignsStore
      .getState()
      .addCampaign({ fdp, scoringSheet: sheet });
    useCampaignsStore
      .getState()
      .addCampaign({ fdp, scoringSheet: null });
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-008')?.scoringSheet,
    ).toBeNull();
  });

  it('addCampaign initialise le lifecycle (FDP done, aval pending)', () => {
    const c = useCampaignsStore
      .getState()
      .addCampaign({ fdp: makeFDP('CAMP-2026-LC1', true) });
    expect(c.lifecycle.phases.fdp.status).toBe('done');
    expect(c.lifecycle.phases.scoring.status).toBe('pending');
    expect(c.lifecycle.phases.announcement.status).toBe('pending');
  });

  it('les mutations de jalon tiennent le lifecycle à jour → active', () => {
    const fdp = makeFDP('CAMP-2026-LC2', true);
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-LC2',
      isValidated: true,
      criteria: [buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' })],
    };
    const store = useCampaignsStore.getState();
    store.addCampaign({ fdp, scoringSheet: sheet });
    store.setSources('CAMP-2026-LC2', ['manual']);
    store.completePhase('CAMP-2026-LC2', 'announcement');
    store.completePhase('CAMP-2026-LC2', 'publication');
    store.recomputeStatus('CAMP-2026-LC2');
    const c = useCampaignsStore.getState().getById('CAMP-2026-LC2')!;
    expect(c.lifecycle.phases.scoring.status).toBe('done');
    expect(c.lifecycle.phases.intake.status).toBe('done');
    expect(c.lifecycle.phases.announcement.status).toBe('done');
    expect(c.status).toBe('active');
  });

  function makeActiveCampaign(id: string): void {
    const fdp = makeFDP(id, true);
    const sheet: ScoringSheet = {
      campaignId: id,
      isValidated: true,
      criteria: [buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' })],
    };
    const store = useCampaignsStore.getState();
    store.addCampaign({ fdp, scoringSheet: sheet });
    store.markPublishedChannel(id, 'linkedin');
    store.setSources(id, ['manual']);
    // 2c-3 — annonce/publication via transitions (le vrai flux les complète).
    store.completePhase(id, 'announcement');
    store.completePhase(id, 'publication');
    store.recomputeStatus(id);
  }

  it('completePhase marque une phase done quand les dépendances sont faites', () => {
    const id = 'CAMP-2026-CP1';
    useCampaignsStore.getState().addCampaign({ fdp: makeFDP(id, true) });
    useCampaignsStore.getState().completePhase(id, 'scoring');
    expect(
      useCampaignsStore.getState().getById(id)?.lifecycle.phases.scoring.status,
    ).toBe('done');
  });

  it('completePhase est un no-op si les dépendances ne sont pas faites', () => {
    const id = 'CAMP-2026-CP2';
    useCampaignsStore.getState().addCampaign({ fdp: makeFDP(id, true) });
    // publication dépend de announcement (pending) → refusé
    useCampaignsStore.getState().completePhase(id, 'publication');
    expect(
      useCampaignsStore.getState().getById(id)?.lifecycle.phases.publication
        .status,
    ).toBe('pending');
  });

  it('postponePhase reporte annonce + publication → campagne active sans publier', () => {
    const id = 'CAMP-2026-PP1';
    const fdp = makeFDP(id, true);
    const sheet: ScoringSheet = {
      campaignId: id,
      isValidated: true,
      criteria: [buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' })],
    };
    const store = useCampaignsStore.getState();
    store.addCampaign({ fdp, scoringSheet: sheet });
    store.setSources(id, ['manual']);
    store.recomputeStatus(id);
    expect(useCampaignsStore.getState().getById(id)?.status).toBe('in_progress');
    store.postponePhase(id, 'announcement');
    store.postponePhase(id, 'publication');
    const c = useCampaignsStore.getState().getById(id)!;
    expect(c.lifecycle.phases.announcement.status).toBe('postponed');
    expect(c.lifecycle.phases.publication.status).toBe('postponed');
    expect(c.status).toBe('active');
  });

  it('postponePhase sur une phase obligatoire est un no-op', () => {
    const id = 'CAMP-2026-PP2';
    useCampaignsStore.getState().addCampaign({ fdp: makeFDP(id, true) });
    useCampaignsStore.getState().postponePhase(id, 'scoring');
    const c = useCampaignsStore.getState().getById(id)!;
    expect(c.lifecycle.phases.scoring.status).toBe('pending');
    expect(c.status).toBe('in_progress');
  });

  it('reopenPhase(annonce) retire la publication et redescend le statut', () => {
    const id = 'CAMP-2026-RO1';
    makeActiveCampaign(id);
    expect(useCampaignsStore.getState().getById(id)?.status).toBe('active');
    useCampaignsStore.getState().reopenPhase(id, 'announcement');
    const c = useCampaignsStore.getState().getById(id)!;
    expect(c.publishedChannels).toEqual([]);
    expect(c.lifecycle.phases.announcement.status).toBe('pending');
    expect(c.lifecycle.phases.publication.status).toBe('pending');
    expect(c.status).toBe('in_progress');
  });

  it('reopenPhase(fdp) cascade tout l’aval et réinitialise les artefacts', () => {
    const id = 'CAMP-2026-RO2';
    makeActiveCampaign(id);
    useCampaignsStore.getState().reopenPhase(id, 'fdp');
    const c = useCampaignsStore.getState().getById(id)!;
    expect(c.fdp.isValidated).toBe(false);
    expect(c.scoringSheet?.isValidated).toBe(false);
    expect(c.sourcesConfirmed).toBe(false);
    expect(c.publishedChannels).toEqual([]);
    expect(c.status).toBe('draft');
  });

  it('addCampaign initialise le seuil par défaut à 75', () => {
    const c = useCampaignsStore
      .getState()
      .addCampaign({ fdp: makeFDP('CAMP-2026-100') });
    expect(c.threshold).toBe(75);
  });

  it('setThreshold borne la valeur entre 0 et 100', () => {
    const fdp = makeFDP('CAMP-2026-101');
    useCampaignsStore.getState().addCampaign({ fdp });
    useCampaignsStore.getState().setThreshold('CAMP-2026-101', 150);
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-101')?.threshold,
    ).toBe(100);
    useCampaignsStore.getState().setThreshold('CAMP-2026-101', -10);
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-101')?.threshold,
    ).toBe(0);
  });

  it('setThreshold met à jour updatedAt seulement quand la valeur change', () => {
    const fdp = makeFDP('CAMP-2026-102');
    useCampaignsStore.getState().addCampaign({ fdp });
    const before = useCampaignsStore
      .getState()
      .getById('CAMP-2026-102')!.updatedAt;
    useCampaignsStore.getState().setThreshold('CAMP-2026-102', 75);
    // identique → updatedAt inchangé
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-102')!.updatedAt,
    ).toBe(before);
  });
});
