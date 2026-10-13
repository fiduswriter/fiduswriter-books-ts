/**
 * Host-injected types for the book dialog.
 *
 * The dialog is browser-only but backend-agnostic: everything that differs
 * between the Django backend, a Nextcloud install and a local `.fidusbook`
 * file is described by the interfaces in this module.
 *
 * `ChapterLoader` and `E2EEStrategy` are the seams the exporters already use
 * (see `../../types.js`); the remaining host-specific concerns -- persisting
 * the edited book, picking a cover image, uploading a DOCX/ODT template and
 * handing a finished export to the user -- are declared here, following the
 * same injection pattern.
 */

import type {Schema} from "prosemirror-model"
import type {
    Book,
    BookCoverImage,
    BookStyle,
    BookStyles,
    Chapter,
    ChapterLoader,
    CSL,
    DocumentListEntry,
    E2EEStrategy,
    User
} from "../../types.js"

/** One tab of the book dialog. */
export interface BookDialogPart {
    title: string
    description: string
    template: (bookInfo: BookDialogInfo) => string
}

/**
 * The image database entries a book dialog renders cover previews from.
 *
 * The dialog adds the book's own cover image to the host's image database
 * before rendering, so this is a plain record rather than an image manager
 * instance.
 */
export interface BookDialogImageDB {
    db: Record<number, {image?: string; [key: string]: unknown}>
}

/** The bundle every book-dialog tab template receives. */
export interface BookDialogInfo {
    book: Book
    documentList: DocumentListEntry[]
    /** Citation style catalog: style id → human-readable title. */
    citationStyles: Record<string, string>
    bookStyleList: BookStyle[]
    imageDB: BookDialogImageDB
    /**
     * The host offers a picker for standalone files
     * (`backend.pickChapters`), so the chapters tab renders its button.
     */
    canPickChapters?: boolean
    /**
     * The host can open a chapter's source document
     * (`backend.openChapter`), so chapter titles render as links.
     */
    canOpenChapters?: boolean
    /**
     * The chapters tab shows the server-style document catalog ("My
     * documents" tree with the add-arrow). File-based hosts that add
     * chapters exclusively through the picker turn it off.
     */
    chapterCatalog?: boolean
}

/** A cover image the user picked through the host's image picker. */
export interface BookDialogCoverImage {
    /** Id of the picked image. */
    id: number
    /** The image database entry, so the dialog can render a preview. */
    data: BookCoverImage
}

/** Hands a finished export to the user. */
export type BookExportDeliverer = (
    blob: Blob,
    filename: string,
    options: {description?: string; mimeType?: string; extensions?: string[]}
) => unknown

/**
 * Host-specific operations the book dialog needs in order to persist what the
 * user edits.
 *
 * Everything except {@link BookDialogBackend.saveBook} is optional. A host
 * that does not implement `selectCoverImage`, `saveDocxTemplate` or
 * `saveOdtTemplate` simply does not get the corresponding buttons or tabs in
 * the dialog, which is what a local-file host without template support wants.
 */
export interface BookDialogBackend {
    /**
     * Persist the edited book record.
     *
     * @param book - The book as edited in the dialog. The dialog hands over
     *   its working copy, so hosts must not rely on the object staying
     *   unmodified afterwards.
     * @param exportId - Set when the save precedes a book export (the export
     *   menu passes the id of the export that triggered it). Hosts whose
     *   first save hands the session over to a new window (an untitled book
     *   being promoted to a real path) use it to resume that export in the
     *   new window instead of dropping it; hosts without such a flow ignore
     *   it.
     * @returns A promise resolving to the stored book record. Its `id`,
     *   `added` and `updated` fields are copied back onto the dialog's book.
     *   Resolve to `false` when the save handed the session over to a new
     *   window (an untitled book promoted to its real path) and the export
     *   that triggered it is resumed there — the caller must then not run
     *   the export in this window.
     */
    saveBook(book: Book, exportId?: string): Promise<Book | false>

    /**
     * Open the host's image picker so the user can choose a book cover.
     *
     * @param currentCoverImageId - The currently selected cover image id, or
     *   `false` when the book has none, so the picker can preselect it.
     * @returns A promise resolving to the picked image, or to `null`/`false`
     *   when the user removed the cover image.
     */
    selectCoverImage?(
        currentCoverImageId: number | false
    ): Promise<BookDialogCoverImage | null | false>

    /**
     * Upload a DOCX template file and attach it to the book.
     *
     * @returns A promise resolving to the stored template's URL, or `null`
     *   when the upload was not stored.
     */
    saveDocxTemplate?(book: Book, file: File): Promise<string | null>

    /**
     * Upload an ODT template file and attach it to the book.
     *
     * @returns A promise resolving to the stored template's URL, or `null`
     *   when the upload was not stored.
     */
    saveOdtTemplate?(book: Book, file: File): Promise<string | null>

