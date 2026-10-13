/**
 * Book export initiation.
 *
 * Wraps every book exporter of this package in the chapter-data preloading
 * and progress reporting the dialog's export menu needs, and delivers the
 * resulting Blob through the host-supplied
 * {@link BookExportContext.deliver}.
 *
 * The exporters themselves are environment-agnostic: they load chapter data
 * through injected strategies (defaulting to no-ops) and simply return the
 * produced Blob. Preloading here with the host's `chapterLoader`/`e2ee` makes
 * the exporters' own internal `getMissingChapterData` call a no-op.
 */

import type {ProgressCallback} from "@fiduswriter/document/exporter/tools/progress"
import {BITSBookExporter} from "../../exporter/bits/index.js"
import {DOCXBookExporter} from "../../exporter/docx/index.js"
import {EpubBookExporter} from "../../exporter/epub/index.js"
import {HTMLBookExporter} from "../../exporter/html/index.js"
import {LatexBookExporter} from "../../exporter/latex/index.js"
import {NativeBookExporter} from "../../exporter/native/index.js"
import {ODTBookExporter} from "../../exporter/odt/index.js"
import {PrintBookExporter} from "../../exporter/print/index.js"
import {getMissingChapterData} from "../../exporter/tools.js"
import type {Book, DocumentListEntry} from "../../types.js"
import {addAlert, addProgress, gettext} from "fwtoolkit"
import type {ContentMenuInit} from "fwtoolkit/content_menu"
import type {BookExportContext} from "./types.js"

/**
 * The subset of a book exporter this module needs. Every exporter of
 * `@fiduswriter/books-document` exposes these members; the declared return
 * type of `init()` differs slightly between them (some return `false`, some
 * `void`, instead of a Blob), so it is kept loose here. `mimeType` likewise
 * only exists on the DOCX/ODT exporters, which read it off the instance.
 */
export interface BookExporterLike {
    book: Book
    defaultFilename: string
    // Declared inconsistently across the exporters: some resolve to `false`
    // or nothing, and BITS/DOCX/ODT can return `false` synchronously.
    init(
        progressCallback?: ProgressCallback
    ): Promise<Blob | false | void> | false
}

/**
 * Arguments passed to the callbacks of the single-book export menu. The
 * dialog assembles them once and hands them to every entry.
 */
export interface BookExportMenuArgs {
    /**
     * Persist the book before exporting. Receives the id of the export that
     * triggered it; a host that hands the session to a new window on the
     * first save (untitled book promotion) resolves falsy there and resumes
     * the export itself, so the menu must not run it again in this window.
     */
    saveBook: (exportId?: string) => Promise<unknown>
    book: Book
    documentList: DocumentListEntry[]
    context: BookExportContext
}

/** Ids of the book export menu entries, stable across translations. */
export type BookExportId =
    | "bits"
    | "epub"
    | "html"
    | "unified-html"
    | "latex"
    | "docx"
    | "odt"
    | "print"
    | "fidusbook"

/**
 * Run the export behind a menu entry, looked up by id. Hosts that resume an
 * export after an untitled-book promotion use this to re-run the chosen
 * export in the new window.
 */
export const runBookExportAction = (
    id: BookExportId,
    args: BookExportMenuArgs
): void => {
    const {book, documentList, context} = args
    switch (id) {
        case "bits":
            exportBITS(book, documentList, context)
            break
        case "epub":
            exportEpub(book, documentList, context)
            break
        case "html":
            exportHTML(book, documentList, context, true)
            break
        case "unified-html":
            exportSingleHTML(book, documentList, context)
            break
        case "latex":
            exportLatex(book, documentList, context)
            break
        case "docx":
            exportDOCX(book, documentList, context)
            break
        case "odt":
            exportODT(book, documentList, context)
            break
        case "print":
            exportPrint(book, documentList, context)
            break
        case "fidusbook":
            exportFidusbook(book, documentList, context)
            break
    }
}

/** One export menu entry: persists the book, then exports (unless the save
 * resolved falsy, meaning a host handed the session over and resumes the
 * export in the new window itself). */
