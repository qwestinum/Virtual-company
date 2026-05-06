import type { CVAnalysisCriteria } from '@/types/cv-analysis';
import type { FDPInProgress } from '@/types/field-collection';

/**
 * Projette une FDP qualifiée en critères CV Analyzer. Tolère des
 * valeurs partielles (champs vides → omis, pas de chaîne vide).
 */
export function fdpToCVCriteria(fdp: FDPInProgress): CVAnalysisCriteria {
  const fields = fdp.fields;
  const asString = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  };
  const asArray = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out = v
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x) => x.length > 0);
    return out.length > 0 ? out : undefined;
  };

  const criteria: CVAnalysisCriteria = {};
  const title = asString(fields.job_title?.value);
  const seniority = asString(fields.seniority?.value);
  const contractType = asString(fields.contract_type?.value);
  const location = asString(fields.location?.value);
  const salaryRange = asString(fields.salary_range?.value);
  const missions = asArray(fields.main_missions?.value);
  const skills = asArray(fields.key_skills?.value);

  if (title) criteria.jobTitle = title;
  if (seniority) criteria.seniority = seniority;
  if (contractType) criteria.contractType = contractType;
  if (location) criteria.location = location;
  if (salaryRange) criteria.salaryRange = salaryRange;
  if (missions) criteria.mainMissions = missions;
  if (skills) criteria.keySkills = skills;

  return criteria;
}
