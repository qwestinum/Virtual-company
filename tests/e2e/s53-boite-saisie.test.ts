/**
 * S53 — CRÉER UNE BOÎTE SANS INTITULÉ SE DIT EN FRANÇAIS.
 *
 * Défaut signalé le 03/10/2026 : « Créer » sans intitulé affichait le message
 * brut du validateur (tableau JSON, `too_small`, `path`). Désormais le
 * formulaire nomme les champs vides AVANT l'envoi, avec les libellés de
 * l'écran — et ne crée rien.
 */
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, attendreHydratation, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

describe('S53 — boîte de réception : saisie incomplète', () => {
  let browser: Browser;
  let recruiter: TestRecruiter;
  let page: Page;

  beforeAll(async () => {
    await assertAppIsUp();
    browser = await launchBrowser();
    recruiter = await createTestRecruiter();
    page = await signIn(browser, recruiter);
  }, 300_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    if (recruiter) await deleteTestRecruiter(recruiter);
  });

  it('S53.1 — « Créer » sans intitulé nomme le champ, sans rien de technique', async () => {
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-settings-group="Réception & envoi des mails"]', {
      timeout: 90_000,
    });
    await attendreHydratation(page, '[data-settings-group="Réception & envoi des mails"]');
    await page.click('[data-settings-group="Réception & envoi des mails"]');
    await page.click('[data-settings-section="boites"] h2 button');
    await page.click('button:has-text("Ajouter une boîte")');

    // Tout rempli SAUF l'intitulé — le cas signalé.
    await page.fill('input[placeholder="imap.gmail.com"]', 'imap.exemple.fr');
    await page.fill('input[placeholder="recrutement@qwestinum.fr"]', 's53@exemple.fr');
    await page.fill('[data-settings-section="boites"] input[type="password"]', 'secret');

    let posted = false;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/mailboxes$/.test(r.url())) posted = true;
    });
    await page.click('[data-settings-section="boites"] button:has-text("Créer")');

    const erreur = page.locator('[data-settings-section="boites"] .bg-red-50');
    await erreur.waitFor({ timeout: 10_000 });
    const texte = (await erreur.textContent())?.trim() ?? '';
    expect(texte).toBe('Renseignez le champ « Intitulé » pour continuer.');
    expect(texte).not.toMatch(/too_small|path|expected|\[|HTTP/);
    // Rien n'est parti : la vérification se fait AVANT l'envoi.
    expect(posted).toBe(false);
  }, 300_000);
});
