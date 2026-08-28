import { defineConfig } from "oxlint";

// Parallel anti-slop lint lane (Option A, 2026-08-21).
// Vendored from https://github.com/dmmulroy/anti-slop (MIT) — tools/oxlint/anti-slop.
// Run with: pnpm lint:slop
// Intentionally NOT wired into CI/release gates. ESLint (eslint.config.mjs) remains
// the source of truth for linting; this is an additional low-evidence-pattern pass.
export default defineConfig({
  jsPlugins: [
    {
      name: "anti-slop",
      specifier: "./tools/oxlint/anti-slop/src/index.ts",
    },
  ],
  rules: {
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
  },
});
