/**
 * The book edit dialog.
 *
 * A reusable, backend-agnostic tabbed dialog for editing a book's metadata,
 * settings, cover image and chapter list, running a sanity check and starting
 * an export. Import it from the `@fiduswriter/books-document/ui/book_dialog`
 * subpath so that the main entry stays free of DOM code and remains usable
 * from Node (as `@fiduswriter/cli` needs).
 *
 * ```js
 * import {BookDialog} from "@fiduswriter/books-document/ui/book_dialog"
 *
 * new BookDialog({
 *     book, // omit to create a new book
 *     documentList,
 *     schema,
 *     chapterLoader, // @fiduswriter/books-document
 *     e2ee, // @fiduswriter/books-document
 *     backend: {
 *         saveBook: book => postJson("/api/book/save/", {book}),
 *         selectCoverImage: id => showImagePicker(id),
 *         saveDocxTemplate: (book, file) => uploadTemplate(book, file)
 *     },
 *     exportContext: {schema, chapterLoader, e2ee, csl, bookStyles, user, deliver: saveFile}
 * }).open()
 * ```
 *
 * `ChapterLoader` and `E2EEStrategy` are the same interfaces the book
 * exporters already accept, so a host that can export a book needs no extra
 * wiring to run a sanity check.
 */

export {BookDialog} from "./dialog.js"
export {
    bookSanityCheck
} from "./sanity_check.js"
export {
    bookBasicInfoTemplate,
    bookBibliographyDataTemplate,
    bookChapterDialogTemplate,
    bookChapterListTemplate,
    bookDialogChaptersTemplate,
    bookDialogTemplate,
    bookDOCXDataRowTemplate,
    bookDOCXDataTemplate,
    bookEpubDataCoverTemplate,
    bookEpubDataTemplate,
    bookODTDataRowTemplate,
    bookODTDataTemplate,
    bookPrintDataTemplate,
    bookSanityCheckTemplate
} from "./templates.js"
export {
    bookExportMenuModel,
    exportBITS,
    exportDOCX,
    exportEpub,
    exportFidusbook,
    exportHTML,
    exportLatex,
    exportODT,
    exportPrint,
    exportSingleHTML,
    runBookExport
} from "./export.js"
export type {
    BookExportMenu,
    BookExportMenuArgs,
    BookExporterLike
} from "./export.js"
export type {
    BookDataContext,
    BookDialogBackend,
    BookDialogButton,
    BookDialogCoverImage,
    BookDialogImageDB,
    BookDialogInfo,
    BookDialogOptions,
    BookDialogPart,
    BookExportContext,
    BookExportDeliverer
} from "./types.js"