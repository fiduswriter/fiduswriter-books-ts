import type {ImageDBEntry} from "@fiduswriter/document"
/**
 * EPUB book exporter.
 */

import type {Schema} from "prosemirror-model"
import {HTMLExporterConvert} from "@fiduswriter/document/exporter/html/convert"
import type {HTMLExportMetadata} from "@fiduswriter/document/exporter/html/convert"
import {htmlExportTemplate} from "@fiduswriter/document/exporter/html/templates"
import type {ProgressCallback} from "@fiduswriter/document/exporter/tools/progress"
import {removeHidden} from "@fiduswriter/document/exporter/tools/doc_content"
import {
    createSlug,
    getImageDBEntryFilename
} from "@fiduswriter/document/exporter/tools/file"
import {ZipFileCreator} from "fwtoolkit/file/zip"
import {gettext, get, staticUrl} from "fwtoolkit"
import pretty from "../pretty.js"

import type {Book, BookCoverImage, BookStyles, CSL, DocumentListEntry, User} from "../../types.js"
import type {FidusNode} from "@fiduswriter/document"
import {getMissingChapterData} from "../tools.js"
import {
    containerTemplate,
    epubBookCopyrightTemplate,
    epubBookCoverTemplate,
    epubBookOpfTemplate,
    epubBookTitlepageTemplate,
    navTemplate,
    ncxTemplate
} from "./templates.js"
import {
    buildHierarchy,
    getFontMimeType,
    getImageMimeType,
    getTimestamp
} from "./tools.js"

interface StyleSheet {
    url?: string
    filename?: string
    contents?: string
}

interface ImageFile {
    url: string
    filename: string
    coverImage?: boolean
    mimeType?: string
}

interface FontFile {
    url: string
    filename: string
    mimeType?: string
}

interface TextFile {
    filename: string
    contents: string
}

interface IncludeZip {
    directory: string
    url: string
}

interface ChapterOutput {
    number: number
    part: string
    title: string
    docNum: number
    metaData: HTMLExportMetadata
}

export class EpubBookExporter {
    schema: Schema
    csl: CSL
    bookStyles: BookStyles
    book: Book
    user: User
    docList: DocumentListEntry[]
    updated: number
    textFiles: TextFile[]
    images: ImageFile[]
    fontFiles: FontFile[]
    httpFiles: (ImageFile | FontFile)[]
    styleSheets: StyleSheet[]
    chapters: ChapterOutput[]
    contentItems: Array<Record<string, unknown>>
    includeZips: IncludeZip[]
    math: boolean
    progressCallback?: ProgressCallback

    constructor(
        schema: Schema,
        csl: CSL,
        bookStyles: BookStyles,
        book: Book,
        user: User,
        docList: DocumentListEntry[],
        updated: number
    ) {
        this.schema = schema
        this.csl = csl
        this.bookStyles = bookStyles
        this.book = book
        this.user = user
        this.docList = docList
        this.updated = updated
        this.textFiles = []
        this.images = []
        this.fontFiles = []
        this.httpFiles = []
        // Book exports load the shared document stylesheet (with the bundled
        // Libertinus fallback fonts) first and the book-specific stylesheet on
        // top so book rules can override the base ones.
        this.styleSheets = [
            {url: staticUrl("css/document/document.css")},
            {url: staticUrl("css/book.css")}
        ]
        this.chapters = []
        this.contentItems = []
        this.includeZips = []
        this.math = false
    }

    // The open-license (SIL OFL) Libertinus Serif + JetBrains Mono fallback
    // fonts bundled with @fiduswriter/document. css/document.css references
    // them through relative @font-face url()s (fonts/...), so they must ship
    // in the export next to the stylesheet under css/fonts/ to keep the
    // fallback self-contained. Chapters are converted with
    // HTMLExporterConvert directly (not the document HTMLExporter), so the
    // fonts have to be added here.
    static FALLBACK_FONTS = [
        "LibertinusSerif-Regular.ttf",
        "LibertinusSerif-Bold.ttf",
        "LibertinusSerif-Italic.ttf",
        "LibertinusSerif-BoldItalic.ttf",
        "JetBrainsMono-Regular.ttf",
        "JetBrainsMono-Bold.ttf"
    ]

    addFallbackFonts(): void {
        EpubBookExporter.FALLBACK_FONTS.forEach(filename => {
            this.fontFiles.push({
                url: staticUrl(`css/document/fonts/${filename}`),
                filename: `css/fonts/${filename}`
            })
        })
    }

