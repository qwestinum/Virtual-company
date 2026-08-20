/**
 * Harnais de démonstration du module de réservation — HORS de toute
 * application métier.
 *
 * Ce script est la preuve d'autonomie du module, exécutable : il déroule un
 * cycle complet (ressource → disponibilités → cible → lien → créneaux →
 * réservation → déplacement → annulation → événements) sans nommer un seul
 * concept de l'application qui l'héberge. Ce qu'on y lit est exactement ce
 * qu'un autre produit écrirait pour s'en servir.
 *
 * Deux usages :
 *   npm run demo:scheduling          cycle complet, puis suppression des données
 *   npm run demo:scheduling -- --keep
 *       s'arrête AVANT les gestes destructeurs, conserve les données, imprime
 *       les URL à ouvrir et écrit les invitations d'agenda sur disque — de quoi
 *       dérouler le parcours à la main, dans un navigateur et un vrai agenda.
 *
 * DEV UNIQUEMENT : refuse de tourner en production. Les données créées sont
 * marquées `SCHED-DEMO-`.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';

import {
  addException,
  cancelBookingByAttendee,
  configureScheduling,
  confirmBooking,
  createBookingLink,
  createRecordingMailer,
  createResource,
  createTarget,
  getTargetImpact,
  listOrphanTargets,
  listSlotsForLink,
  registerEventConsumer,
  repointTarget,
  rescheduleBooking,
  resolveBookingPage,
  revokeLinkByKey,
  setWeeklyRules,
  type MailMessage,
  type SchedEvent,
} from '@/lib/scheduling';

loadEnvConfig(process.cwd());

if (process.env.NODE_ENV === 'production') {
  console.error('Harnais de démonstration : refusé en production.');
  process.exit(1);
}

const KEEP = process.argv.includes('--keep');
const MARK = 'SCHED-DEMO-';
const suffix = Math.random().toString(36).slice(2, 7);
const RESOURCE = `${MARK}camille-${suffix}`;
const SECOND_RESOURCE = `${MARK}dominique-${suffix}`;
const TARGET = `${MARK}poste-${suffix}`;
const SPARE_TARGET = `${MARK}poste-bis-${suffix}`;

const BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
).replace(/\/+$/, '');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Harnais : NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const events: SchedEvent[] = [];
const mailer = createRecordingMailer();
const outDir = mkdtempSync(join(tmpdir(), 'scheduling-demo-'));

const title = (text: string): void => console.log(`\n\x1b[1m${text}\x1b[0m`);
const line = (text: string): void => console.log(`  ${text}`);
const localTime = (iso: string, zone: string): string =>
  new Date(iso).toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  });

/** Écrit sur disque les invitations reçues depuis le dernier appel. */
function dumpInvitations(label: string, since: number): string[] {
  const written: string[] = [];
  mailer.sent.slice(since).forEach((message: MailMessage, index) => {
    const attachment = (message.attachments ?? [])[0];
    if (!attachment) return;
    const path = join(outDir, `${label}-${index + 1}.ics`);
    writeFileSync(path, Buffer.from(attachment.contentBase64, 'base64'));
    written.push(path);
  });
  return written;
}

