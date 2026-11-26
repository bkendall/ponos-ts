# PR 3: Repo, Packaging & CI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MIT `LICENSE`, remove legacy `cloudbuild.yaml`, upgrade CI to `rabbitmq:4`, modernize `package.json` `exports` + sourcemaps, prune unused devDependencies, enable repo-wide `tsc` and ESLint across tests/examples/resources, and fix `example/simple-worker.ts` shutdown handling.

**Architecture:** `tsconfig.json` stays scoped to `src/**/*` -> `lib/` (with `declarationMap` and `sourceMap` enabled), while a new `tsconfig.check.json` (`noEmit: true`, `rootDir: "."`) covers `src/`, `test/`, `test-functional/`, `example/`, and `resources/` for both `npm run typecheck` and `eslint.config.js`. `package.json` adds `"types"` and `"exports"` entries and drops unused `ts-node` and `source-map-support`.

**Tech Stack:** TypeScript 6 (`NodeNext` ESM, `strict: true`), Node.js `>= 22`, ESLint 10 + Prettier, Mocha + Chai + Sinon + `tsx` + `c8`.

**Spec:** [docs/superpowers/specs/2026-11-26-pr3-repo-packaging-and-ci-cleanup-design.md](../specs/2026-11-26-pr3-repo-packaging-and-ci-cleanup-design.md)

## Global Constraints

- Node.js `>= 22.0.0`, ESM (`"type": "module"`, `"module": "NodeNext"`), `"strict": true`.
- `npm run build` must emit flat `lib/index.js` + `.d.ts` + `.map` files from `src/` only (never `lib/src/` or `lib/test/`).
- No runtime behavior changes to `src/`.

## Review Focus

- `npm pack --dry-run` must contain `LICENSE`, `README.md`, `package.json`, and `lib/*` (`.js`, `.js.map`, `.d.ts`, `.d.ts.map`), without `docs/`, `test/`, `example/`, or `tsconfig.check.json`.
- `eslint` must enforce `@typescript-eslint/no-unsafe-function-type` and `@typescript-eslint/no-unused-vars` cleanly across all TS files, scoping `@typescript-eslint/no-unused-expressions: "off"` strictly to test files for Chai assertions.
- `tsc -p tsconfig.check.json` must catch type errors in tests/examples without affecting `tsc` build output in `lib/`.

---

### Task 1: Add MIT `LICENSE`, Delete `cloudbuild.yaml`, and Bump CI to `rabbitmq:4`

**Files:**
- Create: `LICENSE`
- Delete: `cloudbuild.yaml`
- Modify: `.github/workflows/ci.yml:20-24`

- [ ] **Step 1:** Create `LICENSE` (MIT, `Copyright (c) Bryan Kendall`), `git rm cloudbuild.yaml`, and update `.github/workflows/ci.yml` `image: rabbitmq:3` -> `image: rabbitmq:4`.
- [ ] **Step 2:** Commit: `chore(ci,repo): add MIT LICENSE, remove legacy cloudbuild.yaml, and test against RabbitMQ 4`.

---

### Task 2: Modernize Packaging, Prune Dead DevDeps, Enable Repo-Wide `tsc` & ESLint, and Fix `example/simple-worker.ts`

**Files:**
- Modify: `package.json` & `package-lock.json`
- Modify: `tsconfig.json`
- Create: `tsconfig.check.json`
- Modify: `eslint.config.js`
- Modify: `example/simple-worker.ts`
- Modify: `test/server.ts`, `test/rabbitmq.ts`, `resources/mocha-bootstrap.ts`

- [ ] **Step 1:** Run `npm uninstall --ignore-scripts ts-node source-map-support`.
- [ ] **Step 2:** Add `"types": "./lib/index.d.ts"`, `"exports"`, and updated `"lint"`, `"typecheck"`, `"test"` scripts to `package.json`; add `"declarationMap": true` and `"sourceMap": true` to `tsconfig.json`; create `tsconfig.check.json`.
- [ ] **Step 3:** Update `eslint.config.js` to use `./tsconfig.check.json`, include `resources/**/*.ts`, allow `_`-prefixed unused args/vars, and disable `no-unused-expressions` only in `test/**/*.ts` and `test-functional/**/*.ts`.
- [ ] **Step 4:** Fix `createDeferred()` typing in `test/server.ts`, replace `Function` annotations in `test/rabbitmq.ts`, add clean `SIGINT`/`SIGTERM` shutdown + exit codes in `example/simple-worker.ts`, and format all TS files with Prettier.
- [ ] **Step 5:** Run `npm run clean && npm test && npm run coverage && npm pack --dry-run` and verify all checks pass and tarball layout is flat `lib/*`.
- [ ] **Step 6:** Commit: `chore(pkg,lint): add package exports, sourcemaps, and repo-wide typecheck and lint`.
