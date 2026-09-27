'use client';

/**
 * Quelle section du panneau APEC est ouverte — une seule à la fois.
 *
 * Une vérification qui trouve une erreur OUVRE la section du premier champ
 * fautif : l'encadré rouge ne sert à rien replié. Ajusté PENDANT le rendu, à
 * l'arrivée d'un nouveau rapport — pas dans un effet, qui montrerait une frame
 * la section fermée.
 */
import { useState } from 'react';

import { apecSectionOf } from '@/lib/jobboards/adep/draft-check';
import type { AdepIssue } from '@/lib/jobboards/adep/validate';

import { focusApecField } from './ApecIssueList';

export type ApecSection = 'annonce' | 'exigences';

export function useApecSections(issues: AdepIssue[] | null) {
  const [open, setOpen] = useState<ApecSection | null>(null);
  const [lastIssues, setLastIssues] = useState(issues);
  if (issues !== lastIssues) {
    setLastIssues(issues);
    const first = issues?.find((i) => i.level === 'error' && apecSectionOf(i.field));
    const section = first ? apecSectionOf(first.field) : null;
    if (section) setOpen(section);
  }

  return {
    open,
    setOpen,
    toggle: (section: ApecSection) =>
      setOpen((current) => (current === section ? null : section)),
    /** Mène à un champ : ouvre sa section, puis lui donne le focus. */
    goToField: (field: string) => {
      const section = apecSectionOf(field);
      if (section) setOpen(section);
      focusApecField(field);
    },
  };
}
