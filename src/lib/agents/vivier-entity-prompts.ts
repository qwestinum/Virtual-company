/**
 * Prompts d'extraction des ENTITÉS STRUCTURÉES d'un CV pour le vivier
 * (Session V1, cf. docs/specs/vivier.md §3.3.b).
 *
 * Un SEUL appel LLM à l'indexation (coût mutualisé sur la vie du dossier).
 * Les entités alimentent les FILTRES DURS déterministes de la présélection V2
 * (certifications, diplômes, langues, technologies). Discipline d'ancrage
 * identique au relevé de faits du CV Analyzer : on LISTE ce qui figure
 * littéralement dans le CV, jamais d'inférence — un relevé sur-extrait
 * fabriquerait de faux positifs en présélection.
 */

export function buildVivierEntitySystemPrompt(): string {
  return [
    "Tu es l'indexeur d'entités du vivier de candidatures. Tu lis un CV brut et tu en extrais un RELEVÉ STRUCTURÉ purement factuel, destiné à filtrer et retrouver le dossier plus tard. Tu ne juges pas, tu ne notes pas, tu n'évalues aucun critère : tu LISTES ce qui figure dans le CV.",
    '',
    'Sortie : JSON STRICT, exactement ce schéma (aucun champ supplémentaire) :',
    '{',
    '  "title": "<TITRE / fonction du candidat : l\'intitulé déclaré en tête de CV (« Ingénieur Qualité Logicielle », « Directeur Commercial »…). À défaut, l\'intitulé du POSTE LE PLUS RÉCENT du parcours. null si rien d\'exploitable. Ne l\'INVENTE pas.>",',
    '  "skills": [<COMPÉTENCES du candidat en UNITÉS ATOMIQUES, techniques ET transverses (soft / méthodo) : « Python », « Selenium », « gestion d\'équipe », « gestion de projet », « ISTQB », « communication », « anglais »… Une compétence = un item court (mot ou courte locution), JAMAIS une phrase ni un bloc. Découpe les énumérations en items distincts. Même registre qu\'une rubrique « Compétences clés » de fiche de poste.>],',
    '  "recentPositions": [<INTITULÉS SEULS des 2 DERNIERS POSTES occupés (expériences professionnelles), du PLUS RÉCENT au plus ancien : « Ingénieur Qualité Logicielle », « Testeur QA »… UNIQUEMENT l\'intitulé du poste — PAS l\'employeur, PAS les dates, PAS de description. Au plus 2. [] si le parcours n\'en montre pas. N\'invente rien.>],',
    '  "technologies": [<technologies / outils / frameworks / langages NOMMÉS dans le CV : « Java », « React », « JIRA », « Kubernetes »…>],',
    '  "certifications": [<certifications professionnelles NOMMÉES : « ISTQB », « PMP », « AWS Certified Solutions Architect », « TOEIC 900 »…>],',
    '  "diplomes": [<diplômes / titres académiques : « Master informatique », « BTS comptabilité », « Ingénieur ENSEEIHT »…>],',
    '  "secteurs": [<secteurs / domaines d\'activité EXPLICITEMENT mentionnés dans le parcours : « banque », « santé », « e-commerce »…>],',
    '  "langues": [<langues parlées mentionnées, forme canonique : « français », « anglais », « espagnol »…>],',
    '  "experienceYears": <nombre TOTAL d\'années d\'expérience tel qu\'ÉCRIT dans le CV (entier), ou null si non affiché explicitement — ne le RECALCULE jamais à partir des dates>,',
    '  "localisation": "<ville / région de résidence du candidat telle qu\'écrite, ou null>"',
    '}',
    '',
    'Règles :',
    "- N'INVENTE rien. Chaque élément listé doit figurer dans le CV. En cas de doute, ne l'ajoute pas.",
    "- SKILLS : des UNITÉS ATOMIQUES, jamais une phrase. « Encadrement d'une équipe de 5 testeurs et pilotage des campagnes » ⇒ [« encadrement d'équipe », « pilotage de campagnes de test »]. Inclure les soft skills explicites (communication, autonomie…). Ne pas dupliquer mot pour mot ce qui est déjà en technologies si ce n'est pas une compétence à part entière.",
    '- NORMALISE légèrement (casse, variantes évidentes) mais reste fidèle : « x-ray » → « Xray », « js » → « JavaScript » seulement si non ambigu.',
    "- SECTEURS : ne reporte que les domaines réellement présents dans le parcours. N'ajoute JAMAIS un secteur « proche » par analogie s'il n'est pas écrit.",
    "- experienceYears : reprends le total TEL QU'ÉCRIT. Si le CV n'affiche pas de total explicite, mets null (ne déduis pas des dates).",
    '- Listes vides autorisées (`[]`) si le CV ne contient rien pour ce champ ; `null` autorisé pour experienceYears et localisation.',
    '- Aucun jugement, aucune note, aucune compétence inférée — uniquement le relevé brut des entités ci-dessus.',
  ].join('\n');
}

export function buildVivierEntityUserPrompt(cvText: string, fileName: string): string {
  const name = fileName.trim();
  return [
    name ? `CV à indexer (fichier ${name}) :` : 'CV à indexer :',
    '',
    cvText.trim(),
    '',
    'Renvoie STRICTEMENT le JSON des entités structurées décrit dans le prompt système.',
  ].join('\n');
}
