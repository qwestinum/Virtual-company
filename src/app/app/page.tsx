import { Lobby } from '@/components/lobby/Lobby';

export const metadata = {
  title: 'Lobby — QWESTINUM',
};

/**
 * Lobby des départements (route protégée).
 *
 * Accessible après authentification. Le middleware s'occupe de rediriger
 * vers `/login` si la session est absente, donc on rend directement.
 */
export default function AppLobbyPage() {
  return <Lobby />;
}
