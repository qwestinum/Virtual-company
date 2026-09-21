'use client';

/**
 * LE GABARIT DE PAGE DU PRODUIT — un seul, pour tous les écrans.
 *
 * ⚠️ POURQUOI IL EXISTE. Mesuré à fenêtre constante (1440 × 900), les écrans
 * de premier niveau n'avaient pas le même cadre : le conteneur faisait
 * 1400 px sur Campagnes, 896 px sur Entretiens, Réglages et Sourcing
 * (504 px plus étroit), et la pleine largeur sur Candidatures — qui peignait
 * en plus un fond bleu-gris au lieu du sand. Le titre de page sautait de
 * x = 28 à x = 296 selon l'onglet, et Pilotage n'en avait aucun. En passant
 * d'un onglet à l'autre, la page se rétrécissait et se recentrait : on
 * changeait de produit à chaque clic.
 *
 * ⚠️ LES VALEURS SONT CELLES DE CAMPAGNES, la peau retenue comme référence.
 * Rien n'est redessiné ici : le gabarit NOMME ce qui existait déjà de bon.
 *
 * Un écran ne définit JAMAIS sa propre largeur — il remplit ce gabarit. Une
 * garde structurelle (`page-shell.test.ts`) le vérifie, parce qu'un conteneur
 * réintroduit ailleurs ne fait rougir aucun compilateur.
 */

import type { ReactNode } from 'react';

/** Largeur maximale du contenu, centrée. Valeur de Campagnes. */
const LARGEUR_MAX = 1400;
/** Marges de la page. Valeurs de Campagnes : haut 24, côtés 28, bas 60. */
const MARGE_HAUTE = 24;
const MARGE_COTE = 28;
const MARGE_BASSE = 60;
/**
 * Bas AÉRÉ — pour les écrans dont le geste principal vit en bas à droite.
 * Le bandeau de notifications du workspace y est posé (~230 px) : sans cet
 * espace, on ne peut pas faire remonter le pied au-dessus de lui.
 */
const MARGE_BASSE_AEREE = 260;

export type PageShellProps = {
  /**
   * Titre de page. Optionnel : un écran secondaire qui porte son propre
   * en-tête (l'assistant, les portes d'une campagne) n'en pose pas un second.
   */
  title?: string;
  subtitle?: string;
  /** À DROITE du titre — le bouton principal de l'écran, et lui seul. */
  actions?: ReactNode;
  /** Bas aéré : pour un écran dont l'action principale est en bas. */
  bottomSpace?: 'normal' | 'wide';
  children: ReactNode;
};

export function PageShell({
  title,
  subtitle,
  actions,
  bottomSpace = 'normal',
  children,
}: PageShellProps) {
  return (
    <div
      data-page-shell
      className="font-body"
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        // Le fond vient du workspace : un écran qui peint le sien rompt la
        // continuité au moment précis où l'on change d'onglet.
        background: 'transparent',
        color: 'var(--dash-text)',
      }}
    >
      <div
        data-page-container
        style={{
          padding: `${MARGE_HAUTE}px ${MARGE_COTE}px ${
            bottomSpace === 'wide' ? MARGE_BASSE_AEREE : MARGE_BASSE
          }px`,
          maxWidth: LARGEUR_MAX,
          margin: '0 auto',
        }}
      >
        {title ? (
          <header
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
              marginBottom: 20,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h1
                className="font-display"
                style={{ fontSize: 22, fontWeight: 800, color: 'var(--dash-text)' }}
              >
                {title}
              </h1>
              {subtitle ? (
                <p
                  className="font-body"
                  style={{
                    marginTop: 4,
                    fontSize: 13,
                    color: 'var(--dash-text-secondary)',
                  }}
                >
                  {subtitle}
                </p>
              ) : null}
            </div>
            {actions ? <div style={{ flexShrink: 0 }}>{actions}</div> : null}
          </header>
        ) : null}
        {children}
      </div>
    </div>
  );
}
