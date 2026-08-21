/**
 * Coquille du jobboard fictif.
 *
 * Volontairement à l'écart de toute l'identité ORQA : sa propre feuille de
 * style (CSS brut injecté ici), son propre nom, sa propre palette. Le layout
 * racine n'apporte que les polices système et la remise à zéro — rien à
 * neutraliser.
 *
 * `noindex` est posé DEUX fois, ici et dans le proxy (en-tête `X-Robots-Tag`) :
 * la balise couvre le rendu, l'en-tête couvre aussi les réponses que le robot
 * obtient sans exécuter la page.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { JOBBOARD_CSS } from '@/components/jobboard/styles';

export const metadata: Metadata = {
  title: 'TalentBoard — offres d’emploi',
  robots: { index: false, follow: false, nocache: true },
};

export default function JobboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="jb-root">
      <style>{JOBBOARD_CSS}</style>
      <header className="jb-header">
        <div className="jb-header-inner">
          <Link href="/jobs" className="jb-logo" style={{ textDecoration: 'none' }}>
            ◈ talent<span>board</span>
          </Link>
          <nav className="jb-nav" aria-label="Navigation">
            <span>Offres</span>
            <span>Entreprises</span>
            <span>Conseils</span>
          </nav>
        </div>
      </header>
      {children}
      <footer className="jb-footer">
        TalentBoard — plateforme de démonstration. Les offres publiées ici sont
        fictives.
      </footer>
    </div>
  );
}
