/**
 * The data-pipeline scripts next to this package are plain ESM and ship no
 * types. Only the rewrite that locale.test.ts borrows is declared, so that test
 * can hold scripts/build-zh-variant.mjs and src/i18n/variant.ts to the same
 * behaviour instead of trusting a comment.
 */
declare module '*.mjs' {
  export function convert(
    text: string,
    tables: { chars: Record<string, string>; phrases: Record<string, string> },
  ): string
}
