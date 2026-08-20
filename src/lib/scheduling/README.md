# Module de réservation

Prise de rendez-vous en autonomie : des **ressources réservables** déclarent leurs
disponibilités, l'application émet des **liens nominatifs**, les invités choisissent leur
créneau, et le module émet des **événements** que l'application consomme.

Ce dossier ne connaît aucun domaine métier. Il ne sait pas ce qu'est un candidat, une
campagne ou un entretien : il manipule des ressources, des cibles, des liens et des
réservations, et traite les clés (`externalRef`) et charges utiles (`context`, `display`)
de l'application comme **opaques**. Il est conçu pour être extrait en paquet indépendant.

## Démarrage

```ts
import { configureScheduling, registerEventConsumer } from '@/lib/scheduling';

configureScheduling({
  supabase: () => client,        // client base (service role)
  mailer,                        // transport d'email — optionnel
  publicBaseUrl: 'https://exemple.fr',
});

registerEventConsumer(async (event) => {
  // event.id est la clé d'idempotence : la livraison est at-least-once.
});
```

## Les cinq objets

| Objet | Ce que c'est |
| --- | --- |
| **Ressource** | Une personne qui tient des rendez-vous : fuseau, règles hebdomadaires, exceptions, durée, pause entre RDV, préavis, horizon, lieu de rencontre. |
| **Cible** | Un alias **re-pointable** vers une ressource. Les liens pointent une cible, jamais une ressource : changer de titulaire ne réémet aucun lien. |
| **Lien** | Un jeton nominatif à usage unique, expirable et révocable. Son émission est **idempotente** : même clé ⇒ même jeton. |
| **Réservation** | Un rendez-vous confirmé. Sa ressource et son lieu sont **figés** : il ne suit jamais un changement ultérieur. |
| **Événement** | `booking.created`, `booking.cancelled`, `booking.rescheduled`. Écrits en file, livrés au consommateur, rejouables. |

## Trois garanties, et comment elles tiennent

**Un seul gagnant par créneau.** L'insertion de la réservation *est* le verrou : un index
unique partiel `(resource_id, start_at) where status = 'confirmed'` tranche la concurrence
en une instruction. Le perdant reçoit `slot_taken` et recharge ses créneaux.

**Rien ne se perd entre deux étapes.** La confirmation relit la cible et le lien, insère,
consomme le lien, revérifie que la cible n'a pas bougé, puis écrit l'événement. Chaque
étape qui échoue **compense** (la réservation est supprimée, le lien rendu réutilisable).
Si le processus meurt avant l'écriture de l'événement, le drain répare : une réservation
confirmée sans `booking.created` est rattrapée.

**Les heures déclarées restent les heures déclarées.** Les règles sont stockées en minutes
locales de la ressource, jamais en instants. « Lundi 9h–12h » vaut 9h–12h été comme hiver.
La conversion se fait jour local par jour local avec Luxon ; une heure locale qui n'existe
pas (passage à l'heure d'été) est écartée plutôt que décalée en silence.

## Lieu de rencontre

```ts
{ type: 'video',     payload: { url } }
{ type: 'in_person', payload: { address } }
{ type: 'phone',     payload: { instructions } }
```

Opaque : aucune logique par fournisseur, aucune inspection d'URL. La résolution
(surcharge de la cible, sinon défaut de la ressource) passe par `resolveMeetingLocation`,
point unique prévu pour accueillir un jour la génération de liens par API.

## Ce que le module ne fait pas

Synchronisation d'agenda externe (OAuth), génération de liens visio par rendez-vous,
rappels automatiques. La version actuelle vit sur les disponibilités déclarées.

Les gabarits de notification sont volontairement minimaux : le câblage du transport est
en place, la mise en forme et l'invitation calendrier arrivent avec les pages publiques.
