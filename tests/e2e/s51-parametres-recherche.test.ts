/**
 * S51 — PARAMÈTRES : REPLIÉS À CHAQUE ARRIVÉE, RECHERCHE, MANQUES NOMMÉS.
 *
 * Demande du donneur d'ordre (02/10/2026) : la page s'ouvre toujours repliée,
 * une recherche mène directement au réglage, les modèles de messages ont leur
 * famille avec un titre clair par modèle, et l'alerte « réglage manquant » dit
 * LEQUEL et OÙ — avec un lien qui y mène.
 *
 * Tout se prouve en CLIQUANT : un test de logique lirait les identifiants du
 * registre sans voir si la section s'ouvre, ni si « Y aller » y mène.
 *
 * Le manque est FABRIQUÉ en interceptant la LECTURE de /api/settings (clé
 * d'envoi déclarée absente) : le test ne dépend pas de l'état de la base de
 * dev et n'écrit rien.
 */
import type { Browser, Page, Route } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, attendreHydratation, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const MODELES = [
  'Invitation à l’entretien (candidature retenue)',
  'Refus sur CV',
  'Nouveau créneau à choisir',
  'Retenu après l’entretien',
  'Non retenu après l’entretien',
  'Absent à l’entretien',
  'Candidature classée sans suite',
  'Opportunité proposée à un profil du vivier',
  'Invitation à candidater (présélection du vivier)',
];

const sectionButton = (id: string) => `[data-settings-section="${id}"] h2 button`;

async function ouvrirParametres(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-settings-search]', { timeout: 90_000 });
  await attendreHydratation(page, '[data-settings-search]');
}

async function familleOuvertes(page: Page): Promise<string[]> {
  return page.$$eval('[data-settings-group][aria-expanded="true"]', (ns) =>
    ns.map((n) => n.getAttribute('data-settings-group') ?? ''),
  );
}

describe('S51 — Paramètres : pliage, recherche, manques', () => {
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

  it('S51.1 — ce qu’on a ouvert est replié au retour sur la page', async () => {
    await ouvrirParametres(page);
    expect(await familleOuvertes(page)).toEqual([]);

    await page.click('[data-settings-group="Cabinet et DPO"]');
    await page.click(sectionButton('vivier'));
    await page.waitForTimeout(250);
    expect(await page.getAttribute(sectionButton('vivier'), 'aria-expanded')).toBe('true');

    // On part, on revient : tout est replié, sans mémoire de session.
    await page.goto(`${BASE_URL}/aujourdhui`, { waitUntil: 'domcontentloaded' });
    await ouvrirParametres(page);
    expect(await familleOuvertes(page)).toEqual([]);
    expect(await page.locator('[data-settings-section]').count()).toBe(0);
  }, 300_000);

  it('S51.2 — la recherche mène au réglage et ouvre un résultat unique', async () => {
    await ouvrirParametres(page);

    await page.fill('[data-settings-search]', 'cooldown');
    await page.waitForTimeout(250);
    const visibles = await page.$$eval('[data-settings-section]', (ns) =>
      ns.map((n) => n.getAttribute('data-settings-section')),
    );
    expect(visibles).toEqual(['vivier']);
    expect(await page.getAttribute(sectionButton('vivier'), 'aria-expanded')).toBe('true');
    // Le CONTENU est là, pas seulement le titre.
    expect(
      await page.locator('[data-settings-section="vivier"] span:text-is("Cooldown (jours)")').count(),
    ).toBe(1);

    await page.fill('[data-settings-search]', 'zzz-introuvable');
    await page.waitForTimeout(250);
    expect(await page.locator('text=Aucun réglage ne correspond').count()).toBe(1);
    expect(await page.locator('[data-settings-section]').count()).toBe(0);

    // Échap efface : retour à la page repliée.
    await page.press('[data-settings-search]', 'Escape');
    await page.waitForTimeout(250);
    expect(await page.inputValue('[data-settings-search]')).toBe('');
    expect(await familleOuvertes(page)).toEqual([]);
  }, 300_000);

  it('S51.3 — les modèles de messages ont leur famille, un titre par modèle', async () => {
    await ouvrirParametres(page);
    await page.click('[data-settings-group="Modèles de messages"]');
    await page.waitForTimeout(250);
    const titres = await page.$$eval('[data-settings-section^="modele-"] h2 button', (ns) =>
      ns.map((n) => n.querySelector('.font-display')?.textContent?.trim() ?? ''),
    );
    expect(titres).toEqual(MODELES);

    // Un modèle s'ouvre sur son texte et son bouton propre.
    await page.click(sectionButton('modele-refus-cv'));
    await page.waitForTimeout(250);
    const zone = page.locator('[data-settings-section="modele-refus-cv"]');
    expect(await zone.locator('textarea').count()).toBe(1);
    expect(await zone.locator('button:has-text("Enregistrer ce modèle")').count()).toBe(1);
  }, 300_000);

  it('S51.4 — un manque est nommé, situé, et « Y aller » y mène', async () => {
    const context = page.context();
    const intercept = async (route: Route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const json = (await res.json()) as {
        settings: Record<string, unknown> & { interviewConfig: Record<string, unknown> };
      };
      json.settings.resendApiKeyConfigured = false;
      // Le nom de l'organisation est l'« enseigne » exigée par l'Apec.
      json.settings.interviewConfig = { ...json.settings.interviewConfig, organisationName: '' };
      return route.fulfill({ response: res, json });
    };
    await context.route('**/api/settings', intercept);
    try {
      await ouvrirParametres(page);
      const alerte = page.locator('[data-settings-missing]');
      await alerte.waitFor({ timeout: 30_000 });
      const texte = (await alerte.textContent()) ?? '';
      expect(texte).toContain('Clé d’envoi des mails (Resend) absente');
      expect(texte).toContain('Réception & envoi des mails › Service email (Resend)');
      expect(texte).toContain('Nom de l’organisation absent');
      expect(texte).toContain('Cabinet et DPO › Identité du cabinet');

      // « Y aller » sur le nom mène au champ, dans l'identité du cabinet.
      await page.click('[data-settings-goto="identite"]');
      await page.waitForTimeout(800);
      expect(await page.getAttribute(sectionButton('identite'), 'aria-expanded')).toBe('true');
      expect(
        await page.locator('[data-settings-section="identite"] >> text=Nom de l’organisation').count(),
      ).toBeGreaterThan(0);

      await page.click('[data-settings-goto="resend"]');
      await page.waitForTimeout(800);
      expect(await page.getAttribute(sectionButton('resend'), 'aria-expanded')).toBe('true');
      expect(await familleOuvertes(page)).toContain('Réception & envoi des mails');
      const dansVue = await page.$eval('[data-settings-section="resend"]', (el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.top < window.innerHeight;
      });
      expect(dansVue, 'la section n’est pas amenée à l’écran').toBe(true);
    } finally {
      await context.unroute('**/api/settings', intercept);
    }
  }, 300_000);
});
