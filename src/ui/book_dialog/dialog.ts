/**
 * The book edit dialog.
 *
 * A tabbed dialog that edits a book's metadata and settings, manages its
 * chapter list (add/remove/reorder, part grouping and per-chapter part
 * titles), picks the cover image, triggers a sanity check and starts an
 * export.
 *
 * Everything host-specific is injected: see `./types.js`. The book *overview*
 * page -- its datatable, bulk actions, sharing, copy and delete -- is not
 * part of this component and stays with the host.
 */

import type {Book, BookMetadata, Chapter, DocumentListEntry} from "../../types.js"
import {
    ContentMenu,
    Dialog,
    FileSelector,
    addAlert,
    findTarget,
    gettext
} from "fwtoolkit"
import type {DialogButtonSpec} from "fwtoolkit"
import {bookExportMenuModel} from "./export.js"
import type {BookExportMenu} from "./export.js"
import {bookSanityCheck} from "./sanity_check.js"
import {
    bookBasicInfoTemplate,
    bookBibliographyDataTemplate,
    bookChapterDialogTemplate,
    bookChapterListTemplate,
    bookDOCXDataRowTemplate,
    bookDOCXDataTemplate,
    bookDialogChaptersTemplate,
    bookDialogTemplate,
    bookEpubDataCoverTemplate,
    bookEpubDataTemplate,
    bookODTDataRowTemplate,
    bookODTDataTemplate,
    bookPrintDataTemplate,
    bookSanityCheckTemplate
} from "./templates.js"
import type {
    BookDialogButton,
    BookDialogImageDB,
    BookDialogInfo,
    BookDialogOptions,
    BookDialogPart
} from "./types.js"

/** The file records fwtoolkit's file selector accepts. */
type FileSelectorFiles = ConstructorParameters<typeof FileSelector>[0]["files"]

/** The metadata a freshly created book starts out with. */
function emptyMetadata(): BookMetadata {
    return {
        author: "",
        subtitle: "",
        version: "",
        publisher: "",
        copyright: "",
        keywords: "",
        description: "",
        isbn: "",
        publication_date: "",
        series_title: "",
        series_position: ""
    }
}

/**
 * Read a value out of one of the book dialog's form fields. The dialog markup
 * comes from ./templates.js, so the ids are fixed.
 */
function fieldValue(root: ParentNode, id: string): string {
    return (root.querySelector(`#${id}`) as HTMLInputElement).value
}

/** The tabbed book editor. */
export class BookDialog {
    options: BookDialogOptions
    /** Whether this dialog creates a new book or edits an existing one. */
    isNew: boolean
    /** The book being edited. A working copy, not the host's own record. */
    book: Book
    documentList: BookDialogOptions["documentList"]
    exportMenu: BookExportMenu
    /** Callbacks invoked after the book has been saved. */
    onSave: Array<(book: Book) => Promise<unknown> | unknown>
    dialogParts: BookDialogPart[]
    /** Cover images that are not part of the host's image database. */
    bookImageDB: BookDialogImageDB
    dialog: Dialog | null
    /** The chapters tab's file selector, once the dialog is open. */
    fileSelector: FileSelector | null

