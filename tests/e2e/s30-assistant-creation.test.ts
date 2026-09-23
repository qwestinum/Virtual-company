/**
 * S30 — L'ASSISTANT DE CRÉATION, CLIQUÉ.
 *
 * Six étapes, et la promesse qui les tient : **le flux EST la sauvegarde**. Ce
 * qu'on vérifie ici n'est pas un rendu, ce sont des TRANSITIONS — « Suivant »
 * qui bloque en nommant ce qui manque, « Suivant » qui fait exister la campagne
 * EN BASE, le retour par le rail, fermer/revenir qui reprend là où on en était,
 * et le récapitulatif qui active pour de bon.
 *
 * ⚠️ La vérification de persistance se fait EN BASE, pas à l'écran : une bande
 * verte qui dit « enregistré » est exactement ce qu'un bug de plus produirait.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { BASE_URL } from './setup';
import { assertAppIsUp, launchBrowser, signIn } from './helpers/browser';
import {
  ASSISTANT_URL,
  bouchonnerLesPropositions,
  ouvrirAssistant,
  bandeEnregistrement,
  cliquerSuivant,
  etapeCourante,
  etapeDuRail,
  raison,
  remplirLePoste,
  suivant,
} from './helpers/assistant';
import {
  createTestRecruiter,
  deleteTestRecruiter,
  type TestRecruiter,
} from './helpers/session';

const INTITULE = `Développeur S30 ${Date.now()}`;

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;
let db: SupabaseClient;
/** Identifiant de la campagne créée par le test — effacée en fin de fichier. */
let campaignId: string | null = null;
/** Second brouillon, créé par le scénario d'abandon — effacé comme le premier. */
let abandonne: string | null = null;

async function ligne(): Promise<{ status: string; name: string } | null> {
  if (!campaignId) return null;
  const { data } = await db
    .from('campaigns')
    .select('id, name, status')
    .eq('id', campaignId)
    .maybeSingle();
  return data ? { status: data.status as string, name: data.name as string } : null;
}

beforeAll(async () => {
  await assertAppIsUp();
  db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  recruiter = await createTestRecruiter();
  browser = await launchBrowser();
  page = await signIn(browser, recruiter);
}, 300_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  // La campagne d'essai ne reste PAS : elle compterait dans les écrans de
  // demain, et un test qui laisse des traces finit par se tester lui-même.
  for (const id of [campaignId, abandonne]) {
    if (id) await db.from('campaigns').delete().eq('id', id).then(() => {});
  }
  if (recruiter) await deleteTestRecruiter(recruiter);
});

