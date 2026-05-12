import { describe, expect, it } from 'vitest';

import {
  buildInterviewGuideSystemPrompt,
  buildInterviewGuideUserPrompt,
  buildMailComposerSystemPrompt,
  buildMailComposerUserPrompt,
} from '@/lib/agents/mail-composer-prompts';
import type { CVAnalysisResult } from '@/types/cv-analysis';

const CANDIDATE: CVAnalysisResult = {
  fileName: 'cv.pdf',
  candidateName: 'Léa Martin',
  email: 'lea.martin@example.com',
  phone: '+33 6 11 22 33 44',
  skills: ['React', 'TypeScript'],
  experienceYears: 4,
  score: 82,
  summary: 'Profil junior+ aligné avec les besoins. Stack JS solide.',
  strengths: ['React', 'Habitudes de tests'],
  weaknesses: ['Pas de senior management'],
  justification: 'Score élevé : stack alignée, expérience cohérente, motivation visible.',
  aboveThreshold: true,
};

describe('buildMailComposerSystemPrompt', () => {
  it('mentions the strict rules and JSON output', () => {
    const p = buildMailComposerSystemPrompt();
    expect(p).toContain('Mail Composer');
    expect(p).toContain('JSON STRICT');
    expect(p).toContain('"subject"');
    expect(p).toContain('"html"');
    expect(p).toMatch(/jamais d.emoji/i);
  });
});

describe('buildMailComposerUserPrompt', () => {
  it('reject mode includes justification and excludes booking url', () => {
    const p = buildMailComposerUserPrompt({
      mode: 'reject',
      candidate: CANDIDATE,
      jobTitle: 'Frontend Engineer',
      campaignId: 'CAMP-1',
    });
    expect(p).toContain('Mode : refus');
    expect(p).toContain('Frontend Engineer');
    expect(p).toContain(CANDIDATE.justification);
    expect(p).not.toContain('cal.com');
    expect(p).not.toContain('Lien Cal.com');
  });

  it('invite mode includes booking url and omits justification recital', () => {
    const p = buildMailComposerUserPrompt({
      mode: 'invite',
      candidate: CANDIDATE,
      jobTitle: 'Frontend Engineer',
      campaignId: 'CAMP-1',
      bookingUrl: 'https://cal.com/qw/30',
    });
    expect(p).toContain('Mode : invitation');
    expect(p).toContain('https://cal.com/qw/30');
    expect(p).toContain(CANDIDATE.summary);
  });
});

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
});

describe('buildInterviewGuideSystemPrompt', () => {
  it('asks for 6 to 8 questions with theme + question', () => {
    const p = buildInterviewGuideSystemPrompt();
    expect(p).toContain('6 à 8');
    expect(p).toContain('"theme"');
    expect(p).toContain('"question"');
  });
});
