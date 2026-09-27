import { TodayScreen } from '@/components/today/TodayScreen';

export const metadata = { title: "Aujourd'hui — QWESTINUM" };

/**
 * Entrée par défaut du workspace : ce qui attend une action, et rien d'autre.
 *
 * Elle remplace le « Bureau », qui montrait l'organigramme des agents — une
 * image du SYSTÈME là où le recruteur vient chercher son TRAVAIL. L'équipe et
 * la répartition par zone ont rejoint « Pilotage ».
 */
export default function AujourdhuiPage() {
  return <TodayScreen />;
}