    /**
     * Let the user pick standalone documents to add as chapters through the
     * host's own picker (a native file dialog, a WebDAV file picker, …).
     *
     * This is the file-based equivalent of the server's document catalog: a
     * host without a document database cannot list "all documents the user
     * has access to" up front, so it offers a picker instead.
     *
     * @returns A promise resolving to one stub entry per picked file --
     *   `id`, `title`, `path`, `external: true` and no content. The dialog
     *   merges the entries into its document list and adds them as chapters
     *   with the matching `path`; the host resolves the content when the book
     *   is saved or exported.
     */
    pickChapters?(): Promise<DocumentListEntry[]>

    /**
     * Open a chapter's source document for editing.
     *
     * Only file-based hosts implement this: the desktop opens the chapter's
     * `.fidus` file in a new editor window. When absent, chapter titles in
     * the chapter list are rendered as plain text.
     */
    openChapter?(chapter: Chapter): void
}

/**
 * What a host must supply to run a book sanity check.
 *
 * Both members are the same seams the book exporters already accept, so a
 * host that can export a book can run a sanity check without extra wiring.
 */
export interface BookDataContext {
    /** ProseMirror schema used to parse decrypted chapter content. */
    schema: Schema
    /** Loads chapters whose content is not in the document list yet. */
    chapterLoader: ChapterLoader
    /** Decrypts end-to-end encrypted chapters. */
    e2ee: E2EEStrategy
}

/**
 * What a host must additionally supply to run a book export.
 *
 * The dialog only offers its export menu when a context of this shape is
 * passed, so hosts that merely want a metadata editor can leave it out.
 */
export interface BookExportContext extends BookDataContext {
    /** Citation style engine used by the exporters. */
    csl: CSL
    /** Book styles used by the epub and print exporters. */
    bookStyles: BookStyles
    /** The logged-in user, stamped into the export. */
    user: User
    /** Hands the finished export to the user. */
    deliver: BookExportDeliverer
}

/**
 * One button in the book dialog's button row.
 *
 * Hosts that render the dialog as a full-window interface (the desktop app,
 * a Nextcloud tab) replace the default Submit/Cancel pair with their own
 * actions and labels. `click` receives the dialog instance, so a button can
 * call `saveBook()`, open the export menu or run host-side logic; by default
 * the dialog closes after the click unless `keepOpen` is set.
 */
export interface BookDialogButton {
    /** Renders the framework's Cancel or Close button (no custom action). */
    type?: "cancel" | "close"
    text?: string
    classes?: string
    icon?: string
    /** Render with a dropdown arrow; the click handler opens the menu. */
    dropdown?: boolean
    /**
     * Keep the dialog open after the click. Defaults to closing it, which
     * is what a confirming button (the default Save) wants.
     */
    keepOpen?: boolean
    click?: (dialog: import("./dialog.js").BookDialog, event?: Event) => unknown
}

/** Constructor options of the book dialog. */
export interface BookDialogOptions extends BookDataContext {
    /**
     * The book to edit. Omit it to create a new book.
     *
     * The dialog works on a shallow copy of the record (with the metadata
     * block merged onto a complete one), leaving the host's own copy intact.
     * The `chapters` array is shared with the original, exactly as the Django
     * backend's dialog behaved.
     */
    book?: Book
    /** Documents the user may add as chapters. */
    documentList: DocumentListEntry[]
    /** Persists the dialog's changes and provides host-only pickers. */
    backend: BookDialogBackend
    /**
     * Export inputs. When omitted, the dialog renders without its export
     * dropdown.
     */
    exportContext?: BookExportContext
    /** Citation style catalog offered in the bibliography tab: id → title. */
    citationStyles?: Record<string, string>
    /** Folder a newly created book is placed in. */
    path?: string
    /** The host's image database, used to render cover previews. */
    imageDB?: BookDialogImageDB
    /** Callbacks invoked after every successful save. */
    onSave?: Array<(book: Book) => Promise<unknown> | unknown>
    /**
     * Show the server-style document catalog ("My documents" tree with an
     * add-arrow) next to the chapter list. Defaults to `true`; file-based
     * hosts that add chapters exclusively through `backend.pickChapters`
     * set it to `false`, which collapses the tab to the chapter table plus
     * an "Add chapters" button.
     */
    chapterCatalog?: boolean
    /**
     * The dialog's buttons. When omitted, the dialog builds its classic row:
     * an Export dropdown (when an export context is given), Save (closing
     * the dialog) and Cancel -- or just Close for a read-only book.
     *
     * Hosts that keep the dialog open as a workspace (desktop, Nextcloud)
     * supply their own row, e.g. Save / Save as… / Close.
     */
    buttons?: BookDialogButton[]
    /** Render the dialog filling the window rather than as a modal box. */
    fullScreen?: boolean
    /** Whether the dialog shows its title-bar close button. */
    canClose?: boolean
    /** Whether Escape closes the dialog. */
    canEscape?: boolean
    /** Called when the dialog has been closed. */
    onClose?: () => void
}