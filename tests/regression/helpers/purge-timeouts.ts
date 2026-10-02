/**
 * Délais des scénarios de PURGE (S18, S20, S28) — 02/10/2026.
 *
 * Une purge enchaîne PAR CONSTRUCTION des dizaines de requêtes l'une après
 * l'autre : identification, plan de stockage, effacement, puis contrôle final
 * en deux temps. Mesuré sur la base de dev pour UN dossier : ~80 requêtes
 * HTTP, ~13 s pour la seule identification + contrôle. Le scénario complet
 * dépasse donc les 30 s par défaut de la suite dès que la latence d'une
 * requête frôle les 100 ms — sans que rien ne soit en défaut.
 *
 * Ce n'est pas une mesure de performance (la régression compare des durées,
 * elle ne chronomètre pas) : c'est la marge pour qu'un échec dise un défaut,
 * pas une latence réseau.
 */
import { vi } from 'vitest';

export function allowPurgeDurations(): void {
  vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
}
