import { describe, expect, it } from 'vitest';

import {
  applyTransition,
  availableActions,
  buildLifecycle,
  canActivate,
  currentPhase,
  dependenciesMet,
  deriveActiveStatus,
  lifecycleFromLegacy,
  missingDependencies,
  nextFlowStep,
  parseLifecycle,
  reconcileLifecycle,
  transitiveDependents,
} from '@/lib/campaign/lifecycle';
import {
  PHASE_IDS,
  type CampaignLifecycle,
  type LifecycleResult,
} from '@/types/campaign-lifecycle';

/** Helper : extrait la machine d'un résultat OK (échoue le test sinon). */
function unwrap(result: LifecycleResult): CampaignLifecycle {
  if (!result.ok) {
    throw new Error(`transition refusée: ${JSON.stringify(result.error)}`);
  }
  return result.lifecycle;
}

describe('buildLifecycle', () => {
  it('part FDP=done, tout l’aval pending, required cohérent', () => {
    const lc = buildLifecycle();
    expect(lc.phases.fdp.status).toBe('done');
    for (const id of ['scoring', 'intake', 'announcement', 'publication'] as const) {
      expect(lc.phases[id].status).toBe('pending');
    }
    expect(lc.phases.fdp.required).toBe(true);
    expect(lc.phases.scoring.required).toBe(true);
    expect(lc.phases.intake.required).toBe(true);
    expect(lc.phases.announcement.required).toBe(false);
    expect(lc.phases.publication.required).toBe(false);
  });

  it('applique les overrides', () => {
    const lc = buildLifecycle({ scoring: 'done', announcement: 'postponed' });
    expect(lc.phases.scoring.status).toBe('done');
    expect(lc.phases.announcement.status).toBe('postponed');
  });
});

describe('parseLifecycle', () => {
  it('accepte une machine valide et la re-projette dans l’ordre canonique', () => {
    const lc = buildLifecycle({ scoring: 'in_progress' });
    const parsed = parseLifecycle(lc);
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!.phases)).toEqual([...PHASE_IDS]);
    expect(parsed!.phases.scoring.status).toBe('in_progress');
  });

  it('rejette une machine incomplète (phase manquante)', () => {
    const broken = { phases: { fdp: { id: 'fdp', status: 'done', required: true } } };
    expect(parseLifecycle(broken)).toBeNull();
  });

  it('rejette un required incohérent', () => {
    const lc = buildLifecycle();
    const broken = {
      phases: { ...lc.phases, scoring: { ...lc.phases.scoring, required: false } },
    };
    expect(parseLifecycle(broken)).toBeNull();
  });

  it('rejette un statut inconnu et une valeur non-objet', () => {
    const lc = buildLifecycle();
    const broken = {
      phases: { ...lc.phases, fdp: { ...lc.phases.fdp, status: 'launched' } },
    };
    expect(parseLifecycle(broken)).toBeNull();
    expect(parseLifecycle(null)).toBeNull();
    expect(parseLifecycle('nope')).toBeNull();
  });
});

describe('dépendances', () => {
  it('missingDependencies / dependenciesMet', () => {
    const fresh = buildLifecycle({ fdp: 'pending' });
    expect(missingDependencies(fresh, 'scoring')).toEqual(['fdp']);
    expect(dependenciesMet(fresh, 'scoring')).toBe(false);
    expect(dependenciesMet(fresh, 'fdp')).toBe(true);

    const fdpDone = buildLifecycle();
    expect(dependenciesMet(fdpDone, 'scoring')).toBe(true);
    expect(dependenciesMet(fdpDone, 'publication')).toBe(false); // announcement pas done
  });

  it('transitiveDependents', () => {
    expect(new Set(transitiveDependents('fdp'))).toEqual(
      new Set(['scoring', 'intake', 'announcement', 'publication']),
    );
    expect(transitiveDependents('announcement')).toEqual(['publication']);
    expect(transitiveDependents('scoring')).toEqual([]);
    expect(transitiveDependents('publication')).toEqual([]);
  });
});

describe('currentPhase', () => {
  it('suit l’ordre canonique', () => {
    expect(currentPhase(buildLifecycle())).toBe('scoring');
    expect(currentPhase(buildLifecycle({ scoring: 'done' }))).toBe('intake');
    expect(
      currentPhase(buildLifecycle({ scoring: 'done', intake: 'done' })),
    ).toBe('announcement');
  });

  it('saute une phase dont les dépendances ne sont pas faites', () => {
    // annonce reportée → publication bloquée (dep non done) → plus de phase courante
    const lc = buildLifecycle({
      scoring: 'done',
      intake: 'done',
      announcement: 'postponed',
    });
    expect(currentPhase(lc)).toBeNull();
  });

  it('null quand tout est réglé', () => {
    const lc = buildLifecycle({
      scoring: 'done',
      intake: 'done',
      announcement: 'done',
      publication: 'done',
    });
    expect(currentPhase(lc)).toBeNull();
  });
});

