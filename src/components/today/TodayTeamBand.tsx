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
 * ⚠️ La FENÊTRE est NOMMÉE et CHOISIE — « cette semaine » ou « ce mois-ci » —
 * sous la bande. Ce qui rendait deux chiffres incomparables, c'était une
 * fenêtre qui BOUGEAIT toute seule (« depuis votre dernière visite ») ; deux
 * durées dites, qu'on choisit, ne posent pas ce problème.
 *
 * ⚠️ LE SÉLECTEUR VIT HORS DU LIEN. La bande entière mène à Pilotage : deux
 * boutons à l'intérieur d'un lien ne sont pas du HTML valide, et le clavier
 * n'aurait plus su ce qu'il activait. La grille reste donc dans le lien, le
 * choix de fenêtre se pose en dessous.
 *
 * ⚠️ AUCUN FOND. La bande portait une carte blanche : sur un écran dont chaque
 * autre bloc est une carte qui ATTEND UN GESTE, la même boîte pour un bloc qui
 * ne fait que rendre compte promettait une action qu'il n'a pas.
 */

import Image from 'next/image';
import Link from 'next/link';

import { getAvatarColor, getAvatarInitials, getAvatarUrl } from '@/lib/agents/avatar-colors';
import { PHRASES } from '@/lib/lexique/phrases-ecran';
import {
  AGENT_BAND,
  agentCountLabel,
  type BandWindow,
} from '@/lib/today/agents-band';

/** 52 px + 30 % : les visages portent l'idée d'équipe, ils méritent la place. */
const TAILLE_AVATAR = 68;

export function TodayTeamBand({
  counts,
  fenetre,
  onFenetre,
}: {
  /** id d'agent → nombre d'actions sur la fenêtre choisie. */
  counts: Record<string, number>;
  fenetre: BandWindow;
  onFenetre: (next: BandWindow) => void;
}) {
  return (
    <div>
    <Link
      href="/pilotage"
      aria-label="Voir l’activité de l’équipe dans Pilotage"
      className="block"
      style={{ padding: '14px 4px 4px' }}
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
                  width={TAILLE_AVATAR}
                  height={TAILLE_AVATAR}
                  className="shrink-0 rounded-full object-cover"
                  style={{ border: '1px solid var(--dash-border)' }}
                />
              ) : (
                <span
                  aria-hidden
                  className="font-display inline-flex shrink-0 items-center justify-center rounded-full"
                  style={{
                    width: TAILLE_AVATAR,
                    height: TAILLE_AVATAR,
                    background: getAvatarColor(agent.id),
                    color: '#fff',
                    fontSize: 18,
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
                data-agent-count={counts[agent.id] ?? 0}
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
      {/* LA FENÊTRE, hors du lien — voir l'en-tête du fichier. */}
      <div className="mt-2 flex items-center justify-center gap-1">
        {(
          [
            ['semaine', PHRASES.equipe.fenetre],
            ['mois', PHRASES.equipe.fenetreMois],
          ] as const
        ).map(([cle, libelle]) => {
          const actif = fenetre === cle;
          return (
            <button
              key={cle}
              type="button"
              data-band-window={cle}
              aria-pressed={actif}
              onClick={() => onFenetre(cle)}
              className="rounded-full px-2.5 py-1 font-body text-[11px] transition"
              style={{
                fontWeight: actif ? 700 : 400,
                color: actif ? 'var(--dash-text)' : 'var(--dash-text-secondary)',
                background: actif ? 'var(--dash-warm)' : 'transparent',
              }}
            >
              {libelle}
            </button>
          );
        })}
      </div>
    </div>
  );
}