    async init(progressCallback?: ProgressCallback): Promise<Blob | false> {
        this.progressCallback = progressCallback
        this.progressCallback?.(
            gettext("Epub book export has been initiated."),
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
        this.addFallbackFonts()
        return this.exportContents()
    }

    addBookStyle(): boolean {
        const bookStyle = this.bookStyles.find(
            style => style.slug === this.book.settings.book_style
        )
        if (!bookStyle) {
            return false
        }

        let contents = bookStyle.contents
        bookStyle.bookstylefile_set.forEach(([_url, filename]) => {
            contents = contents.replace(
                new RegExp(filename, "g"),
                `media/${filename}`
            )
        })

        this.styleSheets.push({contents, filename: `css/${bookStyle.slug}.css`})
        this.fontFiles = this.fontFiles.concat(
            bookStyle.bookstylefile_set.map(([url, filename]) => ({
                filename: `css/media/${filename}`,
                url
            }))
        )
        return true
    }

    async exportContents(): Promise<Blob> {
        this.progressCallback?.(gettext("Preparing Epub book..."), 10)
        await Promise.all(
            this.styleSheets.map(async sheet => this.loadStyle(sheet))
        )

        if (this.book.cover_image) {
            const coverImage = this.book.cover_image_data
            if (coverImage?.image) {
                this.images.push({
                    url: coverImage.image.split("?")[0],
                    filename: getImageDBEntryFilename(
                        coverImage as ImageDBEntry,
                        "cover"
                    ),
                    coverImage: true
                })

                this.textFiles.push({
                    filename: "cover.xhtml",
                    contents: pretty(
                        epubBookCoverTemplate({
                            book: this.book,
                            coverImage: coverImage as BookCoverImage & {image: string},
                            shortLang: (this.book.settings.language || "en-US").split("-")[0]
                        })
                    )
                })
            }
        }

        this.textFiles.push({
            filename: "titlepage.xhtml",
            contents: pretty(
                epubBookTitlepageTemplate({
                    book: this.book,
                    shortLang: (this.book.settings.language || "en-US").split("-")[0]
                })
            )
        })

        this.chapters = (
            await Promise.all(
                this.book.chapters
                    .sort((a, b) => a.number - b.number)
                    .map(async chapter => {
                        const doc = this.docList.find(
                            d => d.id === chapter.text
                        )
                        if (!doc) {
                            return false
                        }

                        const docContent = removeHidden(doc.content) as FidusNode

                        const converter = new HTMLExporterConvert(
                            doc.title,
                            doc.settings,
                            docContent,
                            htmlExportTemplate,
                            {db: doc.images || {}},
                            {db: doc.bibliography || {}},
                            this.csl,
                            this.styleSheets,
                            {
                                xhtml: true,
                                epub: true,
                                footnoteNumbering: "decimal",
                                affiliationNumbering: "alpha",
                                idPrefix: `c-${chapter.number}-`
                            }
                        )
                        const {html, imageIds, metaData, extraStyleSheets} =
                            await converter.init()

                        if (!html) {
                            return false
                        }

                        imageIds.forEach((id: string | number) => {
                            const image = doc.images?.[id]
                            if (image?.image && typeof image.image === "string") {
                                this.images.push({
                                    // Data URLs have no usable last path
                                    // segment; the helper derives a stable
                                    // name.
                                    filename: `images/${getImageDBEntryFilename(image, id)}`,
                                    url: image.image
                                })
                            }
                        })

                        await Promise.all(
                            (extraStyleSheets as StyleSheet[]).map(
                                async (sheet: StyleSheet) => this.loadStyle(sheet)
                            )
                        )

                        if (converter.features.math) {
                            this.math = true
                        }

                        this.textFiles.push({
                            filename: `document-${chapter.number}.xhtml`,
                            contents: pretty(html)
                        })

                        return {
                            number: chapter.number,
                            part: chapter.part || "",
                            title: doc.title,
                            docNum: chapter.number,
                            metaData
                        }
                    })
            )
        ).filter((chapter): chapter is ChapterOutput => chapter !== false)

        this.progressCallback?.(gettext("Assembling Epub book..."), 80)

        this.textFiles.push({
            filename: "copyright.xhtml",
            contents: pretty(
                epubBookCopyrightTemplate({
                    book: this.book,
                    creator: this.user.name || "",
                    language: this.book.settings.language,
                    shortLang: (this.book.settings.language || "en-US").split("-")[0]
                })
            )
        })

        const contentItems = this.chapters.reduce(
            (items: Array<Record<string, unknown>>, chapter) => {
                if (chapter.part) {
                    items.push({
                        title: chapter.part,
                        docNum: chapter.number,
                        link: `document-${chapter.number}.xhtml`,
                        level: -1
                    })
                }
                items = items.concat(
                    (chapter.metaData.toc as Array<Record<string, unknown>>).map(item => ({
                        ...item,
                        docNum: chapter.number,
                        link: `document-${chapter.number}.xhtml#c-${chapter.number}-${item.id}`
                    }))
                )
                return items
            },
            []
        )

        const toc = buildHierarchy(contentItems)

        this.textFiles = this.textFiles.concat([
            {
                filename: "META-INF/container.xml",
                contents: pretty(containerTemplate())
            },
            {
                filename: "document.opf",
                contents: pretty(
                    epubBookOpfTemplate({
                        book: this.book,
                        language: this.book.settings.language,
                        idType: "fidus",
                        date: getTimestamp(new Date(this.updated * 1000)).slice(
                            0,
                            10
                        ),
                        modified: getTimestamp(new Date(this.updated * 1000)),
                        styleSheets: this.styleSheets as Array<{filename: string}>,
                        math: this.math,
                        images: this.images.map(image => ({
                            ...image,
                            mimeType: getImageMimeType(image.filename) || undefined
                        })),
                        fontFiles: this.fontFiles.map(font => ({
                            ...font,
                            mimeType: getFontMimeType(font.filename) || undefined
                        })),
                        chapters: this.chapters,
                        user: {name: this.user.name || ""}
                    })
                )
            },
            {
                filename: "document.ncx",
                contents: pretty(
                    ncxTemplate({
                        shortLang: (this.book.settings.language || "en-US").split("-")[0],
                        title: this.book.title,
                        idType: "fidus",
                        id: this.book.id,
                        toc: toc as Array<{
                            link: string
                            title: string
                            children?: Array<{link: string; title: string}>
                        }>
                    })
                )
            },
            {
                filename: "document-nav.xhtml",
                contents: pretty(
                    navTemplate({
                        shortLang: (this.book.settings.language || "en-US").split("-")[0],
                        toc: toc as Array<{
                            link: string
                            title: string
                            children?: Array<{link: string; title: string}>
                        }>,
                        styleSheets: this.styleSheets as Array<{filename: string}>
                    })
                )
            }
        ])
        if (this.math) {
            this.includeZips.push({
                directory: "css",
                url: staticUrl("zip/mathlive_style.zip")
            })
        }

        this.httpFiles = this.images.concat(this.fontFiles)
        this.prefixFiles()
        return this.createZip()
    }

    async loadStyle(sheet: StyleSheet): Promise<StyleSheet> {
        const filename =
            sheet.filename ||
            `css/${sheet.url?.split("/").pop()?.split("?")[0]}`
        const existing = this.textFiles.find(file => file.filename === filename)
        if (existing) {
            return Promise.resolve(existing as StyleSheet)
        }
        if (sheet.url) {
            const response = await get(sheet.url)
            const text = await response.text()
            sheet.contents = text
            sheet.filename = filename
            delete sheet.url
        }
        if (sheet.filename) {
            this.textFiles.push(sheet as TextFile)
        }
        return Promise.resolve(sheet)
    }

    prefixFiles(): void {
        this.textFiles = this.textFiles.map(file => {
            if (
                ["META-INF/container.xml", "mimetype"].includes(file.filename)
            ) {
                return file
            }
            return Object.assign({}, file, {filename: `EPUB/${file.filename}`})
        })
        this.fontFiles = this.fontFiles.map(file =>
            Object.assign({}, file, {filename: `EPUB/${file.filename}`})
        )
        // httpFiles carries the images and font files added before prefixing;
        // they must also live under EPUB/ so the paths referenced from the
        // OPF, xhtml and CSS @font-face rules (all relative to EPUB/) resolve.
        this.httpFiles = this.httpFiles.map(file =>
            Object.assign({}, file, {filename: `EPUB/${file.filename}`})
        )
        this.includeZips = this.includeZips.map(file =>
            Object.assign({}, file, {directory: `EPUB/${file.directory}`})
        )
    }

    async createZip(): Promise<Blob> {
        this.progressCallback?.(gettext("Finalizing Epub book..."), 90)
        const zipper = new ZipFileCreator(
            this.textFiles,
            this.httpFiles,
            this.includeZips,
            "application/epub+zip",
            new Date(this.updated * 1000)
        )
        const blob = await zipper.init()
        this.progressCallback?.(gettext("Epub book export complete."), 100)
        return this.download(blob)
    }

    download(blob: Blob): Blob {
        return blob
    }

    get defaultFilename(): string {
        return `${createSlug(this.book.title)}.epub`
    }
}