describe('S30 — l’assistant de création', () => {
  it('S30.1 — les deux raccourcis mènent à la MÊME adresse', async () => {
    for (const depuis of ['/campagnes', '/aujourdhui']) {
      await page.goto(`${BASE_URL}${depuis}`, { waitUntil: 'domcontentloaded' });
      const bouton = page.locator('a[aria-label="Ajouter une nouvelle campagne"]').first();
      await bouton.waitFor({ timeout: 90_000 });
      await bouton.click();
      await page.waitForURL((u) => u.pathname === '/campagnes/nouvelle', { timeout: 60_000 });
    }
  }, 180_000);

  it('S30.2 — « Suivant » bloque et NOMME ce qui manque', async () => {
    await ouvrirAssistant(page);

    expect(await suivant(page).isDisabled()).toBe(true);
    expect(await raison(page).textContent()).toContain('intitulé du poste');
    // Rien n'est enregistré tant qu'on n'a pas passé l'étape — et l'écran le dit.
    expect(await bandeEnregistrement(page).getAttribute('data-saved')).toBe('false');

    // L'intitulé seul ne suffit pas : la fiche de poste entière est exigée,
    // sinon l'activation échouerait au bout du parcours.
    await page.locator('[data-field="job_title"] input, [data-field="job_title"] textarea').first().fill(INTITULE);
    await page.waitForTimeout(400);
    expect(await suivant(page).isDisabled()).toBe(true);
    expect(await raison(page).textContent()).toContain('Il manque :');

    await remplirLePoste(page, INTITULE);
    await page.waitForTimeout(400);
    expect(await suivant(page).isEnabled()).toBe(true);
  }, 180_000);

  it('S30.2bis — « Proposer le reste de la fiche » ne remplit QUE les vides', async () => {
    await bouchonnerLesPropositions(page);
    // Une valeur déjà saisie ne doit pas bouger : ce que le recruteur a écrit
    // prime sur ce que le modèle propose, toujours.
    const localisation = page
      .locator('[data-field="location"] input, [data-field="location"] textarea')
      .first();
    await localisation.fill('Paris (hybride)');
    await localisation.blur();
    const salaire = page
      .locator('[data-field="salary_range"] input, [data-field="salary_range"] textarea')
      .first();
    await salaire.fill('');
    await salaire.blur();
    await page.waitForTimeout(300);

    await page.locator('[data-role="propose-fdp"]').click();
    await expect
      .poll(() => salaire.inputValue(), { timeout: 30_000 })
      .toContain('proposé');
    expect(await localisation.inputValue()).toBe('Paris (hybride)');

    // On remet ce que le scénario suivant attend.
    await localisation.fill('Paris (hybride)');
    await salaire.fill('45 – 55 k€');
    await salaire.blur();
    await page.waitForTimeout(300);
    expect(await suivant(page).isEnabled()).toBe(true);
  }, 180_000);

  it('S30.3 — le premier « Suivant » fait EXISTER la campagne en base', async () => {
    await cliquerSuivant(page, 'criteres');
    expect(await bandeEnregistrement(page).getAttribute('data-saved')).toBe('true');

    const texte = await bandeEnregistrement(page).textContent();
    const trouve = texte?.match(/CAMP-\d{4}-\d{3}/)?.[0] ?? null;
    expect(trouve, 'la bande doit NOMMER le brouillon').not.toBeNull();
    campaignId = trouve;

    // ⚠️ En BASE, pas à l'écran.
    const row = await ligne();
    expect(row?.status).toBe('draft');
    expect(row?.name).toBe(INTITULE);

    // Le grand titre cesse d'être générique : il porte l'intitulé et la
    // référence — sans quoi trois brouillons ouverts se ressemblent tous.
    const titre = await page.locator('h1').first().textContent();
    expect(titre).toContain(INTITULE);
    expect(titre).toContain(campaignId!);
  }, 180_000);

  it('S30.3bis — « Proposer la grille » remplace les critères, sous un bandeau MAÎTRE', async () => {
    // L'étape « Ce qui compte » est à l'écran depuis S30.3.
    await page.locator('[data-role="propose-grid"]').click();
    await expect
      .poll(
        () =>
          page
            .locator('input[type="text"]')
            .first()
            .inputValue()
            .catch(() => ''),
        { timeout: 30_000 },
      )
      .toContain('proposé');

    // Une pondération suggérée fait apparaître le bandeau qui COMMANDE tous
    // les critères — et « Suivant » attend qu'elle soit traitée.
    const maitre = page.locator('[data-role="suggestions-master"]');
    if ((await maitre.count()) > 0) {
      expect(await raison(page).textContent()).toContain('proposée');
      await maitre.locator('text=Tout confirmer').click();
      await page.waitForTimeout(400);
      expect(await maitre.count()).toBe(0);
    }
    expect(await suivant(page).isEnabled()).toBe(true);
  }, 180_000);

  it('S30.4 — le rail ramène en arrière, et la saisie est toujours là', async () => {
    await etapeDuRail(page, 'poste').click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-step][data-state="current"]')?.getAttribute('data-step') ===
        'poste',
      undefined,
      { timeout: 30_000 },
    );
    const valeur = await page
      .locator('[data-field="job_title"] input, [data-field="job_title"] textarea')
      .first()
      .inputValue();
    expect(valeur).toBe(INTITULE);

    // Une étape à venir reste fermée tant que ce qui la précède n'est pas réglé.
    expect(await etapeDuRail(page, 'recapitulatif').isDisabled()).toBe(true);
  }, 180_000);

  it('S30.5 — fermer et revenir reprend là où on en était', async () => {
    await page.goto(`${BASE_URL}/campagnes`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Gestion des campagnes', { timeout: 90_000 });

    await ouvrirAssistant(page, `${ASSISTANT_URL}?campagne=${encodeURIComponent(campaignId!)}`);
    await page.waitForFunction(
      () => document.querySelector('[data-saved="true"]') !== null,
      undefined,
      { timeout: 60_000 },
    );

    // La PREMIÈRE étape encore incomplète : la réception. Les trois flux
    // opérationnels sont cochés d'emblée, mais le flux email réclame une boîte
    // — et ça se DIT, ça ne se devine pas.
    await page.waitForFunction(
      () =>
        document.querySelector('[data-step][data-state="current"]')?.getAttribute('data-step') ===
        'reception',
      undefined,
      { timeout: 60_000 },
    );
    expect(await etapeCourante(page)).toBe('reception');
    for (const source of ['manual', 'email', 'vivier']) {
      expect(
        await page.locator(`[data-source="${source}"]`).getAttribute('aria-pressed'),
        `${source} doit être coché d'emblée`,
      ).toBe('true');
    }
    // Et RIEN d'autre : un flux inerte proposé à la création promettrait des
    // candidatures qui n'arriveront pas.
    expect(await page.locator('[data-source]').count()).toBe(3);
    // AUCUN canal de diffusion ici (23/09/2026) : le choisir à la création ne
    // diffusait rien — le texte s'écrit et se publie après le lancement, dans
    // « Diffuser l'annonce », qui propose le canal au même endroit.
    expect(await page.locator('[data-channel]').count()).toBe(0);
    expect(await page.textContent('[data-assistant="reception"]')).toContain(
      'Diffuser l’annonce',
    );

    expect(await suivant(page).isDisabled()).toBe(true);
    expect(await raison(page).textContent()).toContain('boîte mail');
  }, 180_000);

  it('S30.6 — le récapitulatif ACTIVE la campagne', async () => {
    // On retire le flux email (aucune boîte rattachée sur une campagne
    // d'essai) ; dépôt manuel et vivier suffisent à passer.
    await page.locator('[data-source="email"]').click();
    await page.waitForTimeout(300);
    expect(await suivant(page).isEnabled()).toBe(true);
    await cliquerSuivant(page, 'suivi');
    await cliquerSuivant(page, 'reservation');
    // La réservation native est le régime par défaut : c'est le seul qu'on
    // installe, et une campagne créée sans y penser partait sur l'autre.
    expect(await page.locator('[data-role="scheduling-native"]').isChecked()).toBe(true);
    await cliquerSuivant(page, 'recapitulatif');

    // Le récapitulatif porte le geste, et il le NOMME.
    expect(await suivant(page).textContent()).toContain('Activer');
    await suivant(page).click();
    await page.waitForSelector(`[data-launched="${campaignId}"]`, { timeout: 90_000 });

    // Les TROIS portes, et ce sont celles de la carte campagne.
    await page.waitForFunction(
      () => document.querySelectorAll('[data-launched] a[href], [data-launched] div[title]').length > 0,
      undefined,
      { timeout: 60_000 },
    );
    for (const libelle of ['Chercher dans le vivier', 'Diffuser l’annonce', 'Approcher des profils']) {
      await page
        .locator('[data-launched]')
        .locator(`text=${libelle}`)
        .first()
        .waitFor({ timeout: 30_000 });
    }

    // ⚠️ En BASE : l'écran de fin ne prouve rien tout seul.
    await page.waitForTimeout(1500);
    const row = await ligne();
    expect(row?.status).toBe('active');
  }, 180_000);

  it('S30.6bis — « Fermer » demande, puis CONFIRME que le brouillon est gardé', async () => {
    // Nouveau brouillon : on s'arrête juste après la première étape.
    await ouvrirAssistant(page);
    await remplirLePoste(page, `${INTITULE} (abandon)`);
    await page.waitForTimeout(400);
    await cliquerSuivant(page, 'criteres');
    const brouillon = (await bandeEnregistrement(page).textContent())?.match(
      /CAMP-\d{4}-\d{3}/,
    )?.[0];
    expect(brouillon).toBeTruthy();
    abandonne = brouillon ?? null;

    // ① On DEMANDE avant de fermer — quitter une saisie en silence laisse
    //    partir avec le doute.
    await page.locator('text=Fermer').first().click();
    await page.waitForSelector('[data-dialog="leave-ask"]', { timeout: 30_000 });
    await page.locator('[data-role="leave-cancel"]').click();
    await page.waitForSelector('[data-dialog="leave-ask"]', { state: 'detached', timeout: 30_000 });
    expect(await etapeCourante(page)).toBe('criteres');

    // ② On CONFIRME que le brouillon est gardé, et on dit où le reprendre.
    await page.locator('text=Fermer').first().click();
    await page.locator('[data-role="leave-confirm"]').click();
    const confirmation = page.locator('[data-dialog="leave-confirmed"]');
    await confirmation.waitFor({ timeout: 30_000 });
    expect(await confirmation.textContent()).toContain(brouillon!);
    await page.locator('[data-role="leave-done"]').click();
    await page.waitForURL((u) => u.pathname === '/campagnes', { timeout: 60_000 });

    // Le brouillon existe VRAIMENT, et il n'est pas lancé.
    const { data } = await db.from('campaigns').select('status').eq('id', brouillon!).maybeSingle();
    expect(data?.status).toBe('draft');
  }, 180_000);

  it('S30.7 — l’assistant REFUSE de rouvrir une campagne lancée', async () => {
    // Sinon le premier « Suivant » la ferait redescendre en brouillon, et elle
    // cesserait de recevoir les candidatures par mail — sans un mot.
    await ouvrirAssistant(page, `${ASSISTANT_URL}?campagne=${encodeURIComponent(campaignId!)}`)
      .catch(() => {});
    await page.waitForSelector(`[data-already-live="${campaignId}"]`, { timeout: 60_000 });
    expect(await page.locator('[data-role="next"]').count()).toBe(0);

    // Et elle est TOUJOURS active : regarder n'a rien changé.
    const row = await ligne();
    expect(row?.status).toBe('active');
  }, 180_000);
});
