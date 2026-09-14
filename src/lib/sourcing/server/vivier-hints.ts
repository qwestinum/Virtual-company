/**
 * « Peut-être déjà dans votre vivier » — signal IMPARFAIT et assumé (spec §5).
 *
 * Nom (prénom exact + nom approchant) ET entreprise actuelle retrouvée dans le
 * texte du CV. Aucune écriture côté vivier, aucune URL de profil n'y entre :
 * c'est une lecture, à l'affichage, et le recruteur tranche. Homonymes et
 * changements d'employeur sont les limites dites à l'écran.
 *
 * Fail-soft : un signal de confort ne fait jamais échouer la liste.
 */
import { chunk } from '@/lib/db/paginate';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { SourcingProfileView } from '@/types/sourcing';

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const escapeFilter = (v: string): string => v.replace(/[,()*%\\]/g, ' ').trim();

function splitName(p: SourcingProfileView): { first: string; last: string } | null {
  const first = p.snapshot.firstName?.trim() || p.snapshot.name.split(/\s+/)[0] || '';
  const last = p.snapshot.name.slice(p.snapshot.name.indexOf(first) + first.length).trim();
  return first.length >= 2 && last.length >= 2 ? { first, last } : null;
}

const ID_CHUNK = 100;

type Candidate = { p: SourcingProfileView; name: { first: string; last: string }; company: string };
type NameRow = { id: string; nom: string; prenom: string | null };
type Db = ReturnType<typeof requireServerSupabase>;

/** Issue d'une vérification d'entreprise : trouvé, rien, ou exception (arrêt). */
type CompanyCheck = { kind: 'hit'; id: string } | { kind: 'none' } | { kind: 'threw' };

/**
 * Homonymes stricts (nom ET prénom repliés), dans l'ordre des lignes rendues —
 * cet ordre départage quand plusieurs homonymes portent l'entreprise.
 */
export function sameNameRows(rows: readonly NameRow[], name: { first: string; last: string }): NameRow[] {
  return rows.filter(
    (r) => fold(r.nom) === fold(name.last) && r.prenom !== null && fold(r.prenom) === fold(name.first),
  );
}

/** Premier id (dans l'ordre `orderedIds`) présent dans `found`, sinon `null`. */
export function firstFound(orderedIds: readonly string[], found: ReadonlySet<string>): string | null {
  for (const id of orderedIds) if (found.has(id)) return id;
  return null;
}

const companyQuery = (db: Db, ids: string[], company: string) =>
  db
    .from('vivier_candidates')
    .select('id')
    .in('id', ids)
    .textSearch('cv_tsv', escapeFilter(company), { config: 'french', type: 'websearch' })
    .limit(ids.length);

/**
 * Parmi les homonymes d'un profil, le premier (dans l'ordre) dont le CV cite
 * l'entreprise. Une requête groupée pour tous les homonymes ; si elle échoue,
 * repli sur la vérification ligne à ligne d'origine (une erreur sur un homonyme
 * n'y empêchait pas d'essayer le suivant).
 */
async function checkCompany(db: Db, c: Candidate, rows: NameRow[]): Promise<CompanyCheck> {
  try {
    const ids = rows.map((r) => r.id);
    const grouped = await Promise.all(chunk(ids, ID_CHUNK).map((part) => companyQuery(db, part, c.company)));
    if (grouped.every((g) => !g.error)) {
      const found = new Set(grouped.flatMap((g) => ((g.data ?? []) as { id: string }[]).map((r) => r.id)));
      const id = firstFound(ids, found);
      return id ? { kind: 'hit', id } : { kind: 'none' };
    }
    for (const r of rows) {
      const hit = await companyQuery(db, [r.id], c.company);
      if (!hit.error && (hit.data ?? []).length > 0) return { kind: 'hit', id: r.id };
    }
    return { kind: 'none' };
  } catch {
    return { kind: 'threw' };
  }
}

/**
 * Lots de noms lus ENSEMBLE, puis vérifications d'entreprise lancées ensemble ;
 * les résultats s'appliquent dans l'ordre d'origine (lot, puis profil), avec
 * les mêmes arrêts : un lot en erreur ou une exception rend les indices déjà
 * acquis, rien au-delà.
 */
export async function findVivierHints(profiles: SourcingProfileView[]): Promise<Map<string, string>> {
  const hints = new Map<string, string>();
  try {
    const candidates = profiles
      .map((p) => ({ p, name: splitName(p), company: p.snapshot.current?.company?.trim() ?? null }))
      .filter((c): c is Candidate => !!c.name && !!c.company);
    if (candidates.length === 0) return hints;

    const db = requireServerSupabase();
    const batches = await Promise.all(
      chunk(candidates, 40).map(async (part) => {
        try {
          const or = part.map((c) => `nom.ilike.${escapeFilter(c.name.last)}`).join(',');
          const { data, error } = await db.from('vivier_candidates').select('id, nom, prenom').or(or).limit(500);
          if (error) return { kind: 'error' as const };
          const rows = (data ?? []) as NameRow[];
          const checks = await Promise.all(
            part.map((c) => {
              const same = sameNameRows(rows, c.name);
              return same.length === 0 ? Promise.resolve<CompanyCheck>({ kind: 'none' }) : checkCompany(db, c, same);
            }),
          );
          return { kind: 'ok' as const, part, checks };
        } catch {
          return { kind: 'threw' as const };
        }
      }),
    );
    for (const batch of batches) {
      if (batch.kind !== 'ok') return hints;
      for (let i = 0; i < batch.part.length; i += 1) {
        const check = batch.checks[i]!;
        if (check.kind === 'threw') return hints;
        if (check.kind === 'hit') hints.set(batch.part[i]!.p.id, check.id);
      }
    }
  } catch {
    return hints;
  }
  return hints;
}
