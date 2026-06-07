import { beforeEach, describe, expect, it } from 'vitest';

import { useCampaignsStore } from '@/stores/campaigns-store';
import { buildEmptyFDP } from '@/types/field-collection';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';

/**
 * E2E « moteur » — parcours bout-en-bout du cycle de vie d'une campagne via le
 * store (qui assemble lifecycle + artefacts + statut). Déterministe, sans LLM ni
 * navigateur : couvre exactement les zones qui ont régressé en session
 * (porte d'activation, sources = unique vérité, diffusion ≠ réception, cascade
 * de réouverture, pause/reprise, clôture). Chaque test est un SCÉNARIO chaîné,
 * pas une assertion isolée.
 */

const store = () => useCampaignsStore.getState();

function validatedFDP(id: string) {
  const fdp = buildEmptyFDP(id);
  fdp.fields.job_title = {
    ...fdp.fields.job_title!,
    value: 'Comptable',
    status: 'filled',
  };
  fdp.isComplete = true;
  fdp.isValidated = true;
  return fdp;
}

function draftFDP(id: string) {
  const fdp = buildEmptyFDP(id);
  fdp.fields.job_title = {
    ...fdp.fields.job_title!,
    value: 'Comptable',
    status: 'filled',
  };
  return fdp; // isComplete/isValidated = false
}

