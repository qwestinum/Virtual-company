/**
 * Ce que l'écran « Agenda externe » reçoit du serveur. Jamais l'URL : elle
 * entre (enregistrement) et ne ressort pas.
 */
export type BusyCalendarState = 'unconfigured' | 'pending' | 'healthy' | 'tolerated' | 'blocked';

export type BusyCalendarStatus = {
  /** Le connecteur est allumé (déploiement ET cabinet). */
  available: boolean;
  /** Un lien d'agenda est enregistré pour ce recruteur. */
  configured: boolean;
  /** « Outlook » — déduit de l'hôte, qui n'est pas le secret. */
  providerLabel: string | null;
  state: BusyCalendarState;
  /** Dernière lecture réussie. */
  readAt: string | null;
  failingSince: string | null;
  /** Plages occupées sur les 30 prochains jours, d'après la dernière lecture. */
  upcomingCount: number | null;
  /** Quand l'agenda ne se lit plus : ce qu'il faut faire. */
  action: string | null;
};

export type BusyCalendarProbeResponse =
  | { ok: true; message: string; warnings: string[]; upcomingCount: number }
  | { ok: false; message: string };

export type BusyCalendarSaveResponse =
  | { ok: true; message: string; warnings: string[]; status: BusyCalendarStatus }
  | { ok: false; message: string };
