/**
 * S31 — UN LIBELLÉ SE CLIQUE, ET LE CHAMP PREND LE FOCUS.
 *
 * Le défaut réparé : un libellé en petites capitales grises posé au-dessus
 * d'une zone sans bordure visible. Le mot était la seule chose qui se voyait,
 * donc la chose qu'on cliquait — et le clic ne faisait rien.
 *
 * ⚠️ AUCUN TEST DE LOGIQUE NE PEUT LE DIRE. « Le libellé porte un htmlFor »
 * est une chaîne de caractères ; « le champ prend le focus » est un
 * comportement du navigateur. C'est la même leçon que les portes de campagne
 * (S29) : le clic est le verdict.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';

import { assertAppIsUp, launchBrowser, signIn } from './helpers/browser';
import { ouvrirAssistant } from './helpers/assistant';
import {
  createTestRecruiter,
  deleteTestRecruiter,
  type TestRecruiter,
} from './helpers/session';

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;

beforeAll(async () => {
  await assertAppIsUp();
  recruiter = await createTestRecruiter();
  browser = await launchBrowser();
  page = await signIn(browser, recruiter);
  await ouvrirAssistant(page);
}, 300_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  if (recruiter) await deleteTestRecruiter(recruiter);
});

/** L'élément qui a le focus, décrit par ce qui permet de l'identifier. */
async function focus(p: Page): Promise<{ tag: string; id: string }> {
  return p.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { tag: el?.tagName.toLowerCase() ?? '', id: el?.id ?? '' };
  });
}

describe('S31 — les champs du formulaire de campagne', () => {
  it('S31.1 — cliquer le libellé donne le focus au champ', async () => {
    // Trois formes de contrôle, une seule promesse.
    for (const [champ, attendu] of [
      ['job_title', 'input'],
      ['seniority', 'select'],
      ['main_missions', 'textarea'],
    ] as const) {
      // On repart d'ailleurs à chaque fois : sinon le focus précédent
      // ferait passer un libellé muet pour un libellé qui marche.
      await page.locator('h1').first().click();
      const libelle = page.locator(`[data-field="${champ}"] label`);
      await libelle.click();
      const actif = await focus(page);
      expect(actif.tag, `${champ} : le clic sur le libellé doit donner le focus`).toBe(attendu);
      expect(actif.id).toBe(`fdp-${champ}`);
    }
  }, 180_000);

  it('S31.2 — l’exemple est DANS le champ, jamais au-dessus', async () => {
    // Au-dessus, un exemple se lit comme une valeur déjà saisie.
    const exemple = await page
      .locator('[data-field="job_title"] input')
      .getAttribute('placeholder');
    expect(exemple).toContain('ex.');
    const texteAuDessus = await page.locator('[data-field="job_title"] label').textContent();
    expect(texteAuDessus).not.toContain('ex.');
  }, 180_000);

  it('S31.3 — le champ se VOIT : bordure opaque, hauteur de frappe, anneau au focus', async () => {
    const champ = page.locator('[data-field="job_title"] input');
    const avant = await champ.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        bordure: s.borderTopColor,
        largeur: s.borderTopWidth,
        hauteur: el.getBoundingClientRect().height,
        ombre: s.boxShadow,
      };
    });
    expect(avant.largeur).toBe('1px');
    // Une bordure transparente ou absente est précisément le défaut d'origine.
    expect(avant.bordure).not.toContain('rgba(0, 0, 0, 0)');
    expect(avant.hauteur).toBeGreaterThanOrEqual(38);

    await champ.focus();
    const apres = await champ.evaluate((el) => getComputedStyle(el).boxShadow);
    // L'anneau est un SECOND signal : une simple bascule de teinte ne se
    // perçoit pas quand on distingue mal les couleurs.
    expect(apres).not.toBe(avant.ombre);
    expect(apres).not.toBe('none');
  }, 180_000);

  it('S31.4 — les libellés obligatoires le disent à voix haute, pas qu’en orange', async () => {
    // L'étoile est décorative (aria-hidden) : c'est le texte qui porte
    // l'information pour une synthèse vocale.
    const texte = await page
      .locator('[data-field="job_title"] label')
      .evaluate((el) => el.textContent ?? '');
    expect(texte).toContain('obligatoire');
  }, 180_000);
});
