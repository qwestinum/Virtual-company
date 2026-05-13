import { DepartmentView } from '@/components/department/DepartmentView';
import type { ServiceCardProps } from '@/components/department/ServiceCard';

export const metadata = {
  title: 'Département RH — QWESTINUM',
};

const RH_SERVICES: ServiceCardProps[] = [
  {
    id: 'recrutement',
    name: 'Recrutement',
    description:
      'Cadrage, diffusion, analyse des CV, entretiens, validation. Le service le plus mature, opérationnel sur démos clients.',
    icon: '🎯',
    accent: 'linear-gradient(135deg, #FFB000, #FF8A00)',
    status: 'active',
    href: '/rh/recrutement',
  },
  {
    id: 'admin-personnel',
    name: 'Administration du personnel',
    description:
      'Contrats, paie, congés, mobilité interne. Cadrage en cours — sortie après stabilisation du recrutement.',
    icon: '📋',
    accent: 'linear-gradient(135deg, #15A364, #12A594)',
    status: 'coming',
  },
  {
    id: 'formation',
    name: 'Formation',
    description:
      "Plans de développement, parcours métier, suivi des compétences. À l'étude.",
    icon: '🎓',
    accent: 'linear-gradient(135deg, #FFB000, #E8710A)',
    status: 'coming',
  },
];

export default function RHDepartmentPage() {
  return (
    <DepartmentView
      meta={{
        id: 'rh',
        name: 'Ressources humaines',
        tagline:
          'Le département RH virtuel — Manager RH au centre, agents spécialisés autour. Sélectionnez un service pour entrer.',
        icon: '🧑‍💼',
        accent: 'linear-gradient(135deg, #FFB000, #FF8A00)',
      }}
      services={RH_SERVICES}
    />
  );
}