async function main(): Promise<void> {
  // Un run précédent (`--keep`, ou interrompu) a pu laisser ses lignes : on
  // repart d'une base propre plutôt que de mélanger deux démonstrations.
  await purgeDemoData();

  configureScheduling({
    supabase,
    mailer,
    publicBaseUrl: BASE_URL,
    organizationName: 'Cabinet Démo',
  });
  registerEventConsumer(async (event) => {
    events.push(event);
    line(`↳ événement reçu : ${event.type} (réservation ${event.booking.id.slice(0, 8)}…)`);
  });

  // ── 1. Une personne réservable et ses disponibilités ────────────────
  title('1. Ressource réservable');
  const resource = await createResource({
    externalRef: RESOURCE,
    displayName: 'Camille',
    timezone: 'Europe/Paris',
    slotDurationMinutes: 45,
    bufferMinutes: 15,
    minNoticeMinutes: 60,
    horizonDays: 21,
    meetingLocation: { type: 'video', payload: { url: 'https://visio.demo.local/camille' } },
    notifyEmail: 'camille@demo.local',
  });
  line(`${resource.displayName} — ${resource.timezone}, ${resource.slotDurationMinutes} min`);
  line(`lieu par défaut : ${resource.meetingLocation?.type}`);

  await setWeeklyRules(RESOURCE, [
    { weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
    { weekday: 1, startMinute: 14 * 60, endMinute: 17 * 60 },
    { weekday: 2, startMinute: 9 * 60, endMinute: 17 * 60 },
    { weekday: 3, startMinute: 9 * 60, endMinute: 17 * 60 },
    { weekday: 4, startMinute: 9 * 60, endMinute: 17 * 60 },
    { weekday: 5, startMinute: 9 * 60, endMinute: 12 * 60 },
  ]);
  const closed = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await addException(RESOURCE, { day: closed, label: 'Absente' });
  line(`règles hebdomadaires posées, journée bloquée le ${closed}`);

  // ── 2. La cible : l'alias re-pointable ──────────────────────────────
  title('2. Cible (alias re-pointable)');
  await createTarget({ externalRef: TARGET, resourceExternalRef: RESOURCE });
  line(`${TARGET} → ${RESOURCE}`);

  // ── 3. Un lien nominatif, émis deux fois ────────────────────────────
  title('3. Lien nominatif (émission idempotente)');
  const first = await createBookingLink({
    targetExternalRef: TARGET,
    idempotencyKey: `dossier-${suffix}`,
    context: { referenceInterne: `REF-${suffix}`, note: 'charge utile opaque' },
    display: {
      title: 'Entretien de 45 minutes',
      organisation: 'Cabinet Démo',
      attendeeName: 'Alex Martin',
      attendeeEmail: 'alex.martin@demo.local',
    },
  });
  const again = await createBookingLink({
    targetExternalRef: TARGET,
    idempotencyKey: `dossier-${suffix}`,
  });
  line(`lien : ${first.url}`);
  line(`ré-émission avec la même clé → même jeton : ${again.token === first.token} (reused=${again.reused})`);

  // ── 4. Créneaux proposés ────────────────────────────────────────────
  title('4. Créneaux proposés');
  line(`état de la page : ${(await resolveBookingPage(first.token)).status}`);
  const window = {
    from: new Date().toISOString(),
    to: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  };
  const slots = await listSlotsForLink(first.token, window);
  line(`${slots.length} créneaux sur 14 jours ; les 5 premiers :`);
  for (const slot of slots.slice(0, 5)) {
    line(`   • ${localTime(slot.startAt, 'Europe/Paris')} (Paris) = ${slot.startAt}`);
  }
  if (slots[0]) {
    line(`   même créneau vu de Montréal : ${localTime(slots[0].startAt, 'America/Montreal')}`);
  }

  if (KEEP) {
    await keepMode(first.url, first.token, slots);
    return;
  }

  // ── 5. Réservation ──────────────────────────────────────────────────
  title('5. Réservation');
  const chosen = slots[2];
  if (!chosen) throw new Error('aucun créneau disponible pour la démonstration');
  let mailCursor = mailer.sent.length;
  const booked = await confirmBooking({
    token: first.token,
    startAt: chosen.startAt,
    attendee: {
      name: 'Alex Martin',
      email: 'alex.martin@demo.local',
      timezone: 'Europe/Paris',
    },
  });
  if (!booked.ok) throw new Error(`réservation refusée : ${booked.reason}`);
  line(`réservé : ${localTime(booked.booking.startAt, 'Europe/Paris')}`);
  line(`lieu figé : ${JSON.stringify(booked.booking.meetingLocation)}`);
  line(`contexte restitué tel quel : ${JSON.stringify(booked.booking.context)}`);
  for (const path of dumpInvitations('reservation', mailCursor)) line(`invitation → ${path}`);

  // ── 6. Un lien ne sert qu'une fois ──────────────────────────────────
  title('6. Usage unique');
  const replay = await confirmBooking({
    token: first.token,
    startAt: chosen.startAt,
    attendee: { name: 'Alex Martin', email: 'alex.martin@demo.local', timezone: 'Europe/Paris' },
  });
  line(`rejeu du MÊME créneau (double-clic) : ${replay.ok ? 'même réservation rendue' : replay.reason}`);
  const other = slots[4];
  if (other) {
    const second = await confirmBooking({
      token: first.token,
      startAt: other.startAt,
      attendee: { name: 'Autre', email: 'autre@demo.local', timezone: 'Europe/Paris' },
    });
    line(`tentative sur un AUTRE créneau : ${second.ok ? 'acceptée (anormal)' : second.reason}`);
  }

  // ── 7. Déplacement ──────────────────────────────────────────────────
  title('7. Déplacement par l’invité');
  const target = slots.find((s) => s.startAt > chosen.startAt && s.startAt !== other?.startAt);
  if (target) {
    mailCursor = mailer.sent.length;
    const moved = await rescheduleBooking(booked.manageToken, { startAt: target.startAt });
    if (moved.ok) {
      line(`déplacé vers ${localTime(moved.booking.startAt, 'Europe/Paris')}`);
      line(`jeton de gestion inchangé : ${moved.booking.manageToken === booked.manageToken}`);
      for (const path of dumpInvitations('deplacement', mailCursor)) line(`invitation → ${path}`);
    }
  }

  // ── 8. Changement de titulaire ──────────────────────────────────────
  title('8. Changement de titulaire (l’impact AVANT d’écrire)');
  await createSecondResource();
  const pending = await createBookingLink({
    targetExternalRef: TARGET,
    idempotencyKey: `dossier-2-${suffix}`,
    display: { title: 'Entretien de 45 minutes' },
  });
  const impact = await getTargetImpact(TARGET);
  line(`liens actifs qui basculeront : ${impact?.activeLinks}`);
  for (const row of impact?.confirmedUpcomingBookings ?? []) {
    line(`rendez-vous déjà pris chez ${row.resourceExternalRef} : ${row.count} (ils ne bougent pas)`);
  }

  await repointTarget(TARGET, SECOND_RESOURCE);
  const afterSlots = await listSlotsForLink(pending.token, window);
  line('après re-pointage, le lien DÉJÀ ÉMIS montre l’agenda de Dominique :');
  for (const slot of afterSlots.slice(0, 3)) {
    line(`   • ${localTime(slot.startAt, 'Europe/Paris')}`);
  }

  // ── 9. Cible sans titulaire ─────────────────────────────────────────
  title('9. Cible sans titulaire (page dégradée)');
  await repointTarget(TARGET, null);
  line(`état de la page : ${(await resolveBookingPage(pending.token)).status}`);
  const orphans = await listOrphanTargets();
  line(`cibles à signaler : ${orphans.map((o) => `${o.target.externalRef} (${o.activeLinks} liens)`).join(', ')}`);

  // ── 10. Révocation et annulation ────────────────────────────────────
  title('10. Révocation et annulation');
  line(`révocation du lien en attente : ${await revokeLinkByKey(TARGET, `dossier-2-${suffix}`, 'dossier clos')}`);
  line(`état de la page : ${(await resolveBookingPage(pending.token)).status}`);
  mailCursor = mailer.sent.length;
  line(`annulation du rendez-vous : ${await cancelBookingByAttendee(booked.manageToken, { reason: 'empêchement' })}`);
  for (const path of dumpInvitations('annulation', mailCursor)) line(`invitation → ${path}`);

  bilan();
}

/**
 * Mode recette : on s'arrête avant tout geste destructeur et on laisse une
 * installation utilisable. Les états fermés (dégradé, révoqué) sont montés sur
 * une cible SÉPARÉE, pour que le lien principal reste réservable.
 */
async function keepMode(bookingUrl: string, token: string, slots: { startAt: string }[]): Promise<void> {
  title('5. Installation laissée en place pour la recette');

  await createSecondResource();
  await createTarget({ externalRef: SPARE_TARGET, resourceExternalRef: SECOND_RESOURCE });
  const degraded = await createBookingLink({
    targetExternalRef: SPARE_TARGET,
    idempotencyKey: `degrade-${suffix}`,
    display: { title: 'Entretien de 45 minutes', organisation: 'Cabinet Démo' },
  });
  const revoked = await createBookingLink({
    targetExternalRef: SPARE_TARGET,
    idempotencyKey: `revoque-${suffix}`,
    display: { title: 'Entretien de 45 minutes', organisation: 'Cabinet Démo' },
  });
  await repointTarget(SPARE_TARGET, null);
  await revokeLinkByKey(SPARE_TARGET, `revoque-${suffix}`, 'recette');

  const impact = await getTargetImpact(TARGET);

  title('À ouvrir dans le navigateur');
  line(`RÉSERVER (état ouvert)   ${bookingUrl}`);
  line(`DÉGRADÉ (sans titulaire) ${BASE_URL}/r/${degraded.token}`);
  line(`ÉTEINT (révoqué)         ${BASE_URL}/r/${revoked.token}`);
  line('');
  line(`${slots.length} créneaux disponibles sur les 14 prochains jours.`);
  line(`Liens actifs sur ${TARGET} : ${impact?.activeLinks ?? 0}`);
  line('');
  line('Après avoir réservé depuis la page, relancez :');
  line(`  npm run demo:scheduling -- --keep   (nouvelle installation)`);
  line('Le lien de GESTION vous est donné à l’écran de confirmation, et par mail.');
  line('');
  line(`Les invitations d’agenda envoyées seront écrites dans : ${outDir}`);
  line('(le transport est un enregistreur : aucun mail ne part réellement)');
  line('');
  line(`Jeton de réservation : ${token}`);
  line(`Marqueur des données : ${MARK} — supprimez-les avec une relance sans --keep.`);

  bilan();
}

async function createSecondResource(): Promise<void> {
  await createResource({
    externalRef: SECOND_RESOURCE,
    displayName: 'Dominique',
    timezone: 'Europe/Paris',
    meetingLocation: { type: 'in_person', payload: { address: '2 rue de la Démo, Paris' } },
    notifyEmail: 'dominique@demo.local',
  });
  await setWeeklyRules(
    SECOND_RESOURCE,
    [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      startMinute: 10 * 60,
      endMinute: 16 * 60,
    })),
  );
}

