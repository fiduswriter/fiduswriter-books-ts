<p align="center">
  <img src="https://git.fiduswriter.org/fiduswriter/fiduswriter-books-ts/raw/branch/main/logo.svg" alt="@fiduswriter/books" width="100" height="100">
</p>

<h1 align="center">@fiduswriter/books</h1>

<p align="center">Book-level importers and exporters for Fidus Writer</p>

---

> **Note:** This package was renamed in 0.2.0. It was previously published in
> the same `@fiduswriter` scope under the longer name
> `@fiduswriter/…-document` (up to 0.1.34); that older package is now deprecated
> on npm, so install `@fiduswriter/books` instead.

## What it does

Implements book-level (composite/multi-document) importers and exporters for
Fidus Writer. Builds on top of `@fiduswriter/document` — reuses its
single-document export filters and composes them into book-level outputs.

### Supported export formats

| Format | Extension | Description |
|--------|-----------|-------------|
| Native Fidus Book | `.fidusbook` | Full book archive with all chapters and assets |
| DOCX | `.docx` | Microsoft Word document |
| ODT | `.odt` | OpenDocument Text |
| LaTeX | `.tex` | LaTeX document |
| HTML | `.html` | Web page |
| EPUB | `.epub` | E-book |
| BITS | `.xml` | Book Interchange Tag Suite (JATS for books) |
| Print | `.pdf` | PDF via Vivliostyle |

## Exports

Main entry exports:

| Export | Description |
|--------|-------------|
| `FIDUSBOOK_VERSION` | Current Fidus Book format version number |

### Subpath exports

| Path | Description |
|------|-------------|
| `./schema` | Book document schema |
| `./importer/native` | Native `.fidusbook` format importer |
| `./exporter/native` | Native `.fidusbook` format exporter |
| `./exporter/docx` | Book to DOCX exporter |
| `./exporter/odt` | Book to ODT exporter |
| `./exporter/latex` | Book to LaTeX exporter |
| `./exporter/html` | Book to HTML exporter |
| `./exporter/epub` | Book to EPUB exporter |
| `./exporter/print` | Book to PDF exporter |
| `./exporter/bits` | Book to BITS exporter |
| `./exporter/tools` | Shared exporter utilities |
| `./i18n` | Internationalization strings |
| `./types` | TypeScript type definitions |

## Installation

```bash
npm install @fiduswriter/books
```

## Usage

```ts
import {FIDUSBOOK_VERSION} from "@fiduswriter/books"
import {NativeBookExporter} from "@fiduswriter/books/exporter/native"
import {DocxBookExporter} from "@fiduswriter/books/exporter/docx"
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run typecheck    # Check types without emitting
npm test             # Run test suite (Jest)
npm run lint         # Lint with ESLint
npm run format:check # Check formatting with Prettier
```

## License

AGPL-3.0 — see [LICENSE](LICENSE) for details.
