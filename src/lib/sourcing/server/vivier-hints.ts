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

export async function findVivierHints(profiles: SourcingProfileView[]): Promise<Map<string, string>> {
  const hints = new Map<string, string>();
  try {
    const candidates = profiles
      .map((p) => ({ p, name: splitName(p), company: p.snapshot.current?.company?.trim() ?? null }))
      .filter((c): c is { p: SourcingProfileView; name: { first: string; last: string }; company: string } => !!c.name && !!c.company);
    if (candidates.length === 0) return hints;

    const db = requireServerSupabase();
    for (const part of chunk(candidates, 40)) {
      const or = part.map((c) => `nom.ilike.${escapeFilter(c.name.last)}`).join(',');
      const { data, error } = await db.from('vivier_candidates').select('id, nom, prenom').or(or).limit(500);
      if (error) return hints;
      const rows = (data ?? []) as { id: string; nom: string; prenom: string | null }[];
      for (const c of part) {
        const sameName = rows.filter(
          (r) => fold(r.nom) === fold(c.name.last) && r.prenom !== null && fold(r.prenom) === fold(c.name.first),
        );
        for (const r of sameName) {
          const hit = await db
            .from('vivier_candidates')
            .select('id')
            .eq('id', r.id)
            .textSearch('cv_tsv', escapeFilter(c.company), { config: 'french', type: 'websearch' })
            .limit(1);
          if (!hit.error && (hit.data ?? []).length > 0) {
            hints.set(c.p.id, r.id);
            break;
          }
        }
      }
    }
  } catch {
    return hints;
  }
  return hints;
}
