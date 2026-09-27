'use client';

/**
 * Le fond du produit — UNI, sand, rien d'autre.
 *
 * ⚠️ C'était un reste du vieux Bureau : un dégradé radial (#fdfcf9 → #ebe8e1),
 * TROIS taches floutées animées (ambre, jaune, ardoise) et une grille de
 * points à 10 % de slate-900. Sur une liste, ce décor se lit comme de
 * l'information : un coin plus sombre qu'un autre fait chercher ce qui s'y
 * trouve, et les cartes blanches n'ont plus le même contraste selon l'endroit
 * de l'écran où elles tombent. Un fond de page ne doit rien dire.
 *
 * Le composant reste — c'est lui que montent le workspace ET les pages de
 * connexion, et le supprimer ferait diverger leurs fonds.
 */

export function WorkspaceBackground() {
  return (
    <div
      aria-hidden
      data-workspace-background
      className="fixed inset-0 -z-10"
      style={{ background: 'var(--dash-bg)' }}
    />
  );
}
