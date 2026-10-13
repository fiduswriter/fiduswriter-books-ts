import type {ImageDBEntry} from "@fiduswriter/document"
/**
 * Native `.fidusbook` exporter.
 */

import type {Schema} from "prosemirror-model"
import {ShrinkFidus} from "@fiduswriter/document/exporter/native/shrink"
import {
    createSlug,
    getImageDBEntryFilename
} from "@fiduswriter/document/exporter/tools/file"
import {ZipFileCreator} from "fwtoolkit/file/zip"
import {gettext} from "fwtoolkit"

import {FIDUSBOOK_VERSION} from "../../schema/index.js"
import type {Book, DocumentListEntry, User} from "../../types.js"
import {getMissingChapterData} from "../tools.js"
import type {ProgressCallback} from "@fiduswriter/document/exporter/native/shrink"
import type {FidusNode} from "@fiduswriter/document"

interface FileInclude {
    url: string
    filename: string
}

interface TextFile {
    filename: string
    contents: string
}

export {FIDUSBOOK_VERSION}

export class NativeBookExporter {
    schema: Schema
    book: Book
    user: User
    documentList: DocumentListEntry[]
    updated: number

    progressCallback?: ProgressCallback

    constructor(
        schema: Schema,
        book: Book,
        user: User,
        documentList: DocumentListEntry[],
        updated: number,
        progressCallback?: ProgressCallback
    ) {
        this.schema = schema
        this.book = book
        this.user = user
        this.documentList = documentList
        this.updated = updated
        this.progressCallback = progressCallback
    }

    init(progressCallback?: ProgressCallback): Promise<Blob> {
        if (progressCallback) {
            this.progressCallback = progressCallback
        }
        // A chapter-less book is a valid container: book.json with an empty
        // chapter list and no chapter data. File-based hosts start books
        // empty and add chapters as standalone files afterwards.

        this.progressCallback?.(
            `${this.book.title}: ${gettext("Fidusbook export has been initiated.")}`,
            0
        )

        return getMissingChapterData(this.book, this.documentList, this.schema)
            .then(() => this.exportContents())
            .then(blob => {
                this.progressCallback?.(
                    `${this.book.title}: ${gettext("Fidusbook export complete.")}`,
                    100
                )
                return blob
            })
            .catch(error => {
                this.progressCallback?.(
                    `${this.book.title}: ${gettext("Fidusbook export failed.")}`,
                    100
                )
                throw error
            })
    }

    exportContents(): Promise<Blob> {
        const textFiles: TextFile[] = []
        const httpFiles: FileInclude[] = []

        const sortedChapters = [...this.book.chapters].sort(
            (a, b) => a.number - b.number
        )

        const bookData: Record<string, unknown> = {
            title: this.book.title,
            path: this.book.path || "/",
            metadata: this.book.metadata || {},
            settings: this.book.settings || {},
            // `text` is the chapter's document id and must be persisted: the
            // reader rebuilds the document list from the chapter entries and
            // `getMissingChapterData` matches them with
            // `documentList.find(doc => doc.id === chapter.text)`. Omitting it
            // makes every re-read of a written book fail to resolve its
            // chapters, so the book cannot be exported again.
            chapters: sortedChapters.map((chapter, index) => ({
                text: chapter.text,
                number: chapter.number,
                part: chapter.part || "",
                chapter_index: index,
                // File-based hosts reference chapters as standalone `.fidus`
                // files; the path must be persisted so the host can re-resolve
                // the live file on the next load.
                ...(chapter.path ? {path: chapter.path} : {})
            }))
        }

        if (this.book.cover_image_data) {
            const coverImage = this.book.cover_image_data
            const imageUrl = (coverImage.image || "").split("?")[0]
            const filename = getImageDBEntryFilename(
                coverImage as ImageDBEntry,
                "cover"
            )
            bookData.cover_image = {
                title: coverImage.title || "",
                checksum: coverImage.checksum || "",
                file_type: coverImage.file_type,
                image: `cover/${filename}`
            }
            httpFiles.push({url: imageUrl, filename: `cover/${filename}`})
        }

        const processChapter = (index: number): Promise<void> => {
            if (index >= sortedChapters.length) {
                return Promise.resolve()
            }
            const chapter = sortedChapters[index]
            const doc = this.documentList.find(d => d.id === chapter.text)
            if (!doc || doc.missing) {
                // A chapter without a document entry cannot be rendered; one
                // marked `missing` has no readable source (the file is gone
                // and no snapshot is embedded). Both are left out rather than
                // exported as empty chapters.
                return processChapter(index + 1)
            }

            this.progressCallback?.(
                gettext("Exporting chapter %s of %s..."),
                Math.round((index / sortedChapters.length) * 90)
            )

            const shrinker = new ShrinkFidus(
                doc as unknown as {content: FidusNode; [key: string]: unknown},
                {db: doc.images || {}},
                {db: doc.bibliography || {}},
                this.progressCallback
            )

            return shrinker
                .init()
                .then(
                    ({
                        doc: shrunkDoc,
                        shrunkImageDB,
                        shrunkBibDB,
                        httpIncludes
                    }: {
                        doc: Record<string, unknown>
                        shrunkImageDB: Record<string, unknown>
                        shrunkBibDB: Record<string, unknown>
                        httpIncludes: FileInclude[]
                    }) => {
                        httpIncludes.forEach(include => {
                            include.filename = `chapters/${index}/${include.filename}`
                        })

                        // `ShrinkFidus` drops the document `id`, but the reader
                        // rebuilds each document-list entry with
                        // `id: docJson.id || 0` and `getMissingChapterData`
                        // matches chapters by `doc.id === chapter.text`. A
                        // chapter written without its id therefore reads back
                        // as 0 and cannot be resolved, so re-exporting a book
                        // would fail. Re-attach it before serializing.
                        const chapterDoc: Record<string, unknown> = {
                            id: doc.id,
                            ...shrunkDoc
                        }

                        textFiles.push(
                            {
                                filename: `chapters/${index}/document.json`,
                                contents: JSON.stringify(chapterDoc)
                            },
                            {
                                filename: `chapters/${index}/images.json`,
                                contents: JSON.stringify(shrunkImageDB)
                            },
                            {
                                filename: `chapters/${index}/bibliography.json`,
                                contents: JSON.stringify(shrunkBibDB)
                            }
                        )
                        httpFiles.push(...httpIncludes)
                    }
                )
                .then(() => processChapter(index + 1))
        }

        return processChapter(0).then(() => {
            textFiles.push(
                {filename: "book.json", contents: JSON.stringify(bookData)},
                {filename: "filetype-version", contents: FIDUSBOOK_VERSION}
            )

            const zipper = new ZipFileCreator(
                textFiles,
                httpFiles,
                [],
                "application/vnd.fiduswriter.book+zip",
                new Date(this.updated * 1000)
            )
            return zipper.init().then(blob => this.download(blob))
        })
    }

    download(blob: Blob): Blob {
        // Base implementation returns the Blob.  Browser/CLI subclasses can
        // override this method to trigger a real download.
        return blob
    }

    get defaultFilename(): string {
        return `${createSlug(this.book.title)}.fidusbook`
    }
}