    constructor(options: BookDialogOptions) {
        this.options = options
        this.documentList = options.documentList
        this.exportMenu = bookExportMenuModel()
        this.onSave = options.onSave ? [...options.onSave] : []
        this.dialog = null
        this.fileSelector = null
        this.isNew = !options.book
        this.book = this.isNew
            ? this.createEmptyBook()
            : this.workingCopy(options.book as Book)
        this.bookImageDB = {db: {}}

        if (this.book.cover_image && !this.imageDB().db[this.book.cover_image]) {
            // The cover image is not in the current user's image DB -- it was
            // either deleted or another user originally added it. As we don't
            // do anything fancy with it, we simply add the current cover image
            // to the DB locally so that image selection works as expected.
            this.bookImageDB.db[this.book.cover_image] =
                this.book.cover_image_data ?? {}
        }

        this.dialogParts = [
            {
                title: gettext("Basic info"),
                description: gettext("Basic book information"),
                template: bookBasicInfoTemplate
            },
            {
                title: gettext("Chapters"),
                description: gettext("Documents assigned as chapters"),
                template: bookDialogChaptersTemplate
            },
            {
                title: gettext("Bibliography"),
                description: gettext("Bibliography related settings"),
                template: bookBibliographyDataTemplate
            },
            {
                title: gettext("Epub"),
                description: gettext("Epub related settings"),
                template: bookEpubDataTemplate
            },
            ...(this.options.backend.saveDocxTemplate
                ? [
                      {
                          title: gettext("DOCX"),
                          description: gettext("DOCX related settings"),
                          template: bookDOCXDataTemplate
                      }
                  ]
                : []),
            ...(this.options.backend.saveOdtTemplate
                ? [
                      {
                          title: gettext("ODT"),
                          description: gettext("ODT related settings"),
                          template: bookODTDataTemplate
                      }
                  ]
                : []),
            {
                title: gettext("Print/PDF"),
                description: gettext("Print related settings"),
                template: bookPrintDataTemplate
            },
            {
                title: gettext("Sanity check"),
                description: gettext("Perform sanity check on book"),
                template: bookSanityCheckTemplate
            }
        ]
    }

    /** The image database the dialog renders cover previews from. */
    imageDB(): BookDialogImageDB {
        return {
            db: Object.assign(
                {},
                this.options.imageDB?.db ?? {},
                this.bookImageDB.db
            )
        }
    }

    /** The dialog's root element, or the document before it is opened. */
    root(): ParentNode {
        return this.dialog?.dialogEl ?? document
    }

    /** The bundle the tab templates are rendered from. */
    bookInfo(): BookDialogInfo {
        return {
            book: this.book,
            documentList: this.documentList,
            citationStyles: this.options.citationStyles ?? {},
            bookStyleList: this.options.exportContext?.bookStyles ?? [],
            imageDB: this.imageDB(),
            canPickChapters: Boolean(this.options.backend.pickChapters),
            canOpenChapters: Boolean(this.options.backend.openChapter),
            chapterCatalog: this.options.chapterCatalog !== false
        }
    }

    /** A brand new book with the dialog's default metadata and settings. */
    createEmptyBook(): Book {
        const {path = "/", exportContext} = this.options
        return {
            title: "",
            id: 0,
            chapters: [],
            added: 0,
            updated: 0,
            path,
            metadata: emptyMetadata(),
            settings: {
                bibliography_header: gettext("Bibliography"),
                citationstyle: "apa",
                book_style: exportContext?.bookStyles[0]
                    ? exportContext.bookStyles[0].slug
                    : ("" as string),
                papersize: "octavo",
                language: "en-US"
            }
        } as Book
    }

    /**
     * The dialog's working copy of an existing book.
     *
     * The record is copied shallowly -- the `chapters` array stays shared with
     * the host's record, exactly as the Django backend's dialog behaved -- and
     * the metadata block is merged onto a complete one so every form field
     * has something to read back.
     */
    workingCopy(book: Book): Book {
        return Object.assign({}, book, {
            metadata: Object.assign(emptyMetadata(), book.metadata)
        })
    }

    /**
     * The dialog's buttons, from the host's `buttons` option or the classic
     * default row (Export dropdown, Save, Cancel -- or Close for a read-only
     * book).
     */
    buildButtons(): DialogButtonSpec[] {
        const specs = this.options.buttons ?? this.defaultButtons()
        return specs.map(spec => {
            if (spec.type) {
                return {type: spec.type}
            }
            return {
                text: spec.text,
                classes: spec.classes ?? "fw-dark",
                icon: spec.icon,
                dropdown: spec.dropdown,
                click: (event?: Event) => this.runButton(spec, event)
            }
        })
    }

