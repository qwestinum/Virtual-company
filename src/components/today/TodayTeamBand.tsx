'use client';

/**
 * La bande d'équipe — six agents, un rôle, UN chiffre. Une seule ligne.
 *
 * Ce n'est pas la constellation du « Bureau » : c'est une ligne qu'on balaie
 * en une seconde. Aucune bulle, aucun message, aucune voix — un agent qui
 * s'adresse au lecteur sur l'écran d'accueil demande à être lu, et cet écran
 * n'est pas là pour être lu.
 *
 * Les AVATARS ILLUSTRÉS existants (`/avatars/*.png`, résolus par
 * `getAvatarUrl`) : ce sont eux qui font « une équipe » plutôt qu'un tableau
 * de compteurs. Les initiales ne servent que de repli si un fichier manque.
 *
 * ⚠️ Chaque chiffre vient du JOURNAL. Zéro activité affiche **0**, jamais un
 * texte d'attente : le zéro est une information, la phrase est une excuse.
 *
 * Registre NEUTRE, volontairement : cette bande n'appelle aucune action, elle
 * rend compte. Les teintes de registre sont réservées aux cartes qui, elles,
 * attendent un geste.
 */

import Image from 'next/image';
import Link from 'next/link';

import { getAvatarColor, getAvatarInitials, getAvatarUrl } from '@/lib/agents/avatar-colors';
import { AGENT_BAND, agentCountLabel } from '@/lib/today/agents-band';

export function TodayTeamBand({
  counts,
}: {
  /** id d'agent → nombre d'actions depuis la dernière visite. */
  counts: Record<string, number>;
}) {
  return (
    <Link
      href="/pilotage"
      aria-label="Voir l’activité de l’équipe dans Pilotage"
      className="block"
      style={{
        borderRadius: 14,
        border: '1px solid var(--dash-border)',
        background: 'var(--dash-surface)',
        padding: '14px 16px',
      }}
    >
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
        {AGENT_BAND.map((agent) => {
          const url = getAvatarUrl(agent.id);
          return (
            <div key={agent.id} className="flex min-w-0 flex-col items-center gap-1.5">
              {url ? (
                <Image
                  src={url}
                  alt=""
                  aria-hidden
                  width={52}
                  height={52}
                  className="shrink-0 rounded-full object-cover"
                  style={{ border: '1px solid var(--dash-border)' }}
                />
              ) : (
                <span
                  aria-hidden
                  className="font-display inline-flex shrink-0 items-center justify-center rounded-full"
                  style={{
                    width: 52,
                    height: 52,
                    background: getAvatarColor(agent.id),
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  {getAvatarInitials(agent.id)}
                </span>
              )}
              <span
                className="font-display max-w-full truncate text-center"
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--dash-text)' }}
              >
                {agent.name}
              </span>
              <span
                className="font-body text-center"
                style={{ fontSize: 11, color: 'var(--dash-text-secondary)', lineHeight: 1.35 }}
              >
                {agentCountLabel(agent, counts[agent.id] ?? 0)}
              </span>
            </div>
          );
        })}
      </div>
    </Link>
  );
}