describe('availableActions', () => {
  it('phase obligatoire pending avec deps faites → configure', () => {
    expect(availableActions(buildLifecycle(), 'scoring')).toEqual(['configure']);
  });

  it('phase optionnelle pending → configure + postpone', () => {
    const lc = buildLifecycle({ scoring: 'done', intake: 'done' });
    expect(availableActions(lc, 'announcement')).toEqual(['configure', 'postpone']);
  });

  it('phase verrouillée (deps non faites) → aucune action', () => {
    expect(availableActions(buildLifecycle(), 'publication')).toEqual([]);
  });

  it('in_progress → validate (+ postpone si optionnelle)', () => {
    expect(availableActions(buildLifecycle({ scoring: 'in_progress' }), 'scoring')).toEqual([
      'validate',
    ]);
    const lc = buildLifecycle({
      scoring: 'done',
      intake: 'done',
      announcement: 'in_progress',
    });
    expect(availableActions(lc, 'announcement')).toEqual(['validate', 'postpone']);
  });

  it('done → adjust + reopen ; postponed → configure + reopen', () => {
    expect(availableActions(buildLifecycle(), 'fdp')).toEqual(['adjust', 'reopen']);
    const lc = buildLifecycle({ scoring: 'done', intake: 'done', announcement: 'postponed' });
    expect(availableActions(lc, 'announcement')).toEqual(['configure', 'reopen']);
  });
});

describe('deriveActiveStatus', () => {
  it('draft tant que la FDP n’est pas done', () => {
    expect(deriveActiveStatus(buildLifecycle({ fdp: 'pending' }))).toBe('draft');
    expect(deriveActiveStatus(buildLifecycle({ fdp: 'in_progress' }))).toBe('draft');
  });

  it('in_progress tant qu’une obligatoire ou une optionnelle reste à régler', () => {
    expect(deriveActiveStatus(buildLifecycle())).toBe('in_progress');
    expect(
      deriveActiveStatus(buildLifecycle({ scoring: 'done', intake: 'done' })),
    ).toBe('in_progress'); // annonce/publication encore pending
  });

  it('active quand obligatoires done + optionnelles done OU postponed', () => {
    expect(
      deriveActiveStatus(
        buildLifecycle({
          scoring: 'done',
          intake: 'done',
          announcement: 'done',
          publication: 'done',
        }),
      ),
    ).toBe('active');
    // lancée SANS publication : annonce + publication remises à plus tard
    expect(
      deriveActiveStatus(
        buildLifecycle({
          scoring: 'done',
          intake: 'done',
          announcement: 'postponed',
          publication: 'postponed',
        }),
      ),
    ).toBe('active');
    // annonce faite mais publication remise à plus tard → active aussi
    expect(
      deriveActiveStatus(
        buildLifecycle({
          scoring: 'done',
          intake: 'done',
          announcement: 'done',
          publication: 'postponed',
        }),
      ),
    ).toBe('active');
  });
});

