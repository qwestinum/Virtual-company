/**
 * « En recherche » — détection DÉTERMINISTE, liste FERMÉE. PUR.
 * Spec : docs/specs/sourcing.md §4 (mesure : 13 profils sur 306, 4,2 %).
 *
 * Zones lues, et seulement elles : intitulé du poste actuel, titre de profil,
 * section About — toutes issues du texte déjà amputé de `## Social`. Jamais
 * « recherche » seul (ingénieur de recherche, R&D, recherche de financements).
 * Un signal, jamais un filtre : le badge ne retire aucun profil de la liste.
 */

type Rule = { lang: 'fr' | 'en'; expression: string; re: RegExp };

const ADV = String.raw`(?:actuellement|activement|aujourd['’]hui|désormais)`;

const RULES: Rule[] = [
  {
    lang: 'fr',
    expression: 'à la recherche d’un nouveau poste',
    re: new RegExp(
      String.raw`(?:${ADV}\s+)?(?:à la|en) recherche (?:active )?d['’](?:un|une) (?:nouve(?:au|lle) )?(?:poste|emploi|cdi|challenge|défi|opportunit[ée]s?|mission|collaboration|expérience professionnelle)`,
      'i',
    ),
  },
  {
    lang: 'fr',
    expression: 'à la recherche d’opportunités',
    re: /(?:à la|en) recherche (?:active )?(?:de nouvelles |d['’])opportunit[ée]s(?! de (?:financement|marché|business|croissance|synergie))/i,
  },
  {
    lang: 'fr',
    expression: 'je recherche un poste',
    re: /je recherche (?:activement |actuellement )?(?:un|une|mon|ma) (?:nouve(?:au|lle) )?(?:poste|emploi|cdi|opportunit[ée]|mission|challenge)/i,
  },
  { lang: 'fr', expression: 'recherche d’un poste', re: /(?:^|[.\n|•])\s*recherche (?:d['’]un|un) (?:poste|emploi|cdi)/i },
  { lang: 'fr', expression: 'ouvert·e à de nouvelles opportunités', re: /(?:ouvert|ouverte)e? (?:à|aux) (?:de nouvelles |des |toutes |)opportunit[ée]s/i },
  {
    lang: 'fr',
    expression: 'souhaite relever un nouveau défi professionnel',
    re: /souhaite (?:aujourd['’]hui |désormais )?relever un nouveau (?:défi|challenge) professionnel/i,
  },
  { lang: 'fr', expression: 'disponible immédiatement', re: /disponible (?:immédiatement|dès maintenant|dès aujourd['’]hui|rapidement|de suite)/i },
  { lang: 'fr', expression: 'en recherche active', re: /en recherche (?:active|d['’]emploi)/i },
  { lang: 'fr', expression: 'à l’écoute du marché', re: /à l['’]écoute (?:du marché|d['’]opportunit[ée]s)/i },
  { lang: 'fr', expression: 'Disponible', re: /(?:^|[|•·–-])\s*disponible\s*(?:$|[|•·–-])/i },
  { lang: 'en', expression: 'open to new opportunities', re: /open to (?:new |exciting |)(?:opportunities|roles|positions|work|job offers)/i },
  { lang: 'en', expression: '#OpenToWork', re: /#?open ?to ?work\b/i },
  {
    lang: 'en',
    expression: 'looking for a new role',
    re: /(?:currently|actively|now) (?:looking|seeking|searching) for (?:a |an |my |new )(?:new |exciting |full-time |permanent |)(?:role|position|job|opportunit(?:y|ies)|challenge)/i,
  },
  { lang: 'en', expression: 'seeking a new opportunity', re: /(?:i am|i'm|am now|now) seeking (?:a|an|my next) (?:new |exciting |)(?:opportunity|role|position|challenge)/i },
  {
    lang: 'en',
    expression: 'available for new opportunities',
    re: /available for (?:new |freelance |consulting |)(?:[\w/ ]{0,25} )?(?:opportunities|missions|assignments|projects|roles)/i,
  },
  { lang: 'en', expression: 'available immediately', re: /available (?:immediately|asap|now)\b/i },
  { lang: 'en', expression: 'Available', re: /(?:^|[|•·–-])\s*available\s*(?:$|[|•·–-])/i },
];

/** Le contexte l'emporte sur une règle positive (§4.2). */
const FALSE_FRIENDS: RegExp[] = [
  /stage|internship|alternance|apprentissage|end of studies|fin d['’]études/i,
  /ingénieur(?:e)? de recherche|research engineer|recherche et développement|R&D/i,
  /recherche de (?:financements?|solutions|moyens|performance|l['’]excellence)/i,
  /êtes-vous|si vous (?:êtes|recherchez)|vous recherchez|looking for an? [\w ]{0,20}developer\?/i,
  /(?:constamment|toujours|always) (?:à la recherche|seeking|looking|open)/i,
];

export type AvailabilityZone = 'title' | 'headline' | 'about';
export type AvailabilitySignal = { expression: string; zone: AvailabilityZone };

export function detectAvailability(zones: Partial<Record<AvailabilityZone, string | null>>): AvailabilitySignal | null {
  for (const zone of ['title', 'headline', 'about'] as const) {
    const text = zones[zone];
    if (!text) continue;
    for (const sentence of text.split(/(?<=[.!?\n])\s+/)) {
      if (FALSE_FRIENDS.some((f) => f.test(sentence))) continue;
      const rule = RULES.find((r) => r.re.test(sentence));
      if (rule) return { expression: rule.expression, zone };
    }
  }
  return null;
}