    /** The classic button row, used when the host supplies none. */
    defaultButtons(): BookDialogButton[] {
        if (this.readOnly()) {
            return [{type: "close"}]
        }
        const specs: BookDialogButton[] = []
        if (this.options.exportContext) {
            specs.push({
                text: gettext("Export"),
                dropdown: true,
                keepOpen: true,
                click: (dialog, event) => dialog.openExportMenu(event)
            })
        }
        specs.push({text: gettext("Save"), click: dialog => dialog.saveBook()})
        specs.push({type: "cancel"})
        return specs
    }

    /** Run a button's action, closing the dialog unless it wants to stay. */
    runButton(spec: BookDialogButton, event?: Event): unknown {
        const result = spec.click?.(this, event)
        const close = () => {
            if (!spec.keepOpen) {
                this.dialog?.close()
            }
        }
        if (result instanceof Promise) {
            return result.then(close)
        }
        close()
        return result
    }

    /**
     * Open the export dropdown menu at the position of the triggering event.
     *
     * Exposed for hosts that build their own button row: the Export button
     * is just a dropdown-styled button whose click calls this. Does nothing
     * when no export context was given.
     */
    openExportMenu(event?: Event): unknown {
        if (!this.options.exportContext) {
            return undefined
        }
        const mouseEvent = event as MouseEvent
        const contentMenu = new ContentMenu({
            page: {
                saveBook: (exportId?: string) => this.saveBook(exportId),
                book: this.book,
                documentList: this.documentList,
                context: this.options.exportContext
            },
            menu: this.exportMenu,
            menuPos: {X: mouseEvent.pageX, Y: mouseEvent.pageY},
            width: 250
        })
        return contentMenu.open()
    }

    /** Render and open the dialog. */
    open(): void {
        const title = this.isNew ? gettext("Create Book") : gettext("Edit Book")
        const body = bookDialogTemplate({
            title,
            dialogParts: this.dialogParts,
            bookInfo: this.bookInfo()
        })

        const dialog = new Dialog({
            width: 840,
            height: 520,
            title,
            body,
            buttons: this.buildButtons(),
            fullScreen: this.options.fullScreen,
            canClose: this.options.canClose,
            canEscape: this.options.canEscape,
            ...(this.options.onClose ? {onClose: this.options.onClose} : {})
        })
        dialog.open()
        this.dialog = dialog

        dialog.dialogEl
            .querySelectorAll<HTMLElement>("#bookoptions-tab .tab-content")
            .forEach((el, index) => {
                if (index) {
                    el.style.display = "none"
                }
            })

        if (!this.readOnly()) {
            this.refreshFileSelector()
            this.bindTemplateInput(
                dialog,
                "input-docx-template",
                "docx-template-row",
                (book, template) => {
                    book.docx_template = template
                },
                this.options.backend.saveDocxTemplate?.bind(this.options.backend)
            )
            this.bindTemplateInput(
                dialog,
                "input-odt-template",
                "odt-template-row",
                (book, template) => {
                    book.odt_template = template
                },
                this.options.backend.saveOdtTemplate?.bind(this.options.backend)
            )
        }

        // Handle tab link clicking
        dialog.dialogEl
            .querySelectorAll<HTMLAnchorElement>(
                "#bookoptions-tab .fw-tab-link a"
            )
            .forEach(el => {
                const tab = el.parentElement as HTMLElement
                const tabList = tab.parentElement as HTMLElement
                el.addEventListener("click", event => {
                    event.preventDefault()

                    tabList
                        .querySelectorAll<HTMLElement>(
                            ".fw-tab-link.fw-current-tab"
                        )
                        .forEach(other =>
                            other.classList.remove("fw-current-tab")
                        )
                    tab.classList.add("fw-current-tab")

                    const link = el.getAttribute("href") as string
                    dialog.dialogEl
                        .querySelectorAll<HTMLElement>(
                            "#bookoptions-tab .tab-content"
                        )
                        .forEach(panel => {
                            if (panel.matches(link)) {
                                panel.style.display = ""
                            } else {
                                panel.style.display = "none"
                            }
                        })
                })
            })

        dialog.dialogEl.addEventListener("click", event =>
            this.handleDialogClick(event)
        )

        const citationStyleSelect = dialog.dialogEl.querySelector<HTMLSelectElement>(
            "#book-settings-citationstyle"
        )
        if (citationStyleSelect) {
            citationStyleSelect.addEventListener("change", event => {
                this.book.settings.citationstyle = (
                    event.target as HTMLSelectElement
                ).value
            })
        }

        const bookStyleSelect =
            dialog.dialogEl.querySelector<HTMLSelectElement>(
                "#book-settings-bookstyle"
            )
        if (bookStyleSelect) {
            bookStyleSelect.addEventListener("change", event => {
                this.book.settings.book_style = (
                    event.target as HTMLSelectElement
                ).value
            })
        }

        const paperSizeSelect =
            dialog.dialogEl.querySelector<HTMLSelectElement>(
                "#book-settings-papersize"
            )
        if (paperSizeSelect) {
            paperSizeSelect.addEventListener("change", event => {
                this.book.settings.papersize = (
                    event.target as HTMLSelectElement
                ).value
            })
        }
    }