const exportAction =
    (id: BookExportId) =>
    (page: unknown): void => {
        const args = page as BookExportMenuArgs
        args.saveBook(id).then(result => {
            if (result) {
                runBookExportAction(id, args)
            }
        })
    }

/** Model of the book dialog's export menu (a content menu of actions). */
export type BookExportMenu = ContentMenuInit

/**
 * Load any missing chapter data (fetching content lazily and decrypting E2EE
 * chapters), run the given exporter, then hand the resulting Blob to the
 * host's `deliver`.
 *
 * @param exporter - A constructed book exporter instance.
 * @param documentList - Document entries for the book's chapters.
 * @param context - The host's schema, chapter loader, E2EE strategy and
 *   delivery callback.
 * @param mimeType - MIME type of the produced file.
 * @param rawContent - Whether the exporter needs doc.rawContent.
 */
export const runBookExport = (
    exporter: BookExporterLike,
    documentList: DocumentListEntry[],
    context: BookExportContext,
    mimeType: string,
    rawContent = false
): Promise<unknown> => {
    const {schema, chapterLoader, e2ee, deliver} = context
    const formatName =
        exporter.defaultFilename.split(".").pop()?.toUpperCase() ||
        gettext("Book")
    const task = addProgress(
        "info",
        `${exporter.book.title}: ${gettext("Exporting")} ${formatName}...`,
        {autoClose: 6000}
    )
    const progressCallback: ProgressCallback = (message, percentage) =>
        task.update(percentage ?? null, message)

    return getMissingChapterData(exporter.book, documentList, schema, {
        rawContent,
        loader: chapterLoader,
        e2ee,
        progressCallback
    })
        .then(() => exporter.init(progressCallback))
        .then(blob => {
            task.update(100, gettext("Export complete."))
            if (blob) {
                const extension = `.${exporter.defaultFilename.split(".").pop()}`
                deliver(blob, exporter.defaultFilename, {
                    description: exporter.book.title,
                    mimeType,
                    extensions: [extension]
                })
            }
            return blob
        })
        .catch((error: unknown) => {
            task.close()
            // fwtoolkit's `get` rejects with the Response itself on HTTP
            // errors, which carries no message; surface something useful.
            const message =
                error instanceof Error
                    ? error.message
                    : error instanceof Response
                      ? `${gettext("Could not load")} ${error.url || "resource"} (HTTP ${error.status}).`
                      : String(error ?? "")
            addAlert("error", message || gettext("Book export failed."))
        })
}

/** Export a book as an Epub file. */
export const exportEpub = (
    book: Book,
    documentList: DocumentListEntry[],
    context: BookExportContext
) =>
    runBookExport(
        new EpubBookExporter(
            context.schema,
            context.csl,
            context.bookStyles,
            book,
            context.user,
            documentList,
            bookUpdated(book)
        ),
        documentList,
        context,
        "application/epub+zip"
    )

/** Export a book as a BITS (Book Interchange Tag Set) file. */
export const exportBITS = (
    book: Book,
    documentList: DocumentListEntry[],
    context: BookExportContext
) =>
    runBookExport(
        new BITSBookExporter(
            context.schema,
            context.csl,
            book,
            context.user,
            documentList,
            bookUpdated(book)
        ),
        documentList,
        context,
        "application/zip"
    )

/** Export a book as a multi-file HTML archive. */
export const exportHTML = (
    book: Book,
    documentList: DocumentListEntry[],
    context: BookExportContext,
    multiDoc = true
) =>
    runBookExport(
        new HTMLBookExporter(
            context.schema,
            context.csl,
            context.bookStyles,
            book,
            context.user,
            documentList,
            bookUpdated(book),
            multiDoc
        ),
        documentList,
        context,
        "application/zip"
    )

/** Export a book as a single-file HTML archive. */
export const exportSingleHTML = (
    book: Book,
    documentList: DocumentListEntry[],
    context: BookExportContext
) => exportHTML(book, documentList, context, false)

/** Export a book as LaTeX. */
export const exportLatex = (
    book: Book,
    documentList: DocumentListEntry[],
    context: BookExportContext
) =>
    runBookExport(
        new LatexBookExporter(
            context.schema,
            book,
            context.user,
            documentList,
            bookUpdated(book)
        ),
        documentList,
        context,
        "application/zip"
    )

