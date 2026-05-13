import { Lobby } from '@/components/lobby/Lobby';

export const metadata = {
  title: 'QWESTINUM — Entreprise virtuelle',
};

/**
 * Page racine — Lobby de l'entreprise virtuelle (Session 7).
 *
 * Chaque département est présenté en carte. Seul le RH ouvre vers
 * `/rh` pour aujourd'hui. Le détail des animations vit dans
 * `<Lobby />` (client component).
 */
export default function HomePage() {
  return <Lobby />;
}
