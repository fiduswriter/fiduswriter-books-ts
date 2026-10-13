/**
 * BITS (Book Interchange Tag Suite) book exporter.
 */

import type {Schema} from "prosemirror-model"
import pretty from "../pretty.js"
import {JATSExporterConverter} from "@fiduswriter/document/exporter/jats/convert"
import {darManifest} from "@fiduswriter/document/exporter/jats/templates"
import type {ProgressCallback} from "@fiduswriter/document/exporter/tools/progress"
import {
    createSlug,
    getImageDBEntryFilename
} from "@fiduswriter/document/exporter/tools/file"
import type {ImageDBEntry} from "@fiduswriter/document"
import {ZipFileCreator} from "fwtoolkit/file/zip"
import {gettext} from "fwtoolkit"

import type {Book, CSL, DocumentListEntry, User} from "../../types.js"
import {getMissingChapterData} from "../tools.js"
import {bitsTemplate} from "./templates.js"

interface TextFile {
    filename: string
    contents: string
}

interface HttpFile {
    filename: string
    url: string
    title?: string
}

export class BITSBookExporter {
    schema: Schema
    csl: CSL
    book: Book
    user: User
    docList: DocumentListEntry[]
    updated: number
    type: string
    textFiles: TextFile[]
    httpFiles: HttpFile[]
    zipFileName: string
    progressCallback?: ProgressCallback

    constructor(
        schema: Schema,
        csl: CSL,
        book: Book,
        user: User,
        docList: DocumentListEntry[],
        updated: number
    ) {
        this.schema = schema
        this.csl = csl
        this.book = book
        this.user = user
        this.docList = docList
        this.updated = updated
        this.type = "book"
        this.textFiles = []
        this.httpFiles = []
        this.zipFileName = ""
    }

    init(progressCallback?: ProgressCallback): Promise<Blob> | false {
        this.progressCallback = progressCallback
        this.progressCallback?.(
            gettext("BITS book export has been initiated."),
            0
        )
        if (this.book.chapters.length === 0) {
            throw new Error(
                gettext("Book cannot be exported due to lack of chapters.")
            )
        }
        return getMissingChapterData(this.book, this.docList, this.schema, {
            progressCallback: this.progressCallback
        }).then(() => this.export())
    }

    export(): Promise<Blob> {
        this.progressCallback?.(gettext("Preparing BITS book..."), 10)
        this.book.chapters.sort((a, b) => (a.number > b.number ? 1 : -1))

        const imageDict: Record<string, ImageDBEntry> = {}
        return Promise.all(
            this.book.chapters.map(chapter => {
                const doc = this.docList.find(d => d.id === chapter.text)
                if (!doc) {
                    return Promise.resolve({front: "", body: "", back: ""})
                }
                const converter = new JATSExporterConverter(
                    this.type,
                    doc,
                    this.csl,
                    {db: doc.images || {}},
                    {db: doc.bibliography || {}}
                )
                return converter.init().then(({front, body, back, imageIds}) => {
                    imageIds.forEach(
                        (imageId: string | number) =>
                            (imageDict[imageId] = doc.images?.[
                                imageId
                            ] as ImageDBEntry)
                    )
                    return {front, body, back}
                })
            })
        ).then(chapters => this.createFiles(chapters, imageDict))
    }

    createFiles(
        chapters: Array<{front: string; body: string; back: string}>,
        imageDict: Record<string, ImageDBEntry>
    ): Promise<Blob> {
        this.progressCallback?.(gettext("Assembling BITS book..."), 80)
        const images = Object.entries(imageDict)
            .filter((entry): entry is [string, ImageDBEntry] =>
                Boolean(entry[1]?.image)
            )
            .map(([id, image]) => ({
                // Data URL images (the desktop stores them that way) have no
                // usable last path segment: the base64 payload can contain
                // "/" and a random tail became the file name.
                filename: getImageDBEntryFilename(image, id),
                url: (image.image as string).split("?")[0],
                title: image.title || ""
            }))

        this.zipFileName = `${createSlug(this.book.title)}.bits.zip`

        this.textFiles = [
            {
                filename: "manuscript.xml",
                contents: pretty(bitsTemplate(this.book, chapters), {ocd: true})
            },
            {
                filename: "manifest.xml",
                contents: pretty(
                    darManifest({
                        title: this.book.title,
                        type: this.type,
                        images
                    }),
                    {ocd: true}
                )
            }
        ]

        images.forEach(image => {
            this.httpFiles.push({
                filename: image.filename,
                url: image.url,
                title: image.title
            })
        })

        return this.createZip()
    }

    createZip(): Promise<Blob> {
        this.progressCallback?.(gettext("Finalizing BITS book..."), 90)
        const zipper = new ZipFileCreator(
            this.textFiles,
            this.httpFiles,
            undefined,
            undefined,
            new Date(this.updated * 1000)
        )
        return zipper.init().then(blob => {
            this.progressCallback?.(gettext("BITS book export complete."), 100)
            return this.download(blob)
        })
    }

    download(blob: Blob): Blob {
        return blob
    }

    get defaultFilename(): string {
        return this.zipFileName
    }
}
