import { describe, expect, it } from 'vitest';

import {
  MAX_CV_BYTES,
  buildApplicationHtml,
  buildApplicationSubject,
  validateApplication,
} from '@/lib/jobboard/application-mail';
import { findAllCampaignIdsInText } from '@/lib/imap/campaign-match';

const base = {
  fullName: 'Jean Dupont',
  email: 'Jean.Dupont@Example.COM',
  phone: ' 06 12 34 56 78 ',
  fileName: 'cv-jean.pdf',
  mime: 'application/pdf',
  size: 120_000,
};

describe('validateApplication', () => {
  it('normalise nom, email (minuscules) et téléphone', () => {
    const res = validateApplication(base);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.email).toBe('jean.dupont@example.com');
    expect(res.value.phone).toBe('06 12 34 56 78');
  });

  it('rend le téléphone `null` quand il est vide (jamais une chaîne vide)', () => {
    const res = validateApplication({ ...base, phone: '   ' });
    expect(res.ok && res.value.phone).toBe(null);
  });

  it('refuse une adresse invalide, un nom trop court, un fichier vide', () => {
    expect(validateApplication({ ...base, email: 'pas-une-adresse' })).toMatchObject({
      ok: false,
      code: 'invalid_email',
    });
    expect(validateApplication({ ...base, fullName: 'X' })).toMatchObject({
      ok: false,
      code: 'invalid_name',
    });
    expect(validateApplication({ ...base, size: 0 })).toMatchObject({
      ok: false,
      code: 'empty_cv',
    });
  });

  it('refuse au-delà de la taille maximale', () => {
    expect(validateApplication({ ...base, size: MAX_CV_BYTES + 1 })).toMatchObject({
      ok: false,
      code: 'cv_too_large',
    });
  });

  it('accepte un .docx envoyé en octet-stream (porte MIME OU extension)', () => {
    const res = validateApplication({
      ...base,
      fileName: 'CV Jean.DOCX',
      mime: 'application/octet-stream',
    });
    expect(res.ok).toBe(true);
  });

  it('refuse un format que l’analyse ne saurait pas lire (.doc, .png)', () => {
    expect(
      validateApplication({ ...base, fileName: 'cv.doc', mime: 'application/msword' }),
    ).toMatchObject({ ok: false, code: 'unsupported_format' });
    expect(
      validateApplication({ ...base, fileName: 'photo.png', mime: 'image/png' }),
    ).toMatchObject({ ok: false, code: 'unsupported_format' });
  });
});

describe('objet et corps du mail', () => {
  const campaignId = 'CAMP-2026-511';

  it('le SUJET porte l’identifiant de campagne, retrouvé par le rapprochement', () => {
    const subject = buildApplicationSubject({
      campaignId,
      jobTitle: 'Comptable général confirmé (H/F)',
    });
    expect(subject).toBe(
      'Candidature — Comptable général confirmé (H/F) (CAMP-2026-511)',
    );
    // C'est le contrat qui compte, pas la mise en forme : le poller doit
    // retrouver l'identifiant dans cette chaîne exacte.
    expect(findAllCampaignIdsInText(subject, [campaignId])).toEqual([campaignId]);
  });

  it('le CORPS redit l’identifiant — repli si un client réécrit l’objet', () => {
    const html = buildApplicationHtml({
      campaignId,
      jobTitle: 'Comptable',
      fullName: 'Jean Dupont',
      email: 'jean@example.com',
      phone: null,
    });
    expect(findAllCampaignIdsInText(html, [campaignId])).toEqual([campaignId]);
    expect(html).toContain('jean@example.com');
    expect(html).not.toContain('Téléphone');
  });

  it('échappe le HTML des champs saisis au formulaire', () => {
    const html = buildApplicationHtml({
      campaignId,
      jobTitle: 'Comptable',
      fullName: '<script>alert(1)</script>',
      email: 'a@b.fr',
      phone: '"><b>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;&gt;&lt;b&gt;');
  });
});
