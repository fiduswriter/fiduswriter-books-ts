# AGENTS.md — @fiduswriter/books

This file contains information for AI coding agents working on the
`fiduswriter-books-ts` repository. Read this first if you are unfamiliar
with the project.

## Project overview

`@fiduswriter/books` is a TypeScript library that implements
book-level importers and exporters for Fidus Writer. It builds on top of
`@fiduswriter/document` and is consumed by the `book` app bundled with the
`fiduswriter-server-backend` repository and by the `@fiduswriter/cli`
command-line converter.

- Package name: `@fiduswriter/books`
- License: `AGPL-3.0`
- Repository: `https://git.fiduswriter.org/fiduswriter/fiduswriter-books-ts.git`
- Author: Johannes Wilm

## Scope

Code in this repository should be limited to:

- Composite book export filters: native `.fidusbook`, DOCX, ODT, LaTeX, HTML,
  EPUB, BITS, print (`src/exporter/`).
- Book import filters: native `.fidusbook` (`src/importer/`).
- Shared book schema and tools.

Do **not** put in this repository:

- Pure UI components (those belong in `fwtoolkit`).
- Django-specific logic.
- End-to-end encryption code.
- Single-document import/export logic that is not specific to books (that
  belongs in `@fiduswriter/document`).

## Technology stack

- **Language:** TypeScript 6.0+.
- **Module system:** ESM (`"type": "module"`).
- **Build tool:** `tsc` only; no bundler is used.
- **Test runner:** Jest with `ts-jest` and `--experimental-vm-modules`.

## Directory layout

```
.
├── src/                  # TypeScript source files
│   ├── schema/           # Book schema definitions
│   ├── importer/         # Book import filters
│   ├── exporter/         # Book export filters
│   └── i18n.ts           # Book-level i18n helpers
├── css/                  # Book export stylesheet (book.css)
├── dist/                 # Compiled JS, .d.ts and source maps (generated)
├── test/                 # Jest tests
├── package.json
├── tsconfig.json
└── jest.config.js
```

## Build and test commands

```bash
# Install dependencies
pnpm install

# Compile TypeScript to dist/
pnpm run build

# Run the Jest test suite
pnpm test

# Run linting and formatting checks
pnpm run lint
pnpm run format:check
```

This repository uses pnpm for day-to-day development. Run `pnpm install` to
install dependencies; `package-lock.json` is not tracked (pnpm maintains
`pnpm-lock.yaml`).

## Pre-commit / pre-publish

- `pnpm run prepare` runs `pnpm run build`.
- `npm publish` triggers `prepublishOnly`, which also builds.
- There is no pre-commit hook in this repository; rely on CI and run tests
  before committing.

## Code style guidelines

- Use ES modules and TypeScript strict mode.
- Import local files with the `.js` extension even when the source file is
  `.ts`, e.g. `import {Book} from "./schema/index.js"`.
- Avoid `any` unless necessary.
- Keep the library backend-agnostic; do not import Django or browser-only APIs.

## Testing instructions

Tests live in `test/` and run with Jest.

- Use `pnpm test` to run the full suite.
- Tests cover book import/export round-trips and template handling.

## Consumers

This library is consumed by:

- the `book` app of `fiduswriter-server-backend` for book export logic.
- `@fiduswriter/cli` for command-line book conversion.

When publishing a new version, update those consumers and run their tests.

## Release checklist

- Ensure `pnpm run build` succeeds.
- Ensure `pnpm test` passes.
- Update `package.json` version if needed (`npm version patch|minor|major`).
- `npm publish` triggers `prepublishOnly`, which builds.
- Push commits and tags.
- Update downstream consumers (`@fiduswriter/cli`, and
  `fiduswriter-server-backend`'s `fiduswriter/book/package.json5`).

## Useful references

- `package.json` — scripts, exports and dependency versions.
- `tsconfig.json` — compiler options.
- `src/index.ts` — canonical list of public exports.
- `@fiduswriter/document` — the underlying document library this package builds
  on.
