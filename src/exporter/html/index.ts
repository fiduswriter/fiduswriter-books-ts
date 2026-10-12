/**
 * HTML book exporter.
 */

import type {Schema} from "prosemirror-model"
import type {CSL, User} from "@fiduswriter/document"
import type {HTMLExportMetadata} from "@fiduswriter/document/exporter/html/convert"
import type {ProgressCallback} from "@fiduswriter/document/exporter/tools/progress"
import {HTMLExporter} from "@fiduswriter/document/exporter/html/index"
import {createSlug} from "@fiduswriter/document/exporter/tools/file"
import {ZipFileCreator} from "fwtoolkit/file/zip"
import {LANGUAGES} from "@fiduswriter/document/schema/const"
import {gettext, get, staticUrl} from "fwtoolkit"
import pretty from "../pretty.js"

import type {Book, BookStyle, BookStyles, DocumentListEntry} from "../../types.js"
import {getMissingChapterData} from "../tools.js"
import {
    htmlBookChapterTemplate,
    htmlBookExportTemplate,
    htmlBookIndexBodyTemplate,
    htmlBookIndexTemplate,
    singleFileHTMLBookCSSTemplate,
    singleFileHTMLBookChapterTemplate,
    singleFileHTMLBookTemplate
} from "./templates.js"
import {orderLinks} from "./tools.js"

interface StyleSheet {
    url?: string
    filename?: string
    contents?: string
}

interface TextFile {
    filename: string
    contents?: string
}

interface HttpFile {
    url: string
    filename: string
}

interface IncludeZip {
    directory: string
    url: string
}

interface ChapterInfo {
    number: number
    part: string
    doc: DocumentListEntry
    metaData: HTMLExportMetadata
    toc: Array<Record<string, unknown>>
}

export class HTMLBookExporter {
    schema: Schema
    csl: CSL
    bookStyles: BookStyles
    book: Book
    user: User
    docList: DocumentListEntry[]
    updated: number
    multiDoc: boolean
    relativeUrls: boolean
    chapters: ChapterInfo[]
    includeZips: IncludeZip[]
    textFiles: TextFile[]
    httpFiles: HttpFile[]
    math: boolean
    bibCSS: string
    chapterTemplate: (args: Record<string, unknown>) => string
    indexTemplate: (args: Record<string, unknown>) => string
    singleFileHTMLBookTemplate: (args: Record<string, unknown>) => string
    singleFileHTMLBookCSSTemplate: (args: Record<string, unknown>) => string
    styleSheets: StyleSheet[]
    progressCallback?: ProgressCallback

    constructor(
        schema: Schema,
        csl: CSL,
        bookStyles: BookStyles,
        book: Book,
        user: User,
        docList: DocumentListEntry[],
        updated: number,
        multiDoc = true,
        {relativeUrls = true} = {}
    ) {
        this.schema = schema
        this.csl = csl
        this.bookStyles = bookStyles
        this.book = book
        this.user = user
        this.docList = docList
        this.updated = updated
        this.multiDoc = multiDoc
        this.relativeUrls = relativeUrls
        this.chapters = []
        this.includeZips = []
        this.textFiles = []
        this.httpFiles = []
        this.math = false
        this.bibCSS = ""
        this.chapterTemplate = (multiDoc
            ? htmlBookExportTemplate
            : singleFileHTMLBookChapterTemplate) as unknown as (args: Record<string, unknown>) => string
        this.indexTemplate = (multiDoc
            ? htmlBookIndexTemplate
            : htmlBookIndexBodyTemplate) as unknown as (args: Record<string, unknown>) => string
        this.singleFileHTMLBookTemplate = singleFileHTMLBookTemplate
        this.singleFileHTMLBookCSSTemplate = singleFileHTMLBookCSSTemplate
        // Book exports load the shared document stylesheet (with the bundled
        // Libertinus fallback fonts) first and the book-specific stylesheet on
        // top so book rules can override the base ones.
        this.styleSheets = [
            {url: staticUrl("css/document/document.css")},
            {url: staticUrl("css/book.css")}
        ]
    }

    async init(progressCallback?: ProgressCallback): Promise<Blob | false | void> {
        this.progressCallback = progressCallback
        this.progressCallback?.(
            gettext("HTML book export has been initiated."),
            0
        )
        if (this.book.chapters.length === 0) {
            throw new Error(
                gettext("Book cannot be exported due to lack of chapters.")
            )
        }

        await getMissingChapterData(this.book, this.docList, this.schema, {
            progressCallback: this.progressCallback
        })

        this.addBookStyle()

        await Promise.all(
            this.styleSheets.map(async sheet => this.loadStyle(sheet))
        )

        return this.exportChapters()
    }

