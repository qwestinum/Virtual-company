/**
 * Descriptions de poste — seul le texte de la personne entre dans le CV.
 * Fixtures reconstituées sur la structure observée à l'étude, sans donnée réelle.
 */
import { describe, expect, it } from 'vitest';

import { attachDescriptions, parseExperienceSection } from '@/lib/sourcing/experience-descriptions';

const SECTION = `## Experience

### Business Analyst Senior - [Banque Exemple](https://www.linkedin.com/company/banque-exemple) (Current)

Dec 2024 - Present (1 year and 8 months) in Paris, Île-de-France, France

Paris, Île-de-France, France

Pilotage de la refonte des parcours d'épargne salariale.
Ateliers utilisateurs et recette.

Department: Finance & Accounting • Level: Senior

Banque Exemple is a Banking company. Banque Exemple has 10,000-20,000 employees.

### [Groupe Démo](https://www.linkedin.com/company/groupe-demo)

#### Chargée de conformité (Current)

Jan 2018 - Present (5 years) in Région de Paris, France

Au sein du service Trade.

Department: Legal • Level: Specialist

#### Chef de projet

Jan 2015 - Jan 2017 (2 years)

Department: Project Management • Level: Manager

Groupe Démo (DEMO.PA) is a Banking company. Groupe Démo offers a range of financial services.

### Consultante AMOA - [Cabinet Fictif](https://www.linkedin.com/company/cabinet-fictif)

Sep 2012 - Dec 2014 (2 years)

Cabinet Fictif is a Consulting company founded in 2004.

### Chargée d'études - [Agence Publique Démo](https://www.linkedin.com/company/agence-demo)

Jan 2010 - Aug 2012 (2 years)

Statistical studies for the marketing department: segmentation per customer profile.

Agence Publique Démo works for people and planet. Agence Publique Démo has 2,000-3,000 employees (+8-9% YoY), founded in 1941.
`;

describe('section Experience', () => {
  const parsed = parseExperienceSection(SECTION);

  it('un poste par intitulé, groupes d’entreprise compris', () => {
    expect(parsed.map((p) => [p.title, p.company])).toEqual([
      ['Business Analyst Senior', 'Banque Exemple'],
      ['Chargée de conformité', 'Groupe Démo'],
      ['Chef de projet', 'Groupe Démo'],
      ['Consultante AMOA', 'Cabinet Fictif'],
      ["Chargée d'études", 'Agence Publique Démo'],
    ]);
  });

  it('garde le texte de la personne ; jette dates, lieu répété, « Department » et la fiche d’entreprise du moteur', () => {
    expect(parsed[0]!.description).toBe("Pilotage de la refonte des parcours d'épargne salariale. Ateliers utilisateurs et recette.");
    expect(parsed[1]!.description).toBe('Au sein du service Trade.');
    expect(parsed[2]!.description).toBeNull();
    // Pas de ligne « Department » : la fiche d'entreprise est quand même reconnue et écartée.
    expect(parsed[3]!.description).toBeNull();
    // Fiche d'organisme sans le mot « company » : reconnue à l'effectif. Et « department: » dans
    // une phrase de la personne n'est PAS la ligne du moteur.
    expect(parsed[4]!.description).toBe('Statistical studies for the marketing department: segmentation per customer profile.');
    expect(JSON.stringify(parsed)).not.toMatch(/Department|Level:|employees|is a Banking company|Île-de-France/);
  });

  it('rattache au poste structuré du même intitulé, jamais par devinette', () => {
    const work = [
      { title: 'Business Analyst Senior', company: 'Banque Exemple' },
      { title: 'Chargée de conformité', company: 'Groupe Démo' },
      { title: 'Poste inconnu', company: 'Ailleurs' },
    ];
    expect(attachDescriptions(work, parsed).map((w) => w.description)).toEqual([
      "Pilotage de la refonte des parcours d'épargne salariale. Ateliers utilisateurs et recette.",
      'Au sein du service Trade.',
      null,
    ]);
  });

  it('section absente ⇒ rien', () => {
    expect(parseExperienceSection(null)).toEqual([]);
  });
});