/** Export a book as DOCX, using the book's DOCX template. */
export const exportDOCX = (
    book: Book,
    documentList: DocumentListEntry[],
    context: BookExportContext
) => {
    const exporter = new DOCXBookExporter(
        context.schema,
        context.csl,
        book,
        context.user,
        documentList,
        bookUpdated(book)
    )
    return runBookExport(
        exporter,
        documentList,
        context,
        exporter.mimeType,
        true
    )
}

/** Export a book as ODT, using the book's ODT template. */
export const exportODT = (
    book: Book,
    documentList: DocumentListEntry[],
    context: BookExportContext
) => {
    const exporter = new ODTBookExporter(
        context.schema,
        context.csl,
        book,
        context.user,
        documentList,
        bookUpdated(book)
    )
    return runBookExport(
        exporter,
        documentList,
        context,
        exporter.mimeType,
        true
    )
}

/** Open a book's print/PDF view. */
export const exportPrint = (
    book: Book,
    documentList: DocumentListEntry[],
    context: BookExportContext
) =>
    runBookExport(
        new PrintBookExporter(
            context.schema,
            context.csl,
            context.bookStyles,
            book,
            context.user,
            documentList
        ),
        documentList,
        context,
        "text/html"
    )

/** Export a book as a native `.fidusbook` file. */
export const exportFidusbook = (
    book: Book,
    documentList: DocumentListEntry[],
    context: BookExportContext
) =>
    runBookExport(
        new NativeBookExporter(
            context.schema,
            book,
            context.user,
            documentList,
            bookUpdated(book)
        ),
        documentList,
        context,
        "application/vnd.fiduswriter.book+zip"
    )


/** Timestamp for export archives: the book's `updated` when the host
 * maintains it, otherwise now. Passing 0 (the desktop's fresh books) made
 * every zip entry 1970-01-01, which zip tooling then misreads as a date in
 * 2098 (DOS dates cannot represent pre-1980). */
const bookUpdated = (book: Book): number =>
    book.updated || Math.floor(Date.now() / 1000)

/**
 * Model of the book dialog's export menu.
 *
 * Every entry saves the book first, so an export always reflects what is on
 * screen. The DOCX and ODT entries are disabled while the book has no
 * matching template.
 */
export const bookExportMenuModel = (): BookExportMenu => ({
    content: [
        {
            type: "action",
            title: gettext("Export as BITS"),
            tooltip: gettext("Export book as Book Interchange Tag Set."),
            action: exportAction("bits")
        },
        {
            type: "action",
            title: gettext("Export as Epub"),
            tooltip: gettext("Export book as Epub."),
            action: exportAction("epub")
        },
        {
            type: "action",
            title: gettext("Export as HTML"),
            tooltip: gettext("Export book as HTML."),
            action: exportAction("html")
        },
        {
            type: "action",
            title: gettext("Export as Unified HTML"),
            tooltip: gettext("Export book as Single-file HTML."),
            action: exportAction("unified-html")
        },
        {
            type: "action",
            title: gettext("Export as LaTeX"),
            tooltip: gettext("Export book as LaTeX."),
            action: exportAction("latex")
        },
        {
            type: "action",
            title: gettext("Export as DOCX"),
            tooltip: gettext("Export book as DOCX."),
            action: exportAction("docx"),
            disabled: (page: unknown) => !(page as BookExportMenuArgs).book.docx_template
        },
        {
            type: "action",
            title: gettext("Export as ODT"),
            tooltip: gettext("Export book as ODT."),
            action: exportAction("odt"),
            disabled: (page: unknown) => !(page as BookExportMenuArgs).book.odt_template
        },
        {
            type: "action",
            title: gettext("Export to Print/PDF"),
            tooltip: gettext("Export book to the print dialog."),
            action: exportAction("print")
        },
        {
            type: "action",
            title: gettext("Export as Fidusbook"),
            tooltip: gettext(
                "Export book as a .fidusbook file (for moving to another server)."
            ),
            action: exportAction("fidusbook")
        }
    ]
})