    async loadStyle(sheet: StyleSheet): Promise<StyleSheet> {
        if (sheet.url) {
            const response = await get(sheet.url)
            const text = await response.text()
            sheet.contents = text
            sheet.filename = `css/${sheet.url.split("/").pop()?.split("?")[0]}`
            delete sheet.url
        }
        if (sheet.filename) {
            this.textFiles.push(sheet as TextFile)
        }
        return sheet
    }

    async exportChapters(): Promise<Blob | void> {
        this.progressCallback?.(gettext("Exporting book chapters..."), 20)
        let footnoteCounter = 0,
            affiliationCounter = 0,
            figureCounter = 0,
            equationCounter = 0,
            photoCounter = 0,
            tableCounter = 0

        const sortedChapters = this.book.chapters.sort(
            (a, b) => a.number - b.number
        )

        for (const chapterInfo of sortedChapters) {
            const chapterNumber = chapterInfo.number
            const chapterPart = chapterInfo.part || ""
            const doc = this.docList.find(d => d.id === chapterInfo.text)

            if (!doc) {
                continue
            }

            const imageDB = {db: doc.images || {}}
            const bibDB = {db: doc.bibliography || {}}
            const styleSheets = this.styleSheets.slice()

            const options = {
                xhtml: false,
                epub: false,
                relativeUrls: this.relativeUrls,
                footnoteNumbering: "decimal",
                affiliationNumbering: "alpha",
                idPrefix: `c-${chapterNumber}-`,
                footnoteOffset: footnoteCounter,
                affiliationOffset: affiliationCounter,
                figureOffset: {
                    figure: figureCounter,
                    equation: equationCounter,
                    photo: photoCounter,
                    table: tableCounter
                }
            }

            const documentHTMLExporter = new HTMLExporter(
                doc,
                bibDB,
                imageDB,
                this.csl,
                new Date(this.updated * 1000),
                [],
                options,
                htmlBookChapterTemplate as unknown as typeof HTMLExporter.prototype.htmlExportTemplate
            )

            await documentHTMLExporter.process()
            const {metaData, converter, textFiles, httpFiles} =
                documentHTMLExporter.getProcessedFiles()

            const contents = textFiles.find(
                (textFile: TextFile) => textFile.filename === "document.html"
            )?.contents
            if (!contents) {
                continue
            }
            // Each chapter's document exporter bundles the Libertinus fallback
            // fonts into its httpFiles. Deduplicate by filename so a multi-chapter
            // book only fetches and embeds each font once.
            this.httpFiles = this.httpFiles.concat(
                httpFiles.filter(
                    file =>
                        !this.httpFiles.some(
                            existing => existing.filename === file.filename
                        )
                )
            )

            footnoteCounter = converter.fnCounter
            affiliationCounter = converter.affCounter
            figureCounter = converter.categoryCounter.figure || figureCounter
            equationCounter =
                converter.categoryCounter.equation || equationCounter
            photoCounter = converter.categoryCounter.photo || photoCounter
            tableCounter = converter.categoryCounter.table || tableCounter

            if (converter.features.math) {
                this.math = true
                styleSheets.push({filename: "css/mathlive.css"})
            }

            if (converter.citations.bibCSS) {
                if (!this.bibCSS) {
                    this.bibCSS = pretty(converter.citations.bibCSS, {
                        ocd: true
                    })
                }
                styleSheets.push({filename: "css/bibliography.css"})
            }

            const chapterHTML = this.chapterTemplate({
                part: chapterInfo.part,
                currentPart: chapterPart,
                contents,
                title: doc.title,
                settings: doc.settings,
                styleSheets
            })

            this.textFiles.push({
                filename: `document-${chapterNumber}.html`,
                contents: pretty(chapterHTML, {ocd: true})
            })

            this.chapters.push({
                number: chapterNumber,
                part: chapterPart,
                doc,
                metaData,
                toc: converter.metaData.toc
            })
        }

        this.progressCallback?.(gettext("Assembling HTML book..."), 80)
        return this.exportBook()
    }

