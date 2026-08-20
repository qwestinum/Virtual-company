import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // ── FRONTIÈRE D'AUTONOMIE DU MODULE DE RÉSERVATION ──────────────────
  // `src/lib/scheduling/**` doit rester extractible en paquet indépendant :
  // il ne connaît ni candidat, ni campagne, ni brief, ni recruteur. Aucun
  // import de l'application hôte (alias `@/`) n'y est donc autorisé — la
  // communication passe par les ports injectés (`configureScheduling`) et par
  // les événements. Un test dédié double cette règle, pour qu'elle tienne même
  // quand le lint n'est pas exécuté.
  // Voir docs/specs/scheduling-module.md §1 et §11.
  {
    files: ["src/lib/scheduling/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*"],
              message:
                "Frontière du module de réservation : aucun import de l'application hôte. " +
                "Passe par les ports injectés (configureScheduling) ou par un événement.",
            },
          ],
        },
      ],
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
