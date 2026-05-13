import { PublicLanding } from '@/components/landing/PublicLanding';

export const metadata = {
  title: 'QWESTINUM — Entreprise virtuelle',
};

/**
 * Page racine — landing publique.
 *
 * Hero minimaliste avec CTA « Se connecter » vers `/login`. Le lobby
 * des départements (composant `<Lobby />`) a déménagé sur `/app`,
 * route protégée par le middleware.
 */
export default function HomePage() {
  return <PublicLanding />;
}
