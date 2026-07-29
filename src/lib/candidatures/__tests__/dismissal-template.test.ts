import { describe, expect, it } from 'vitest';

import {
  dismissalTextToHtml,
  renderDismissalMail,
} from '@/lib/candidatures/dismissal-template';
import {
  DISMISSAL_MAIL_POLICY,
  DISMISSAL_REASONS,
  dismissalMailAllowed,
} from '@/types/dismissal';

const VARS = {
  prenom: 'Jane',
  jobTitle: 'Dev backend',
  organisation: 'ACME',
  rgpdContact: 'jobs@acme.com',
};

describe('renderDismissalMail', () => {
  it('poste_pourvu : mail sobre, jamais un refus, RGPD systématique', () => {
    const mail = renderDismissalMail('poste_pourvu', VARS);
    expect(mail).not.toBeNull();
    expect(mail!.subject).toContain('Dev backend');
    expect(mail!.text).toContain('Jane');
    expect(mail!.text).toContain('pourvu');
    expect(mail!.text).toContain('ne présage en rien');
    expect(mail!.text).toContain('vivier de candidatures'); // mention RGPD
    expect(mail!.text).toContain('jobs@acme.com');
    // Vocabulaire d'évaluation interdit : ce n'est PAS un refus.
    expect(mail!.text.toLowerCase()).not.toContain('refus');
    expect(mail!.text.toLowerCase()).not.toContain('retenu');
  });

  it('campagne_cloturee et sans_reponse et candidat_retire ont un corps', () => {
    for (const reason of ['campagne_cloturee', 'sans_reponse', 'candidat_retire'] as const) {
      const mail = renderDismissalMail(reason, VARS);
      expect(mail, reason).not.toBeNull();
      expect(mail!.text).toContain('ACME');
    }
  });

  it('doublon / invalide : JAMAIS de mail (null)', () => {
    expect(renderDismissalMail('doublon', VARS)).toBeNull();
    expect(renderDismissalMail('invalide', VARS)).toBeNull();
  });

  it('la matrice et le template sont alignés (mailable ⇔ corps présent)', () => {
    for (const reason of DISMISSAL_REASONS) {
      const mail = renderDismissalMail(reason, VARS);
      expect(mail !== null, reason).toBe(dismissalMailAllowed(reason));
    }
  });

  it('matrice validée : cochés / décoché / jamais', () => {
    expect(DISMISSAL_MAIL_POLICY.campagne_cloturee).toBe('checked');
    expect(DISMISSAL_MAIL_POLICY.poste_pourvu).toBe('checked');
    expect(DISMISSAL_MAIL_POLICY.sans_reponse).toBe('checked');
    expect(DISMISSAL_MAIL_POLICY.candidat_retire).toBe('unchecked');
    expect(DISMISSAL_MAIL_POLICY.doublon).toBe('never');
    expect(DISMISSAL_MAIL_POLICY.invalide).toBe('never');
  });
});

describe('dismissalTextToHtml', () => {
  it('paragraphes + échappement HTML', () => {
    const html = dismissalTextToHtml('Bonjour <Jane>,\n\nLigne 1\nLigne 2');
    expect(html).toBe('<p>Bonjour &lt;Jane&gt;,</p>\n<p>Ligne 1<br/>Ligne 2</p>');
  });
});
