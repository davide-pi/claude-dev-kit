# tsconfig — the options that change outcomes

## First, find out what is actually in effect

A `tsconfig.json` is almost never the whole truth: framework CLIs ship a base config, apps extend it,
and tests extend the app. Three commands settle it:

```powershell
npx tsc --showConfig                    # merged result for the default project
npx tsc --showConfig -p tsconfig.app.json
Select-String -Path tsconfig*.json -Pattern '"extends"'   # walk the chain by hand if it is deep
```

Typical layouts here: a root `tsconfig.json` with `compilerOptions` plus `references`, an app project
(`tsconfig.app.json`), and a test project (`tsconfig.spec.json`). Tightening only the root and
leaving the spec project loose is the usual half-fix — tests then compile against weaker rules than
the code they test.

## Correctness options

| Option | Effect | Verdict |
| --- | --- | --- |
| `strict` | umbrella: `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `useUnknownInCatchVariables`, `alwaysStrict` | mandatory |
| `noUncheckedIndexedAccess` | index and key lookups yield `T \| undefined` | mandatory |
| `exactOptionalPropertyTypes` | `a?: string` no longer accepts an explicit `undefined` | on |
| `noImplicitOverride` | `override` keyword required when overriding | on for class-heavy code |
| `noFallthroughCasesInSwitch` | non-empty case must break/return | on |
| `noImplicitReturns` | every code path returns, or none does | on |
| `noPropertyAccessFromIndexSignature` | index-signature members need bracket access | on for config maps |
| `noUnusedLocals`, `noUnusedParameters` | dead bindings are errors | on, but wire them to lint if CI noise matters |
| `allowUnreachableCode: false` | unreachable code is an error | on |

Sub-flags of `strict` worth knowing individually, because someone will propose disabling one:

- `strictPropertyInitialization` — the one class-heavy code fights with. The fix is `readonly` fields
  set in the constructor or via constructor injection, **not** turning it off and **not** `!` on every
  field. A field genuinely filled by a framework lifecycle hook is the one honest `!` case, and it
  should carry a comment saying which hook fills it.
- `useUnknownInCatchVariables` — makes `catch (e)` `unknown`. Keep it; the alternative is code that
  reads `e.message` off a thrown string.
- `strictFunctionTypes` — parameter bivariance goes away except for method syntax. If a callback type
  suddenly fails to assign, the declaration was unsound before, not now.

## Module, emit and interop

These depend on the toolchain, so **read them, do not choose them**:

| Option | Who decides it | Where to look |
| --- | --- | --- |
| `target`, `lib` | the browser/runtime support matrix and the builder | the framework base config in the `extends` chain; `browserslist` in `package.json` if present |
| `module`, `moduleResolution` | the bundler | the base config; the bundler's own docs via its `package.json` entry |
| `useDefineForClassFields` | `target` and the framework's decorator model | the base config — never override it by hand in a decorator-based app |
| `isolatedModules` | the builder, which compiles file by file | usually already on; keep it |
| `experimentalDecorators`, `emitDecoratorMetadata` | the framework's DI model | present in a decorator-based app, absent otherwise |
| `paths` / path aliases | the bundler must resolve them too | `tsconfig.json` **and** the bundler config — they must agree, or the build and the type-check disagree |
| `verbatimModuleSyntax` | prevents type imports surviving emit | on; forces `import type` where it matters |
| `skipLibCheck` | skips checking `.d.ts` | commonly on for build time; it hides real conflicts between two versions of the same types, so if two packages disagree, turn it off once to see the truth |

`allowJs` without `checkJs` silently drops a folder out of the type system. If a migration needs it,
add `checkJs` and fix, or keep the JS out of the compiled project entirely.

## Adopting strict in a project that has none

1. Baseline: `npx tsc --noEmit --strict 2>&1 | Select-String 'error TS'` — count the errors and group
   them by file, so you know the shape of the debt.
2. Turn `strict` on at the root, plus `noUncheckedIndexedAccess`. Do not soften it back.
3. Fix **by folder**, innermost first (models and utilities before components) — the leaf fixes cascade
   and delete most of the component errors for free.
4. If the tree cannot compile for a day, use one committed, time-boxed exclusion: drop the noisy
   folder out of `include` in a dedicated project, with the folder named in the PR. Never
   `@ts-nocheck` per file — it is invisible in aggregate and never comes back.
5. Add the strict `tsc --noEmit` run to CI **before** starting, so the count can only go down.

Error volume order, most common first: nullability on API models, `strictPropertyInitialization` in
classes, implicit `any` on callback parameters, index access, then `unknown` in catch.

## Project references and multi-project repos

- One project per compilation unit: app, tests, and each library. `references` in the root gives
  incremental builds and stops a test-only type leaking into the app.
- `composite: true` is required on a referenced project, and it forces `declaration` — which is a
  feature, not a nuisance: it surfaces types that were accidentally unexportable.
- The editor picks the project that `include`s the file. When the editor is green and CI is red, the
  file is in a project that CI checks and the editor did not open, or the two projects differ. Compare
  with `npx tsc --showConfig` on both.

## Verifying, not assuming

| Question | Command |
| --- | --- |
| Are the types actually clean? | `npx tsc --noEmit` per project, including the spec project |
| What is really enabled? | `npx tsc --showConfig` |
| Which compiler runs? | `npx tsc --version` plus the devDependency entry in `package.json` |
| Does the bundler agree with `paths`? | build once; a type-check-only pass will never catch a resolution mismatch |
| Is a `.d.ts` conflict being hidden? | flip `skipLibCheck` off once, read, flip back |

Anything that depends on the compiler release — a new option name, a changed default, a new
narrowing behaviour — is verified against the official docs, not from memory.