describe('applyTransition — légalité', () => {
  it('start : pending → in_progress (deps OK)', () => {
    const lc = unwrap(applyTransition(buildLifecycle(), { kind: 'start', phaseId: 'scoring' }));
    expect(lc.phases.scoring.status).toBe('in_progress');
  });

  it('start refusé si dépendances non faites', () => {
    const res = applyTransition(buildLifecycle({ fdp: 'pending' }), {
      kind: 'start',
      phaseId: 'scoring',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('dependency_not_met');
      if (res.error.code === 'dependency_not_met') {
        expect(res.error.missing).toEqual(['fdp']);
      }
    }
  });

  it('complete : in_progress → done', () => {
    const started = unwrap(
      applyTransition(buildLifecycle(), { kind: 'start', phaseId: 'scoring' }),
    );
    const done = unwrap(applyTransition(started, { kind: 'complete', phaseId: 'scoring' }));
    expect(done.phases.scoring.status).toBe('done');
  });

  it('postpone refusé sur une phase obligatoire', () => {
    const res = applyTransition(buildLifecycle(), { kind: 'postpone', phaseId: 'scoring' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('cannot_postpone_required');
  });

  it('postpone OK sur une phase optionnelle', () => {
    const lc = buildLifecycle({ scoring: 'done', intake: 'done' });
    const res = unwrap(applyTransition(lc, { kind: 'postpone', phaseId: 'announcement' }));
    expect(res.phases.announcement.status).toBe('postponed');
  });

  it('transition illégale (complete depuis done) → illegal_transition', () => {
    const res = applyTransition(buildLifecycle(), { kind: 'complete', phaseId: 'fdp' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('illegal_transition');
  });

  it('phase inconnue → unknown_phase', () => {
    const res = applyTransition(buildLifecycle(), {
      kind: 'start',
      // @ts-expect-error test d'une clé hors enum
      phaseId: 'nope',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('unknown_phase');
  });
});

describe('applyTransition — reopen avec cascade', () => {
  it('rouvrir la FDP redescend TOUT l’aval réglé à pending', () => {
    const full = buildLifecycle({
      scoring: 'done',
      intake: 'done',
      announcement: 'done',
      publication: 'postponed',
    });
    const reopened = unwrap(applyTransition(full, { kind: 'reopen', phaseId: 'fdp' }));
    expect(reopened.phases.fdp.status).toBe('pending');
    expect(reopened.phases.scoring.status).toBe('pending');
    expect(reopened.phases.intake.status).toBe('pending');
    expect(reopened.phases.announcement.status).toBe('pending');
    expect(reopened.phases.publication.status).toBe('pending');
  });

  it('rouvrir l’annonce redescend la publication, pas le scoring', () => {
    const full = buildLifecycle({
      scoring: 'done',
      intake: 'done',
      announcement: 'done',
      publication: 'done',
    });
    const reopened = unwrap(
      applyTransition(full, { kind: 'reopen', phaseId: 'announcement' }),
    );
    expect(reopened.phases.announcement.status).toBe('pending');
    expect(reopened.phases.publication.status).toBe('pending');
    expect(reopened.phases.scoring.status).toBe('done'); // intact
    expect(reopened.phases.intake.status).toBe('done'); // intact
  });

  it('reopen refusé si la phase n’est ni done ni postponed', () => {
    const res = applyTransition(buildLifecycle(), { kind: 'reopen', phaseId: 'scoring' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('illegal_transition');
  });

  it('ne mute jamais l’entrée (immutabilité)', () => {
    const lc = buildLifecycle();
    applyTransition(lc, { kind: 'start', phaseId: 'scoring' });
    expect(lc.phases.scoring.status).toBe('pending');
  });
});

describe('lifecycleFromLegacy (bridge Inc. 0)', () => {
  it('mappe les booléens legacy vers la machine', () => {
    const lc = lifecycleFromLegacy({
      fdpValidated: true,
      scoringValidated: true,
      sourcesConfirmed: true,
      hasPublishedChannel: true,
    });
    expect(deriveActiveStatus(lc)).toBe('active');
  });

  it('FDP validée seule → in_progress', () => {
    const lc = lifecycleFromLegacy({
      fdpValidated: true,
      scoringValidated: false,
      sourcesConfirmed: false,
      hasPublishedChannel: false,
    });
    expect(deriveActiveStatus(lc)).toBe('in_progress');
    expect(currentPhase(lc)).toBe('scoring');
  });

  it('scoring en cours reflété en in_progress', () => {
    const lc = lifecycleFromLegacy({
      fdpValidated: true,
      scoringValidated: false,
      scoringStarted: true,
      sourcesConfirmed: false,
      hasPublishedChannel: false,
    });
    expect(lc.phases.scoring.status).toBe('in_progress');
  });
});

describe('nextFlowStep', () => {
  it('suit l’ordre canonique FDP→Scoring→Flux→Annonce→Publication', () => {
    expect(nextFlowStep(buildLifecycle()).kind).toBe('scoring');
    expect(nextFlowStep(buildLifecycle({ scoring: 'done' })).kind).toBe('intake');
    expect(
      nextFlowStep(buildLifecycle({ scoring: 'done', intake: 'done' })).kind,
    ).toBe('announcement');
    expect(
      nextFlowStep(
        buildLifecycle({ scoring: 'done', intake: 'done', announcement: 'done' }),
      ).kind,
    ).toBe('publication');
  });

  it('collect-fdp quand la FDP est rouverte', () => {
    expect(nextFlowStep(buildLifecycle({ fdp: 'pending' })).kind).toBe('collect-fdp');
  });

  it('launched quand tout est réglé (annonce/publication reportées)', () => {
    const step = nextFlowStep(
      buildLifecycle({
        scoring: 'done',
        intake: 'done',
        announcement: 'postponed',
        publication: 'postponed',
      }),
    );
    expect(step.kind).toBe('launched');
    expect(step.phase).toBeNull();
  });

  it('expose les actions légales de la phase (annonce optionnelle → postpone)', () => {
    const step = nextFlowStep(buildLifecycle({ scoring: 'done', intake: 'done' }));
    expect(step.kind).toBe('announcement');
    expect(step.actions).toContain('postpone');
  });
});

describe('reconcileLifecycle', () => {
  const allDone = {
    fdpValidated: true,
    scoringValidated: true,
    sourcesConfirmed: true,
    hasPublishedChannel: true,
  };

  it('sans prev = projection pure des booléens (comportement actuel)', () => {
    expect(reconcileLifecycle(null, allDone)).toEqual(lifecycleFromLegacy(allDone));
  });

  it('annonce/publication sont PILOTÉES PAR TRANSITIONS : prev préservé, jamais forcé par le booléen', () => {
    // 2c-3 : un postponed explicite N'EST PAS écrasé par hasPublishedChannel
    // (les booléens ne pilotent plus ces deux phases).
    const prev = buildLifecycle({
      scoring: 'done',
      intake: 'done',
      announcement: 'postponed',
      publication: 'postponed',
    });
    const next = reconcileLifecycle(prev, allDone);
    expect(next.phases.announcement.status).toBe('postponed');
    expect(next.phases.publication.status).toBe('postponed');
  });

  it('pont legacy : SANS prev, hasPublishedChannel pilote annonce/publication (reload storage)', () => {
    expect(reconcileLifecycle(null, allDone).phases.announcement.status).toBe('done');
    expect(reconcileLifecycle(null, allDone).phases.publication.status).toBe('done');
    const noPub = { ...allDone, hasPublishedChannel: false };
    expect(reconcileLifecycle(null, noPub).phases.announcement.status).toBe('pending');
  });

  it('PRÉSERVE un postponed quand l’artefact reste absent', () => {
    const prev = buildLifecycle({
      scoring: 'done',
      intake: 'done',
      announcement: 'postponed',
      publication: 'postponed',
    });
    const next = reconcileLifecycle(prev, {
      fdpValidated: true,
      scoringValidated: true,
      sourcesConfirmed: true,
      hasPublishedChannel: false, // toujours pas publié
    });
    expect(next.phases.announcement.status).toBe('postponed');
    expect(next.phases.publication.status).toBe('postponed');
    // → campagne lancée malgré l'absence de publication
    expect(deriveActiveStatus(next)).toBe('active');
  });

  it('annonce/publication done sont PRÉSERVÉES même sans publishedChannels (annonce rédigée, pas publiée)', () => {
    // Cas 2c-3 : annonce RÉDIGÉE (done via completePhase) mais publication
    // pas encore faite → hasPublishedChannel false ne doit PAS redescendre
    // l'annonce. Seul applyTransition('reopen') la rouvre.
    const prev = buildLifecycle({
      scoring: 'done',
      intake: 'done',
      announcement: 'done',
      publication: 'pending',
    });
    const next = reconcileLifecycle(prev, {
      fdpValidated: true,
      scoringValidated: true,
      sourcesConfirmed: true,
      hasPublishedChannel: false,
    });
    expect(next.phases.announcement.status).toBe('done');
    expect(next.phases.publication.status).toBe('pending');
  });
});

describe('canActivate', () => {
  it('refuse une campagne fraîche et ne liste QUE les obligatoires manquantes', () => {
    // buildLifecycle : fdp done, scoring/intake/annonce/publication pending.
    const r = canActivate(buildLifecycle());
    expect(r.ok).toBe(false);
    // Les optionnelles (annonce/publication) NE bloquent PAS.
    expect(r.missing).toEqual(['scoring', 'intake']);
  });

  it('autorise dès que les obligatoires sont done, même optionnelles pending', () => {
    const lc = buildLifecycle({
      scoring: 'done',
      intake: 'done',
      announcement: 'pending',
      publication: 'pending',
    });
    const r = canActivate(lc);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('autorise aussi quand les optionnelles sont postponed', () => {
    const lc = buildLifecycle({
      scoring: 'done',
      intake: 'done',
      announcement: 'postponed',
      publication: 'postponed',
    });
    expect(canActivate(lc).ok).toBe(true);
    // Ici la machine dérive déjà 'active'.
    expect(deriveActiveStatus(lc)).toBe('active');
  });

  it('refuse si la FDP n\'est pas done (campagne draft)', () => {
    const lc = buildLifecycle({ fdp: 'in_progress' });
    const r = canActivate(lc);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('fdp');
  });
});