    /** Whether the book is only readable, i.e. not editable. */
    readOnly(): boolean {
        return this.book.rights === "read"
    }

    /**
     * Let the user pick a DOCX/ODT template file and hand it to the host.
     *
     * The book is saved first, because a freshly created book has no id the
     * host could attach a template to.
     */
    bindTemplateInput(
        dialog: Dialog,
        inputId: string,
        rowId: string,
        applyTemplate: (book: Book, template: string) => void,
        saveTemplate?: (book: Book, file: File) => Promise<string | null>
    ): void {
        const input =
            dialog.dialogEl.querySelector<HTMLInputElement>(`#${inputId}`)
        if (!input || !saveTemplate) {
            return
        }
        input.addEventListener("change", event => {
            const file = (event.target as HTMLInputElement).files![0]
            return this.saveBook()
                .then(() => saveTemplate(this.book, file))
                .then(template => {
                    if (!template) {
                        return
                    }
                    applyTemplate(this.book, template)
                    this.refreshRow(
                        rowId,
                        rowId === "docx-template-row"
                            ? bookDOCXDataRowTemplate({book: this.book})
                            : bookODTDataRowTemplate({book: this.book})
                    )
                })
        })
    }

    /** Replace the markup of one of the dialog's rows. */
    refreshRow(rowId: string, html: string): void {
        const row = this.root().querySelector(`#${rowId}`)
        if (row) {
            row.innerHTML = html
        }
    }

    /**
     * (Re-)build the chapters tab's file selector from the document list.
     *
     * Hosts can extend the list after the dialog opened -- the desktop adds
     * the files the user picked through its native file dialog -- so the
     * selector is rebuilt rather than created only in `open()`.
     */
    refreshFileSelector(): void {
        if (this.readOnly() || !this.dialog) {
            return
        }
        const dom = this.dialog.dialogEl.querySelector<HTMLElement>(
            "#book-document-list"
        )
        if (!dom) {
            return
        }
        this.fileSelector = new FileSelector({
            dom,
            files: this.documentList as unknown as FileSelectorFiles,
            multiSelect: true,
            selectFolders: false
        })
        this.fileSelector.init()
    }

    /**
     * Replace the document list the dialog's catalog and chapter rows read
     * from, and refresh the affected parts of the dialog.
     */
    setDocumentList(documentList: BookDialogOptions["documentList"]): void {
        this.documentList = documentList
        this.refreshFileSelector()
        this.refreshChapterList()
        this.updateChapterNotice()
    }

    /** Re-render the chapter list. */
    refreshChapterList(): void {
        this.refreshRow(
            "book-chapter-list",
            bookChapterListTemplate({
                book: this.book,
                documentList: this.documentList
            })
        )
    }

