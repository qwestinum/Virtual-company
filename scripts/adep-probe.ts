/**
 * Sonde ADEP — le premier contact réel avec l'Apec, sous contrôle humain.
 *
 *   npm run adep:probe -- --env .env.adep                 # DRY-RUN (défaut)
 *   npm run adep:probe -- --env .env.adep --execute       # appel RÉEL
 *   npm run adep:probe -- --env .env.adep --execute --confirm-ats <atsId>
 *
 * ── CE QU'ELLE FAIT AVANT DE TOUCHER À QUOI QUE CE SOIT ─────────────────────
 *
 *   1. dit à QUI elle s'adresse (endpoint, atsId, numéro de dossier masqué) ;
 *   2. VÉRIFIE le `targetNamespace` du WSDL réellement servi contre notre
 *      constante, et refuse de continuer s'ils diffèrent. Le WSDL de production
 *      n'a jamais été vu : c'est la garde qui empêche de découvrir un écart
 *      sur une offre réelle ;
 *   3. calcule la clé et affiche sa LONGUEUR, jamais sa valeur ;
 *   4. valide l'offre — règles métier, puis XSD si `xmllint` est là (et le dit
 *      quand il ne l'est pas : un contrôle qui n'a pas tourné ne doit jamais
 *      se présenter comme réussi) ;
 *   5. affiche le XML qui partirait, secrets caviardés.
 *
 * `--execute` seulement alors, et il ne fait qu'UN `openPosition` suivi d'un
 * `getPositionStatus` sur le numéro reçu.
 *
 * ── CE QU'ELLE NE FAIT JAMAIS ───────────────────────────────────────────────
 *
 *   · aucun appel réel sans `--execute` ET confirmation de l'`atsId` saisie
 *     à la main — la même ceinture que `purge:candidate` ;
 *   · aucune écriture en base : la sonde ne crée pas de ligne `job_postings`.
 *     Elle sert à vérifier le TUYAU, pas à publier une campagne. Ce qu'elle
 *     crée chez l'Apec est une offre de test, avec une référence de test ;
 *   · aucun secret affiché ni journalisé.
 */
import { createInterface } from 'node:readline/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';

import {
  buildOpenPositionBody,
  buildOpenPositionEnvelope,
  redactCredentials,
} from '../src/lib/jobboards/adep/build-open-position';
import {
  ARGON2_EXPECTED_KEY_LENGTH,
  resolveAtsPasswordFromEnv,
} from '../src/lib/jobboards/adep/argon2';
import {
  createHttpAdepTransport,
  endpointFromWsdlUrl,
} from '../src/lib/jobboards/adep/http-transport';
import {
  NS_ADEP_SEP,
  extractWsdlTargetNamespace,
} from '../src/lib/jobboards/adep/namespaces';
import { AdepSepPublisher } from '../src/lib/jobboards/adep/publisher';
import { prettyPrintXml } from '../src/lib/jobboards/adep/xml';
import { validateAdepOffer } from '../src/lib/jobboards/adep/validate';
import { checkAgainstXsd } from './lib/adep-xsd';
import type { AdepCredentials, AdepOffer } from '../src/types/adep';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) =>
  args.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1) ??
  (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);

function fail(message: string): never {
  console.error(`\n  ❌ ${message}\n`);
  process.exit(1);
}