    async exportBook(): Promise<Blob | void> {
        this.progressCallback?.(gettext("Finalizing HTML book..."), 90)
        if (this.math) {
            this.includeZips.push({
                directory: "css",
                url: staticUrl("zip/mathlive_style.zip")
            })
        }

        if (this.bibCSS) {
            this.textFiles.push({
                filename: "css/bibliography.css",
                contents: this.bibCSS
            })
        }

        let contentItems: Array<Record<string, unknown>> = []
        for (const chapter of this.chapters) {
            const chapterNumber = chapter.number
            const chapterPart = chapter.part

            if (chapterPart && chapterPart !== "") {
                contentItems.push({
                    link: this.multiDoc
                        ? this.getChapterLink(chapterNumber)
                        : `#c-${chapterNumber}-body`,
                    title: chapterPart,
                    docNum: chapterNumber,
                    id: 0,
                    level: -1,
                    subItems: []
                })
            }

            const contentItemsFromChapter = chapter.toc.map(item => {
                return {
                    link: `${this.multiDoc ? this.getChapterLink(chapter.number) : ""}#c-${chapter.number}-${item.id}`,
                    title: item.title,
                    docNum: chapterNumber,
                    id: item.id,
                    level: item.level,
                    subItems: []
                }
            })

            contentItems = contentItems.concat(contentItemsFromChapter)
        }

        contentItems = orderLinks(contentItems)

        const language =
            LANGUAGES.find(
                lang => lang[0] === this.book.settings.language
            )?.[1] ??
            this.book.settings.language ??
            "en-US"

        this.textFiles.push({
            filename: "index.html",
            contents: pretty(
                this.indexTemplate({
                    contentItems,
                    book: this.book,
                    creator: this.user.name,
                    styleSheets: this.styleSheets,
                    language,
                    multiDoc: this.multiDoc
                }),
                {ocd: true}
            )
        })
        if (!this.multiDoc) {
            this.joinChapters()
        }
        return this.createZip()
    }

    joinChapters(): void {
        const styleSheets = this.styleSheets.slice()
        if (this.bibCSS) {
            styleSheets.push(
                this.relativeUrls
                    ? {filename: "css/bibliography.css"}
                    : {contents: this.bibCSS}
            )
        }
        if (this.math) {
            styleSheets.push(
                this.relativeUrls
                    ? {filename: "css/mathlive.css"}
                    : {filename: staticUrl("css/mathlive.css")}
            )
        }
        let html = ""
        this.textFiles = this.textFiles
            .sort((a, b) => {
                if (a.filename === "index.html") {
                    return -1
                }
                if (b.filename === "index.html") {
                    return 1
                }
                const aNum = Number.parseInt(a.filename.match(/\d+/g)?.[0] || "0")
                const bNum = Number.parseInt(b.filename.match(/\d+/g)?.[0] || "0")
                if (aNum < bNum) {
                    return -1
                }
                if (aNum > bNum) {
                    return 1
                }
                return 0
            })
            .filter(({filename, contents}) => {
                if (filename.slice(-5) !== ".html") {
                    return true
                }
                html += contents
                return false
            })
        const css = this.singleFileHTMLBookCSSTemplate({
                papersize: this.book.settings.papersize
            }),
            title = this.book.title,
            settings = this.book.settings,
            htmlDoc = this.singleFileHTMLBookTemplate({
                css,
                html,
                title,
                styleSheets,
                settings
            })

        this.textFiles.push({
            filename: "index.html",
            contents: pretty(htmlDoc, {ocd: true})
        })
    }

    addBookStyle(): boolean {
        const bookStyle = this.bookStyles.find(
            (style: BookStyle) => style.slug === this.book.settings.book_style
        )
        if (!bookStyle) {
            return false
        }
        let contents = bookStyle.contents
        bookStyle.bookstylefile_set.forEach(
            ([_url, filename]: [string, string]) =>
                (contents = contents.replace(
                    new RegExp(filename, "g"),
                    `media/${filename}`
                ))
        )

        this.styleSheets.push({contents, filename: `css/${bookStyle.slug}.css`})
        this.httpFiles = this.httpFiles.concat(
            bookStyle.bookstylefile_set.map(([url, filename]: [string, string]) => ({
                filename: `css/media/${filename}`,
                url
            }))
        )
        return true
    }

    async createZip(): Promise<Blob | void> {
        const zipper = new ZipFileCreator(
            this.textFiles.concat(this.styleSheets as TextFile[]) as Array<{
                filename: string
                contents: string
            }>,
            this.httpFiles,
            this.includeZips,
            "application/zip",
            new Date(this.updated * 1000)
        )
        const blob = await zipper.init()
        this.progressCallback?.(gettext("HTML book export complete."), 100)
        return this.download(blob)
    }

    download(blob: Blob): Blob {
        return blob
    }

    get defaultFilename(): string {
        return `${createSlug(this.book.title)}.html.zip`
    }

    getChapterLink(chapterNumber: number): string {
        return `document-${chapterNumber}.html`
    }
}
