import { describe, expect, it } from 'vitest';

import {
  buildInterviewGuideSystemPrompt,
  buildInterviewGuideUserPrompt,
} from '@/lib/agents/mail-composer-prompts';
import type { MailCandidate } from '@/types/mail-candidate';

const CANDIDATE: MailCandidate = {
  candidateName: 'Léa Martin',
  email: 'lea.martin@example.com',
  phone: '+33 6 11 22 33 44',
  score: 82,
  aboveThreshold: true,
  summary: 'Profil junior+ aligné avec les besoins. Stack JS solide.',
  strengths: ['React', 'Habitudes de tests'],
  weaknesses: ['Pas de senior management'],
  justification: 'Score élevé : stack alignée, expérience cohérente, motivation visible.',
};

describe('buildInterviewGuideUserPrompt', () => {
  it('includes candidate context for the interview guide', () => {
    const p = buildInterviewGuideUserPrompt({
      candidate: CANDIDATE,
      jobTitle: 'Frontend Engineer',
      campaignId: 'CAMP-1',
    });
    expect(p).toContain('Léa Martin');
    expect(p).toContain('82/100');
    expect(p).toContain('Frontend Engineer');
    expect(p).toContain(CANDIDATE.justification);
  });

  it('candidat REPÊCHÉ (sous le seuil) : reformule, n’expose pas le verdict de rejet', () => {
    const repeche: MailCandidate = {
      ...CANDIDATE,
      aboveThreshold: false,
      justification: 'Écarté — critère obligatoire XRAY non rempli.',
    };
    const p = buildInterviewGuideUserPrompt({
      candidate: repeche,
      jobTitle: 'Frontend Engineer',
      campaignId: 'CAMP-1',
    });
    expect(p).toMatch(/REPÊCHAGE|DÉCISION HUMAINE/);
    // Le verdict d'écartage n'est PAS diffusé.
    expect(p).not.toContain(repeche.justification);
    // Les faiblesses deviennent des points à explorer, pas un motif de rejet.
    expect(p).toContain('Points à explorer en entretien');
  });
});

describe('buildInterviewGuideSystemPrompt', () => {
  it('asks for 6 to 8 questions with theme + question', () => {
    const p = buildInterviewGuideSystemPrompt();
    expect(p).toContain('6 à 8');
    expect(p).toContain('"theme"');
    expect(p).toContain('"question"');
  });

  it('interdit l’extrapolation/hallucination de domaine ou d’expérience', () => {
    const p = buildInterviewGuideSystemPrompt();
    expect(p).toMatch(/anti-hallucination|ANCRAGE STRICT/i);
    expect(p).toMatch(/extrapolation/i);
    expect(p).toMatch(/VÉRIFIER/);
  });
});
