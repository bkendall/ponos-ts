# PR 3: Repo, Packaging & CI Cleanup — Design Spec

**Date:** 2026-11-26  
**Scope:** Repository hygiene, modern ESM/TypeScript package metadata, repo-wide typechecking & linting, example shutdown cleanup, and RabbitMQ 4 CI alignment.

---

## Intent & Why

After resolving the critical runtime bugs in PR 1 and PR 2, `ponos-ts` still has several packaging and repository hygiene gaps: a broken `LICENSE` link in `README.md`, a legacy `cloudbuild.yaml` referencing an old GCP KMS-encrypted npm token, missing `exports` and sourcemaps in `package.json` / `tsconfig.json`, unused `ts-node` and `source-map-support` devDependencies, lint/typecheck scripts that ignore `test/`, `test-functional/`, `example/`, and `resources/`, and a CI matrix running end-of-life `rabbitmq:3`.

## Goals

- Add an MIT `LICENSE` matching `package.json` (`"license": "MIT"`) and `README.md`.
- Delete legacy `cloudbuild.yaml` (automated npm publishing will be designed separately later).
- Add modern `"types"` and `"exports"` fields to `package.json`, enable `"declarationMap": true` and `"sourceMap": true` in `tsconfig.json`, and remove unused `ts-node` and `source-map-support`.
- Add `tsconfig.check.json` and update `eslint.config.js` + npm scripts so `npm test` typechecks and lints `src/`, `test/`, `test-functional/`, `example/`, and `resources/`.
- Update `example/simple-worker.ts` for graceful `SIGINT`/`SIGTERM` shutdown and bump `.github/workflows/ci.yml` to `rabbitmq:4`.

## Non-Goals

- Adding a new npm publishing GitHub Actions workflow (deferred).
- Migrating away from Mocha, Chai, Sinon, `c8`, and `tsx`.
- Changing any runtime library behavior in `src/`.

## Anti-Goals

- Emitting test, example, or resource compilation output into `lib/`.
- Weakening TypeScript strictness or ESLint rules on `src/`.

## Constraints

- Node.js `>= 22.0.0`, ESM (`"type": "module"`, TypeScript `"module": "NodeNext"`, `"strict": true`).
- Existing Mocha + `tsx` + `c8` test runner preserved.

## Approaches Considered

### Approach 1 (Chosen): Keep Mocha/Chai/Sinon + `tsx`, prune dead deps, and add `tsconfig.check.json`
- Remove unused `ts-node` and `source-map-support`, keep all 57 existing unit tests intact, and introduce `tsconfig.check.json` (`noEmit: true`) for repo-wide `tsc` and ESLint typed-linting while `tsconfig.json` continues emitting only `src/` into `lib/`.
- **Trade-off**: Minimal diff and zero test rewrites, while keeping the existing test-runner devDependencies.

### Approach 2 (Rejected): Migrate tests to `node:test` or Vitest
- Would drop several test devDependencies (`node:test`) or unify runner/coverage (`vitest`), but mixes a full 57-test suite rewrite into a packaging/CI cleanup PR.