function validatedSheet(id: string): ScoringSheet {
  return {
    campaignId: id,
    isValidated: true,
    criteria: [buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' })],
  };
}

describe('E2E — parcours cycle de vie campagne', () => {
  beforeEach(() => {
    store().reset();
  });

  it('Scénario 1 — montée progressive draft → active, la porte refuse à chaque prérequis manquant', () => {
    const id = 'CAMP-E2E-001';

    // 1. FDP non validée → draft, non activable.
    store().addCampaign({ fdp: draftFDP(id) });
    expect(store().getById(id)?.status).toBe('draft');
    expect(store().activateCampaign(id)).toBe(false);

    // 2. Validation FDP (addCampaign préserve le statut existant → recompute,
    // comme handleValidateFDP / FDPEditBlock). FDP done → in_progress.
    store().addCampaign({ fdp: validatedFDP(id) });
    store().recomputeStatus(id);
    expect(store().getById(id)?.status).toBe('in_progress');
    expect(store().activateCampaign(id)).toBe(false);

    // 3. + fiche de scoring validée → toujours in_progress (flux manquant).
    store().addCampaign({ fdp: validatedFDP(id), scoringSheet: validatedSheet(id) });
    store().recomputeStatus(id);
    expect(store().activateCampaign(id)).toBe(false);

    // 4. + une source de réception → intake done ; reste in_progress (optionnelles).
    store().setSources(id, ['email']);
    const c4 = store().getById(id)!;
    expect(c4.lifecycle.phases.intake.status).toBe('done');
    expect(c4.status).toBe('in_progress');

    // 5. Annonce + publication complétées explicitement → active (dérivé).
    store().completePhase(id, 'announcement');
    store().completePhase(id, 'publication');
    store().recomputeStatus(id);
    const c5 = store().getById(id)!;
    expect(c5.status).toBe('active');
    expect(c5.lifecycle.phases.publication.status).toBe('done');
  });

  it('Scénario 2 — activation manuelle reporte les optionnelles pending', () => {
    const id = 'CAMP-E2E-002';
    store().addCampaign({ fdp: validatedFDP(id), scoringSheet: validatedSheet(id) });
    store().setSources(id, ['manual']);
    expect(store().getById(id)?.status).toBe('in_progress'); // annonce/pub pending

    expect(store().activateCampaign(id)).toBe(true);
    const c = store().getById(id)!;
    expect(c.status).toBe('active');
    expect(c.lifecycle.phases.announcement.status).toBe('postponed');
    expect(c.lifecycle.phases.publication.status).toBe('postponed');
  });

  it('Scénario 3 — les sources sont l\'unique vérité du flux (vider = rouvrir l\'intake)', () => {
    const id = 'CAMP-E2E-003';
    store().addCampaign({ fdp: validatedFDP(id), scoringSheet: validatedSheet(id) });
    store().setSources(id, ['manual', 'email']);
    store().activateCampaign(id);
    expect(store().getById(id)?.status).toBe('active');

    // Retirer une source sur deux → reste active.
    store().setSources(id, ['email']);
    expect(store().getById(id)?.status).toBe('active');

    // Retirer la dernière → intake rouvert → plus active.
    store().setSources(id, []);
    const c = store().getById(id)!;
    expect(c.lifecycle.phases.intake.status).toBe('pending');
    expect(c.status).not.toBe('active');
  });

  it('Scénario 4 — la diffusion (canal publié) NE confirme JAMAIS la réception', () => {
    const id = 'CAMP-E2E-004';
    store().addCampaign({ fdp: validatedFDP(id), scoringSheet: validatedSheet(id) });
    // Aucune source, mais on publie un canal de diffusion.
    store().markPublishedChannel(id, 'linkedin');
    const c = store().getById(id)!;
    expect(c.sources).toEqual([]);
    expect(c.lifecycle.phases.intake.status).toBe('pending');
    expect(store().activateCampaign(id)).toBe(false); // intake toujours manquant
  });

  it('Scénario 5 — réouverture FDP : cascade complète + réinitialisation des artefacts → draft', () => {
    const id = 'CAMP-E2E-005';
    store().addCampaign({ fdp: validatedFDP(id), scoringSheet: validatedSheet(id) });
    store().setSources(id, ['manual']);
    store().activateCampaign(id);
    expect(store().getById(id)?.status).toBe('active');

    store().reopenPhase(id, 'fdp');
    const c = store().getById(id)!;
    // Tout l'aval redescend à pending, les artefacts sont dévalidés.
    expect(c.lifecycle.phases.fdp.status).toBe('pending');
    expect(c.lifecycle.phases.scoring.status).toBe('pending');
    expect(c.lifecycle.phases.intake.status).toBe('pending');
    expect(c.fdp.isValidated).toBe(false);
    expect(c.scoringSheet?.isValidated).toBe(false);
    expect(c.sourcesConfirmed).toBe(false);
    expect(c.status).toBe('draft');
  });

  it('Scénario 6 — pause/reprise : la reprise re-dérive le statut, pas de faux active', () => {
    const id = 'CAMP-E2E-006';
    // Campagne prête puis active.
    store().addCampaign({ fdp: validatedFDP(id), scoringSheet: validatedSheet(id) });
    store().setSources(id, ['manual']);
    store().activateCampaign(id);
    expect(store().getById(id)?.status).toBe('active');

    // Pause : recompute ne la sort jamais de pause.
    store().updateStatus(id, 'paused');
    store().recomputeStatus(id);
    expect(store().getById(id)?.status).toBe('paused');

    // Reprise quand toujours prête → active.
    store().resumeCampaign(id);
    expect(store().getById(id)?.status).toBe('active');

    // On casse le flux pendant que c'est actif, on pause, puis on reprend :
    // la reprise NE force PAS un faux 'active'.
    store().setSources(id, []); // intake rouvert → in_progress
    store().updateStatus(id, 'paused');
    store().resumeCampaign(id);
    expect(store().getById(id)?.status).not.toBe('active');
  });

  it('Scénario 7 — clôture terminale : ni recompute ni activate ne la ressuscitent', () => {
    const id = 'CAMP-E2E-007';
    store().addCampaign({ fdp: validatedFDP(id), scoringSheet: validatedSheet(id) });
    store().setSources(id, ['manual']);
    store().activateCampaign(id);
    store().updateStatus(id, 'closed');

    store().recomputeStatus(id);
    expect(store().getById(id)?.status).toBe('closed');
    // activateCampaign ne s'applique qu'à draft/in_progress.
    expect(store().activateCampaign(id)).toBe(false);
    expect(store().getById(id)?.status).toBe('closed');
  });

  it('Scénario 8 — édition FDP rendue incomplète : la campagne redescend en cadrage', () => {
    const id = 'CAMP-E2E-008';
    store().addCampaign({ fdp: validatedFDP(id), scoringSheet: validatedSheet(id) });
    store().setSources(id, ['manual']);
    store().activateCampaign(id);
    expect(store().getById(id)?.status).toBe('active');

    // Ré-ajout d'une FDP incomplète (simule l'édition dashboard qui dévalide),
    // suivi du recompute (cf. FDPEditBlock.onSave).
    store().addCampaign({ fdp: draftFDP(id), status: store().getById(id)!.status });
    store().recomputeStatus(id);
    const c = store().getById(id)!;
    expect(c.lifecycle.phases.fdp.status).toBe('pending');
    expect(c.status).toBe('draft');
  });
});