    /**
     * Add or remove the encrypted-chapters notice that lives alongside the
     * chapter list. Called after any operation that changes book.chapters so
     * the notice stays in sync.
     */
    updateChapterNotice(): void {
        const chapterListEl = this.root().querySelector("#book-chapter-list")
        if (!chapterListEl) {
            return
        }
        const container = chapterListEl.closest(".fw-ar-container")
        if (!container) {
            return
        }
        const existingNotice = container.querySelector(".e2ee-chapter-notice")
        const hasEncrypted = this.book.chapters.some(ch =>
            this.documentList.find(doc => doc.id === ch.text)?.e2ee
        )
        if (hasEncrypted && !existingNotice) {
            container.insertAdjacentHTML(
                "beforeend",
                `<p class="fw-note e2ee-chapter-notice">
                            <i class="fas fa-lock"></i>
                            ${gettext("This book contains encrypted chapters. A personal passphrase is required to export or run a sanity check on this book.")}
                        </p>`
            )
        } else if (!hasEncrypted && existingNotice) {
            existingNotice.remove()
        }
    }

    /** Open a sub-dialog to edit a chapter's part title. */
    editChapterDialog(chapter: Chapter): void {
        const doc = this.documentList.find(doc => doc.id === chapter.text)
        let docTitle = doc?.title ?? ""
        if (!docTitle.length) {
            docTitle = gettext("Untitled")
        }

        const buttons: DialogButtonSpec[] = [
            {
                type: "cancel"
            },
            {
                text: gettext("Submit"),
                classes: "fw-dark",
                click: () => {
                    // The part-title field lives in this sub-dialog, not in
                    // the book dialog's own root.
                    chapter.part = fieldValue(
                        dialog.dialogEl,
                        "book-chapter-part"
                    )
                    this.refreshChapterList()
                    dialog.close()
                }
            }
        ]

        const dialog = new Dialog({
            title: `${gettext("Edit Chapter")}: ${chapter.number}. ${docTitle}`,
            body: bookChapterDialogTemplate({chapter}),
            width: 300,
            height: 100,
            buttons
        })
        dialog.open()
    }

    /** Let the user pick the cover image through the host's image picker. */
    selectCoverImage(): Promise<void> {
        return Promise.resolve(
            this.options.backend.selectCoverImage?.(this.book.cover_image ?? false)
        ).then(selected => {
            if (!selected) {
                delete this.book.cover_image
            } else {
                this.book.cover_image = selected.id
                this.book.cover_image_data = selected.data
                this.bookImageDB.db[selected.id] = selected.data
            }
            this.refreshRow(
                "cover-preview-row",
                bookEpubDataCoverTemplate({
                    book: this.book,
                    imageDB: this.imageDB()
                })
            )
        })
    }

    /**
     * Read the form fields into the book record without persisting.
     *
     * Chapter and part edits live in `this.book` directly, but the metadata
     * and settings fields are only read back on save. Hosts that write the
     * book from outside the dialog -- a window-close flush, a Save-as in the
     * host UI -- call this first so the edited state is complete. A no-op
     * when the dialog is closed or the book is read-only.
     *
     * @returns The dialog's book record with the form fields applied.
     */
    syncEdits(): Book {
        const book = this.book
        if (this.readOnly() || !this.dialog) {
            return book
        }
        const root = this.root()
        book.title = fieldValue(root, "book-title")
        book.metadata.author = fieldValue(root, "book-metadata-author")
        book.metadata.subtitle = fieldValue(root, "book-metadata-subtitle")
        book.metadata.version = fieldValue(root, "book-metadata-version")
        book.metadata.copyright = fieldValue(root, "book-metadata-copyright")
        book.metadata.publisher = fieldValue(root, "book-metadata-publisher")
        book.metadata.keywords = fieldValue(root, "book-metadata-keywords")
        book.metadata.description = fieldValue(root, "book-metadata-description")
        book.metadata.isbn = fieldValue(root, "book-metadata-isbn")
        book.metadata.publication_date = fieldValue(
            root,
            "book-metadata-publication-date"
        )
        book.metadata.series_title = fieldValue(root, "book-metadata-series-title")
        book.metadata.series_position = fieldValue(
            root,
            "book-metadata-series-position"
        )
        book.settings.language = fieldValue(root, "book-settings-language")
        book.path = (this.isNew ? "" : (book.path ?? "")) || this.options.path || ""
        return book
    }

