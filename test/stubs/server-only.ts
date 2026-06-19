// Test stub for the `server-only` package. In production `import 'server-only'`
// throws if a Server-only module is ever pulled into a Client bundle (the guard
// we want). Under vitest there is no RSC server/client split, so the real package
// throws on import; this no-op stub lets server modules that legitimately import
// 'server-only' be unit-tested. Wired via the alias in vitest.config.ts.
export {}