function bilan(): void {
  title('Bilan');
  line(`événements émis : ${events.map((e) => e.type).join(' → ') || '(aucun)'}`);
  line(`messages remis au transport : ${mailer.sent.length}`);
  for (const message of mailer.sent.slice(0, 4)) {
    line(`   • « ${message.subject} » → ${message.to.join(', ')}`);
  }
}

/**
 * Supprime TOUT ce qui porte le marqueur de démonstration — y compris les
 * données d'un run précédent. Appelée au DÉMARRAGE (un run lancé avec
 * `--keep`, ou interrompu, laisse ses lignes derrière lui) et à la sortie.
 */
async function purgeDemoData(): Promise<void> {
  const { data: targets } = await supabase
    .from('sched_targets')
    .select('id')
    .like('external_ref', `${MARK}%`);
  const targetIds = (targets ?? []).map((row) => row.id as string);
  if (targetIds.length > 0) {
    // Les ÉVÉNEMENTS d'abord — la cascade le ferait, on l'écrit quand même :
    // c'est l'ordre qui compte si la contrainte changeait. Ce qui a produit un
    // vrai mail le 17/08, ce n'est pas cette purge mais son ABSENCE : un run
    // laissé avec `--keep` avait gardé sa réservation, et le premier hôte à
    // brancher un consommateur a livré ses événements.
    const { data: bookings } = await supabase
      .from('sched_bookings')
      .select('id')
      .in('target_id', targetIds);
    const bookingIds = (bookings ?? []).map((row) => row.id as string);
    if (bookingIds.length > 0) {
      await supabase.from('sched_events').delete().in('booking_id', bookingIds);
    }
    await supabase.from('sched_bookings').delete().in('target_id', targetIds);
    await supabase.from('sched_booking_links').delete().in('target_id', targetIds);
    await supabase.from('sched_targets').delete().in('id', targetIds);
  }
  const { data: resources } = await supabase
    .from('sched_resources')
    .select('id')
    .like('external_ref', `${MARK}%`);
  const resourceIds = (resources ?? []).map((row) => row.id as string);
  if (resourceIds.length > 0) {
    await supabase.from('sched_availability_rules').delete().in('resource_id', resourceIds);
    await supabase.from('sched_availability_exceptions').delete().in('resource_id', resourceIds);
    await supabase.from('sched_resources').delete().in('id', resourceIds);
  }
}

async function cleanup(): Promise<void> {
  if (KEEP) {
    console.log(
      `\nDonnées CONSERVÉES (--keep). Marqueur : ${MARK}\n` +
        '   Elles seront supprimées au prochain lancement du harnais.',
    );
    return;
  }
  await purgeDemoData();
  console.log('\nDonnées de démonstration supprimées.');
}

main()
  .catch((error) => {
    console.error('\nHarnais interrompu :', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => cleanup());
