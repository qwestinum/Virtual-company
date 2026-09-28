import { describe, expect, it } from 'vitest';

import { placeOrigin, renderInterviewMail } from '@/lib/interview/mail-templates';
import { countVivierOrigin } from '@/lib/reporting/vivier-origin-counts';
import { vivierInviteNotice } from '@/lib/vivier/invite-notice';
import {
  isVivierAnalysisId,
  vivierAnalysisId,
  vivierCvArtifactId,
  vivierOriginSentence,
  vivierScoreLabel,
  vivierTimelineLabel,
} from '@/lib/vivier/origin';
import type { VivierOrigin } from '@/types/vivier-origin';

const origin: VivierOrigin = {
  vivierCandidateId: 'v1',
  cvDate: '2026-03-12T09:00:00Z',
  cvDateKind: 'application',
  previousJobTitle: 'Chef de projet MOA',
  proposedAt: '2026-09-20T08:00:00Z',
  scoredAt: '2026-09-28T10:00:00Z',
  invitedAt: '2026-09-28T10:00:00Z',
  invitedBy: { id: 'u1', name: 'Jane R.' },
};

describe('identifiants', () => {
  it('une candidature par (campagne, profil), et son CV copié', () => {
    const id = vivierAnalysisId('CAMP-2026-301', 'v1');
    expect(id).toBe('can_viv_CAMP-2026-301_v1');
    expect(vivierCvArtifactId(id)).toBe('art_viv_cv_CAMP-2026-301_v1');
    expect(isVivierAnalysisId(id)).toBe(true);
    expect(isVivierAnalysisId('can_imap_m1_12')).toBe(false);
  });
});

describe('libellés', () => {
  it('le score dit quand et sur quel CV il a été calculé', () => {
    expect(vivierScoreLabel(origin)).toBe(
      'Score de présélection vivier — calculé le 28 septembre 2026 sur le CV du 12 mars 2026',
    );
  });

  it('la frise dit qui a invité et quand', () => {
    expect(vivierTimelineLabel(origin)).toBe(
      'Issu du vivier — proposé le 20 septembre 2026, invité par Jane R. le 28 septembre 2026',
    );
  });

  it('le mail rappelle une candidature d’origine… ou seulement le vivier, jamais une candidature inventée', () => {
    expect(vivierOriginSentence(origin)).toContain('Vous nous aviez adressé votre candidature le 12 mars 2026 pour le poste de Chef de projet MOA');
    const entry = vivierOriginSentence({ ...origin, cvDateKind: 'vivier_entry', previousJobTitle: null });
    expect(entry).toContain('Votre CV figure dans notre vivier de candidats depuis le 12 mars 2026');
    expect(entry).not.toContain('adressé');
  });
});

describe('[origine] dans le modèle d’invitation', () => {
  const vars = { prenom: 'Claire', nom: 'Martin', jobTitle: 'BA', campaignName: 'C', organisation: 'O', recruiterName: 'R', agendaLink: 'L' };

  it('placée par le modèle quand il la contient', () => {
    const out = renderInterviewMail('Bonjour [prénom],\n\n[origine]\n\nChoisissez : [lien d’agenda]', { ...vars, origine: 'ORIGINE.' });
    expect(out).toBe('Bonjour Claire,\n\nORIGINE.\n\nChoisissez : L');
  });

  it('placée après la formule d’appel quand le modèle l’omet', () => {
    expect(placeOrigin('Bonjour,\n\nCorps.', 'ORIGINE.')).toBe('Bonjour,\n\nORIGINE.\n\nCorps.');
  });

  it('vide : la variable disparaît sans paragraphe blanc, un modèle sans elle est intact', () => {
    expect(renderInterviewMail('Bonjour,\n\n[origine]\n\nCorps.', vars)).toBe('Bonjour,\n\nCorps.');
    expect(renderInterviewMail('Bonjour,\n\nCorps.', vars)).toBe('Bonjour,\n\nCorps.');
  });
});

describe('ce que dit l’écran après « Inviter »', () => {
  it('une invitation qui n’est pas partie ne s’annonce jamais envoyée', () => {
    expect(vivierInviteNotice('Claire', 'sent')).toMatchObject({ tone: 'ok' });
    expect(vivierInviteNotice('Claire', 'send_failed').text).toContain('n’est pas partie');
    expect(vivierInviteNotice('Claire', 'skipped').text).toContain('n’est pas partie');
    expect(vivierInviteNotice('Claire', 'duplicate').text).toContain('aucun second message');
  });
});

describe('rapport : origine vivier', () => {
  it('« dont N issues du vivier » et conversion ont réservé / invités', () => {
    const analyses = [
      { id: 'can_viv_C_a', fromVivier: true },
      { id: 'can_viv_C_b', fromVivier: true },
      { id: 'can_imap_m_1', fromVivier: true }, // rapprochée par adresse
      { id: 'can_imap_m_2', fromVivier: false },
    ];
    const stages: Record<string, 'rdv_pris' | 'invite'> = { can_viv_C_a: 'rdv_pris', can_viv_C_b: 'invite' };
    expect(countVivierOrigin(analyses, (id) => stages[id] ?? null)).toEqual({ received: 3, invited: 2, booked: 1 });
    expect(countVivierOrigin([{ id: 'can_imap_m_2', fromVivier: false }], () => null)).toBeNull();
  });
});
