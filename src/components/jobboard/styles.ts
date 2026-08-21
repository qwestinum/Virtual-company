/**
 * Feuille de style du jobboard fictif — CSS BRUT, aucun jeton ORQA.
 *
 * L'illusion narrative est le point : le prospect doit percevoir « un site
 * d'emploi tiers », pas une page de plus du produit qu'on lui présente. Un
 * seul emprunt à l'identité ORQA (le fond sand, une couleur d'accent, une
 * police) suffirait à casser l'effet — d'où une palette froide indépendante,
 * définie ici et nulle part ailleurs.
 *
 * Injectée par le layout `/jobs` dans une balise <style>, sur le modèle des
 * pages de réservation. Ni Tailwind, ni variables globales.
 */
export const JOBBOARD_CSS = `
.jb-root {
  --jb-bg: #f1f4f8;
  --jb-surface: #ffffff;
  --jb-ink: #16202e;
  --jb-ink-soft: #5a6a7d;
  --jb-line: #dde3ea;
  --jb-accent: #2c5f9e;
  min-height: 100vh;
  background: var(--jb-bg);
  color: var(--jb-ink);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.6;
}
.jb-header {
  background: var(--jb-surface);
  border-bottom: 1px solid var(--jb-line);
}
.jb-header-inner {
  max-width: 860px; margin: 0 auto; padding: 14px 20px;
  display: flex; align-items: center; gap: 10px;
}
.jb-logo { font-size: 19px; font-weight: 700; letter-spacing: -0.02em; color: var(--jb-accent); }
.jb-logo span { color: var(--jb-ink); font-weight: 600; }
.jb-nav { margin-left: auto; display: flex; gap: 18px; font-size: 13px; color: var(--jb-ink-soft); }
.jb-main { max-width: 860px; margin: 0 auto; padding: 28px 20px 64px; }
.jb-title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
.jb-count { color: var(--jb-ink-soft); font-size: 13px; margin: 0 0 20px; }
.jb-card {
  display: block; background: var(--jb-surface); border: 1px solid var(--jb-line);
  border-radius: 8px; padding: 16px 18px; margin-bottom: 12px;
  text-decoration: none; color: inherit; transition: border-color .15s, box-shadow .15s;
}
.jb-card:hover { border-color: var(--jb-accent); box-shadow: 0 1px 6px rgba(22,32,46,.07); }
.jb-card-title { font-size: 16px; font-weight: 650; margin: 0 0 4px; color: var(--jb-accent); }
.jb-meta { font-size: 13px; color: var(--jb-ink-soft); margin: 0 0 10px; }
.jb-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.jb-tag {
  font-size: 11.5px; padding: 2px 8px; border-radius: 3px;
  background: #eaf1f9; color: #2c5f9e; border: 1px solid #d5e3f2;
}
.jb-ref { font-size: 12px; color: var(--jb-ink-soft); font-variant-numeric: tabular-nums; }
.jb-back { font-size: 13px; color: var(--jb-accent); text-decoration: none; display: inline-block; margin-bottom: 18px; }
.jb-offer-title { font-size: 25px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 6px; }
.jb-offer-ref {
  font-size: 13px; color: var(--jb-ink-soft); margin: 0 0 2px;
  font-variant-numeric: tabular-nums; letter-spacing: .01em;
}
.jb-panel {
  background: var(--jb-surface); border: 1px solid var(--jb-line);
  border-radius: 8px; padding: 22px 24px; margin-top: 20px;
}
.jb-body h2 { font-size: 16px; font-weight: 650; margin: 22px 0 8px; }
.jb-body h3 { font-size: 14.5px; font-weight: 650; margin: 18px 0 6px; }
.jb-body p { margin: 0 0 12px; }
.jb-body ul { margin: 0 0 14px; padding-left: 20px; }
.jb-body li { margin-bottom: 5px; }
.jb-field { display: block; margin-bottom: 14px; }
.jb-label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; }
.jb-input, .jb-file {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 14px;
  padding: 9px 11px; border: 1px solid var(--jb-line); border-radius: 6px;
  background: #fff; color: var(--jb-ink);
}
.jb-input:focus, .jb-file:focus { outline: 2px solid var(--jb-accent); outline-offset: -1px; }
.jb-submit {
  width: 100%; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
  padding: 11px 16px; border: none; border-radius: 6px;
  background: var(--jb-accent); color: #fff; margin-top: 6px;
}
.jb-submit:disabled { background: #97aec8; cursor: not-allowed; }
.jb-hint { font-size: 12px; color: var(--jb-ink-soft); margin: 10px 0 0; }
.jb-error {
  font-size: 13px; color: #9c2b2b; background: #fdf1f1;
  border: 1px solid #f3d5d5; border-radius: 6px; padding: 9px 11px; margin-bottom: 14px;
}
.jb-done { text-align: center; padding: 34px 10px; }
.jb-done-mark { font-size: 30px; margin-bottom: 10px; }
.jb-done h2 { font-size: 19px; margin: 0 0 8px; }
.jb-empty { color: var(--jb-ink-soft); background: var(--jb-surface);
  border: 1px dashed var(--jb-line); border-radius: 8px; padding: 30px; text-align: center; }
.jb-footer { max-width: 860px; margin: 0 auto; padding: 0 20px 40px;
  font-size: 12px; color: var(--jb-ink-soft); }
@media (max-width: 600px) {
  .jb-main { padding: 20px 14px 48px; }
  .jb-panel { padding: 18px 16px; }
  .jb-title, .jb-offer-title { font-size: 21px; }
}
`;
