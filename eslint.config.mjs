import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // These checks enforce React Compiler constraints. This application does
    // not enable the compiler, so treating them as runtime correctness issues
    // creates false failures. Standard hooks and dependency rules remain on.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
  {
    // These authenticated/user-generated media surfaces use transient remote
    // and blob URLs that cannot safely pass through the Next image optimizer.
    files: [
      "app/feed-v2/create/page.tsx",
      "app/feed-v2/profile/**/page.tsx",
      "components/face-gate.tsx",
      "components/vendor-dashboard-videos-client.tsx",
    ],
    rules: { "@next/next/no-img-element": "off" },
  },
  {
    files: ["scripts/**/*.{js,mjs}"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".vercel/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