/** Masque un identifiant sans le cacher : on doit pouvoir le reconnaître. */
function mask(value: string): string {
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${value.slice(0, 2)}${'•'.repeat(value.length - 4)}${value.slice(-2)}`;
}

/**
 * L'offre de la sonde. Elle est DÉLIBÉRÉMENT reconnaissable : `SONDE`,
 * confidentielle (`ODC`, donc pas de logo ni d'URL), un seul poste. Elle sera
 * visible chez l'Apec — autant qu'elle dise ce qu'elle est.
 *
 * La référence porte l'horodatage : chez l'Apec une référence sert UNE fois
 * pour toutes, et une sonde qu'on relance échouerait sur API_390 avec une
 * référence fixe.
 */
function probeOffer(reference: string, applicationEmail: string): AdepOffer {
  const filler = (n: number) =>
    'Cette offre est un test technique du connecteur ADEP. Elle ne correspond à aucun poste réel et sera retirée. '.repeat(
      Math.ceil(n / 100),
    ).slice(0, n);
  return {
    clientPositionId: reference,
    trackingId: `orqa-probe-${Date.now()}`,
    relationship: 'self',
    finalClient: null,
    contactEmail: null,
    positionTitle: 'SONDE TECHNIQUE ADEP — ne pas traiter',
    nafCode: '7022Z',
    inseeCode: '37261',
    travelZone: 'AUCUN',
    experienceLevel: '1',
    numberToFill: 1,
    jobType: '1',
    statusJob: 'CADRE_PRIVE',
    durationMonths: null,
    partTime: false,
    partTimeDuration: null,
    remoteWork: null,
    educationLevel: null,
    salaryMin: 40000,
    salaryMax: 45000,
    displayedPay: '3',
    datePositionTaken: null,
    releaseDate: null,
    positionType: 'ODC',
    positionDescription: filler(320),
    profileDescription: filler(140),
    organizationDescription: filler(140),
    organizationName: 'Test connecteur ADEP',
    displayLogo: false,
    presentationDescription: null,
    recruitmentDescription: null,
    videoUrl: null,
    applicationEmail,
    applicationUrl: null,
    applyContact: null,
  };
}

async function main(): Promise<void> {
  // `--env` OBLIGATOIRE, aucun repli : un fichier au nom rassurant peut
  // parfaitement pointer l'environnement de PRODUCTION de l'Apec.
  const envPath = val('--env');
  if (!envPath) {
    fail(
      '--env est obligatoire (ex. --env .env.adep). Aucun repli automatique : ' +
        'le fichier détermine à quel environnement Apec on parle.',
    );
  }
  const absolute = resolve(process.cwd(), envPath);
  if (!existsSync(absolute)) fail(`Fichier d'environnement introuvable : ${absolute}`);

  const env: Record<string, string> = {};
  for (const line of readFileSync(absolute, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]!] = (m[2] ?? '').trim().replace(/^["']|["']$/g, '');
  }

  const atsId = env.ADEP_ATS_ID;
  const wsdlUrl = env.ADEP_WSDL_URL;
  const numeroDossier = env.ADEP_TEST_NUMERO_DOSSIER;
  const applicationEmail = env.ADEP_PROBE_EMAIL;
  if (!atsId) fail('ADEP_ATS_ID absent du fichier.');
  if (!wsdlUrl) fail('ADEP_WSDL_URL absente du fichier.');
  if (!numeroDossier) fail('ADEP_TEST_NUMERO_DOSSIER absent du fichier.');
  if (!applicationEmail) {
    fail(
      'ADEP_PROBE_EMAIL absent : il faut une adresse de réception des ' +
        "candidatures, même pour une sonde (l'Apec l'exige).",
    );
  }

  const endpoint = endpointFromWsdlUrl(wsdlUrl);

  console.log('\n  ADEP — sonde');
  console.log('  ═══════════════════════════════════════════════════════════════');
  console.log(`  Environnement    ${absolute}`);
  console.log(`  Endpoint         ${endpoint}`);
  console.log(`  atsId            ${atsId}`);
  console.log(`  numeroDossier    ${mask(numeroDossier)}`);
  console.log(`  Mode             ${has('--execute') ? '⚠️  APPEL RÉEL' : 'dry-run'}`);

  // ── 1. Le WSDL servi dit-il ce qu'on croit ? ──
  console.log('\n  ── Espace de noms ────────────────────────────────────────────');
  let wsdl: string | null = null;
  try {
    const res = await fetch(wsdlUrl, { signal: AbortSignal.timeout(20_000) });
    wsdl = await res.text();
  } catch (err) {
    console.log(`  ⚠️  WSDL injoignable (${err instanceof Error ? err.message : err}).`);
    console.log('     La vérification d’espace de noms et la validation XSD sont SAUTÉES.');
  }
  if (wsdl) {
    const served = extractWsdlTargetNamespace(wsdl);
    console.log(`  attendu          ${NS_ADEP_SEP}`);
    console.log(`  servi            ${served ?? '(illisible)'}`);
    if (served !== NS_ADEP_SEP) {
      fail(
        `Le WSDL servi déclare « ${served} », notre constante dit « ${NS_ADEP_SEP} ».\n` +
          '     Publier dans ces conditions rendrait API_023_VALIDATION_XML_ERROR.\n' +
          '     Mettez à jour src/lib/jobboards/adep/namespaces.ts, et RE-LANCEZ les tests.',
      );
    }
    console.log('  ✅ concordants');
  }

  // ── 2. La clé ──
  console.log('\n  ── Authentification ──────────────────────────────────────────');
  const atsPassword = await resolveAtsPasswordFromEnv(env);
  console.log(`  Longueur de clé  ${atsPassword.length} caractères (attendu ${ARGON2_EXPECTED_KEY_LENGTH})`);
  if (atsPassword.length !== ARGON2_EXPECTED_KEY_LENGTH) {
    console.log('  ⚠️  Longueur inattendue — 43 caractères signifieraient 32 octets au');
    console.log('     lieu de 256 (le piège du commentaire Java de la spécification).');
  }

  // ── 3. L'offre ──
  const reference = `SONDE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-4)}`;
  const offer = probeOffer(reference, applicationEmail);
  const credentials: AdepCredentials = { atsId, numeroDossier, atsPassword };
  const envelope = buildOpenPositionEnvelope(offer, credentials);
  // ⚠️ Le XSD décrit le CORPS, pas l'enveloppe SOAP : lui soumettre l'ensemble
  // rendrait une erreur qui n'a rien à voir avec l'offre.
  const body = buildOpenPositionBody(offer, credentials);

  console.log('\n  ── Validation ────────────────────────────────────────────────');
  const today = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const report = validateAdepOffer(offer, today);
  console.log(`  Règles métier    ${report.ok ? 'CONFORME' : `${report.errors.length} erreur(s)`}`);
  for (const e of report.errors) console.log(`    ✗ [${e.preventsCode}] ${e.field} — ${e.message}`);
  for (const w of report.warnings) console.log(`    ⚠ [${w.preventsCode}] ${w.field} — ${w.message}`);
  if (!report.ok) fail("L'offre de sonde est invalide — c'est un défaut du script, signalez-le.");

  if (wsdl) {
    const xsd = checkAgainstXsd({ wsdl, bodyXml: body });
    if (xsd.status === 'valid') console.log('  Schéma XSD       CONFORME');
    else if (xsd.status === 'unavailable') console.log(`  Schéma XSD       NON VÉRIFIÉ — ${xsd.reason}`);
    else {
      console.log('  Schéma XSD       INVALIDE');
      for (const m of xsd.messages.slice(0, 6)) console.log(`    ✗ ${m}`);
      fail('Le flux ne passe pas les schémas de l’Apec.');
    }
  }

  console.log('\n  ── Le flux qui partirait (secrets caviardés) ─────────────────\n');
  console.log(prettyPrintXml(redactCredentials(envelope)));

  if (!has('--execute')) {
    console.log('\n  Dry-run terminé. Rien n’a été envoyé.');
    console.log('  Pour appeler réellement l’Apec : ajoutez --execute\n');
    return;
  }

  // ── 4. Confirmation humaine ──
  const confirm = val('--confirm-ats');
  if (confirm !== atsId) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
      `\n  ⚠️  Ceci va CRÉER une offre chez l'Apec (${endpoint}).\n` +
        `      Référence : ${reference}\n` +
        `      Recopiez l'atsId pour confirmer (${atsId}) : `,
    );
    rl.close();
    if (answer.trim() !== atsId) fail('Confirmation incorrecte — rien n’a été envoyé.');
  }

  console.log('\n  ── Appel réel ────────────────────────────────────────────────');
  const publisher = new AdepSepPublisher({
    transport: createHttpAdepTransport({ endpoint }),
    credentials: async () => credentials,
  });

  const outcome = await publisher.publish(offer);
  console.log(`  openPosition     ${outcome.kind}`);
  if (outcome.kind === 'published' || outcome.kind === 'already_published') {
    console.log(`  Numéro Apec      ${outcome.remoteId}`);
  }
  if (outcome.kind === 'rejected') {
    for (const i of outcome.issues) console.log(`    ✗ [${i.code ?? '—'}] ${i.message}`);
  }
  if (outcome.kind === 'unavailable' || outcome.kind === 'uncertain') {
    console.log(`  Raison           ${outcome.reason}`);
  }
  if (outcome.kind === 'uncertain') {
    console.log('\n  ⚠️  ISSUE INCONNUE. Ne relancez pas la sonde sur cette référence :');
    console.log(`     vérifiez d'abord sur apec.fr sous « ${reference} ».`);
    return;
  }

  console.log('\n  ── Relecture du statut ───────────────────────────────────────');
  const status = await publisher.getStatus({ clientReference: reference });
  if (status.kind === 'found') {
    console.log(`  Statut           ${status.status.status}`);
    console.log(`  Modifiable       ${status.status.isEditable ? 'oui' : 'non'}`);
    console.log(`  URL              ${status.status.positionUrl || '—'}`);
  } else {
    console.log(`  ${status.kind === 'not_found' ? 'Offre introuvable' : `Lecture impossible : ${status.reason}`}`);
  }

  console.log('\n  ⚠️  Une offre de test existe maintenant chez l’Apec. Pensez à la');
  console.log('     dépublier (updatePositionStatus SUSPENDUE) ou à demander sa');
  console.log('     fermeture au support ADEP.\n');
}

void main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