    /**
     * Persist the edited book through the host and notify the save callbacks.
     *
     * Must only be called while the dialog is open.
     */
    saveBook(exportId?: string): Promise<unknown> {
        const book = this.book
        if (this.readOnly()) {
            return Promise.resolve()
        }
        this.syncEdits()

        return this.options.backend
            .saveBook(book, exportId)
            .catch((error: unknown) => {
                // Include the cause: a bare "could not be saved" leaves hosts
                // (and users) with no way to tell a cancelled picker from a
                // failed write.
                addAlert(
                    "error",
                    `${gettext("The book could not be saved")}: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                )
                throw error
            })
            .then(async saved => {
                if (!saved) {
                    // The host handed the session to a new window (an
                    // untitled book promoted to its real path) and resumes
                    // the triggering export there; nothing to update here.
                    return false
                }
                this.book = Object.assign(book, {
                    id: saved.id ?? book.id,
                    added: saved.added ?? book.added,
                    updated: saved.updated ?? book.updated
                })
                await Promise.all(this.onSave.map(method => method(this.book)))
                return true
            })
    }

    /**
     * Move a chapter one position up or down the list.
     *
     * @param docId - Id of the chapter document to move.
     * @param offset - `-1` to move up, `1` to move down.
     */
    moveChapter(docId: number, offset: number): void {
        const chapter = this.book.chapters.find(
            chapter => chapter.text === docId
        ) as Chapter
        const neighbour = this.book.chapters.find(
            other => other.number === chapter.number + offset
        ) as Chapter
        if (!neighbour) {
            return
        }
        chapter.number += offset
        neighbour.number -= offset
        this.refreshChapterList()
        this.updateChapterNotice()
    }

    /** Remove a chapter from the book and close the numbering gap. */
    removeChapter(docId: number): void {
        const chapter = this.book.chapters.find(
            chapter => chapter.text === docId
        ) as Chapter
        if (!chapter) {
            return
        }
        this.book.chapters.forEach(other => {
            if (other.number > chapter.number) {
                other.number--
            }
        })
        this.book.chapters = this.book.chapters.filter(
            other => other !== chapter
        )
        this.refreshChapterList()
        this.updateChapterNotice()
    }

    /**
     * Add a document as the book's next chapter.
     *
     * External documents (standalone files the host picked) carry their file
     * location onto the chapter, so file-based hosts can re-resolve the live
     * document on the next load.
     */
    addChapter(doc: DocumentListEntry): void {
        if (this.book.chapters.some(chapter => chapter.text === doc.id)) {
            return
        }
        const chapNums = this.book.chapters.map(chapter => chapter.number)
        const number = chapNums.length ? Math.max(...chapNums) + 1 : 1
        this.book.chapters.push({
            text: doc.id as number,
            number,
            part: "",
            ...(doc.external && doc.path ? {path: doc.path} : {})
        })
    }

    /** Append the documents selected in the file selector as new chapters. */
    addChapters(fileSelector: FileSelector): void {
        fileSelector.selected.forEach(entry => {
            if (entry.type !== "file") {
                return
            }
            this.addChapter(entry.file as unknown as DocumentListEntry)
        })
        fileSelector.deselectAll()

        this.refreshChapterList()
        this.updateChapterNotice()
    }

    /**
     * Let the user pick standalone documents through the host and add them as
     * chapters.
     *
     * The host returns stub entries for the picked files; the dialog merges
     * them into the catalog so they show up in the file selector, and adds
     * each as a chapter. The chapter content itself is resolved by the host
     * when the book is saved or exported.
     */
    addPickedChapters(): Promise<void> {
        if (!this.options.backend.pickChapters) {
            return Promise.resolve()
        }
        return this.options.backend.pickChapters().then(picked => {
            if (!picked.length) {
                return
            }
            picked.forEach(doc => {
                if (!this.documentList.some(existing => existing.id === doc.id)) {
                    this.documentList.push(doc)
                }
                this.addChapter(doc)
            })
            this.refreshFileSelector()
            this.refreshChapterList()
            this.updateChapterNotice()
        })
    }

    /** Handle a click anywhere inside the dialog. */
    handleDialogClick(event: Event): void {
        const el: {target?: HTMLElement} = {}
        // `findTarget` fills `el.target` with the matching ancestor; all the
        // chapter/template rows carry their document id in a data attribute.
        const clickedId = (): number =>
            Number.parseInt(el.target!.dataset.id as string)

        switch (true) {
            case findTarget(event, ".book-sort-up", el):
                this.moveChapter(clickedId(), -1)
                break
            case findTarget(event, ".book-sort-down", el):
                this.moveChapter(clickedId(), 1)
                break
            case findTarget(event, ".delete-chapter", el):
                this.removeChapter(clickedId())
                break
            case findTarget(event, "#add-chapter", el):
                if (this.fileSelector) {
                    this.addChapters(this.fileSelector)
                }
                break
            case findTarget(event, "#add-chapter-file", el):
                void this.addPickedChapters()
                break
            case findTarget(event, ".open-chapter", el): {
                const chapter = this.book.chapters.find(
                    candidate => candidate.text === clickedId()
                )
                if (chapter) {
                    this.options.backend.openChapter?.(chapter)
                }
                break
            }
            case findTarget(event, ".edit-chapter", el):
                this.editChapterDialog(
                    this.book.chapters.find(
                        chapter => chapter.text === clickedId()
                    ) as Chapter
                )
                break
            case findTarget(event, "#select-cover-image-button", el):
                this.selectCoverImage()
                break
            case findTarget(event, "#select-docx-template", el): {
                const input = this.root().querySelector<HTMLElement>(
                    "#input-docx-template"
                )
                input!.click()
                break
            }
            case findTarget(event, "#select-odt-template", el): {
                const input = this.root().querySelector<HTMLElement>(
                    "#input-odt-template"
                )
                input!.click()
                break
            }
            case findTarget(event, "#remove-cover-image-button", el): {
                delete this.book.cover_image
                this.refreshRow(
                    "cover-preview-row",
                    bookEpubDataCoverTemplate({
                        book: this.book,
                        // We just deleted the cover image, so we don't need a
                        // full DB.
                        imageDB: {db: {}}
                    })
                )
                break
            }
            case findTarget(event, "#remove-docx-template-button", el): {
                delete this.book.docx_template
                this.refreshRow(
                    "docx-template-row",
                    bookDOCXDataRowTemplate({book: this.book})
                )
                break
            }
            case findTarget(event, "#remove-odt-template-button", el): {
                delete this.book.odt_template
                this.refreshRow(
                    "odt-template-row",
                    bookODTDataRowTemplate({book: this.book})
                )
                break
            }
            case findTarget(event, "#perform-sanity-check-button", el): {
                this.performSanityCheck()
                break
            }
            default:
                break
        }
    }

    /** Save the book and render its sanity check report in place. */
    performSanityCheck(): Promise<void> {
        const {schema, chapterLoader, e2ee} = this.options
        return this.saveBook()
            .then(() =>
                bookSanityCheck(this.book, this.documentList, {
                    schema,
                    chapterLoader,
                    e2ee
                })
            )
            .then(sanityCheckOutputHTML => {
                const sanityCheckOutput = this.root().querySelector("#sanity-check-output")
                if (sanityCheckOutput) {
                    sanityCheckOutput.innerHTML = sanityCheckOutputHTML
                }
            })
    }
}