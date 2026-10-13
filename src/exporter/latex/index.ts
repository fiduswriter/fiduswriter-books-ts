import type {ImageDBEntry} from "@fiduswriter/document"
/**
 * LaTeX book exporter.
 */

import type {Schema} from "prosemirror-model"
import type {User} from "@fiduswriter/document"
import type {ProgressCallback} from "@fiduswriter/document/exporter/tools/progress"
import {BibLatexExporter} from "bibliojson"
import {LatexExporterConvert} from "@fiduswriter/document/exporter/latex/convert"
import {removeHidden} from "@fiduswriter/document/exporter/tools/doc_content"
import {
    createSlug,
    getImageDBEntryFilename
} from "@fiduswriter/document/exporter/tools/file"
import {ZipFileCreator} from "fwtoolkit/file/zip"
import {gettext} from "fwtoolkit"

import type {Book, DocumentListEntry} from "../../types.js"
import type {BibDB, ExportDoc, FidusNode, ImageDB} from "@fiduswriter/document"
import {getMissingChapterData} from "../tools.js"
import {bookTexTemplate} from "./templates.js"

interface TextFile {
    filename: string
    contents: string
}

interface HttpFile {
    url: string
    filename: string
}

export class LatexBookExporter {
    schema: Schema
    doc!: ExportDoc
    book: Book
    user: User
    docList: DocumentListEntry[]
    updated: number
    textFiles: TextFile[]
    httpFiles: HttpFile[]
    zipFileName: string
    progressCallback?: ProgressCallback

    constructor(
        schema: Schema,
        book: Book,
        user: User,
        docList: DocumentListEntry[],
        updated: number
    ) {
        this.schema = schema
        this.book = book
        this.book.chapters.sort((a, b) => (a.number > b.number ? 1 : -1))
        this.user = user
        this.docList = docList
        this.updated = updated

        this.textFiles = []
        this.httpFiles = []
        this.zipFileName = ""
    }

    init(progressCallback?: ProgressCallback): Promise<Blob> {
        this.progressCallback = progressCallback
        this.progressCallback?.(
            gettext("LaTeX book export has been initiated."),
            0
        )
        return getMissingChapterData(this.book, this.docList, this.schema).then(
            () => this.export()
        )
    }

    export(): Promise<Blob> {
        this.progressCallback?.(gettext("Preparing LaTeX book..."), 10)
        this.zipFileName = `${createSlug(this.book.title)}.latex.zip`
        let bibIds: string[] = []
        let imageIds: string[] = []
        const features: Record<string, boolean> = {}
        const combinedBibliography: Record<string, unknown> = {}
        const combinedImages: Record<string, {image: string}> = {}
        this.book.chapters.forEach((chapter, index) => {
            const doc = this.docList.find(d => d.id === chapter.text)
            if (!doc) {
                return
            }
            this.doc = doc
            const converter = new LatexExporterConvert(
                this,
                {db: doc.images || {}},
                {db: doc.bibliography || {}},
                doc.settings
            )
            const chapterContent = removeHidden(doc.content) as FidusNode
            const convertedDoc = converter.init(chapterContent)
            this.textFiles.push({
                filename: `chapter-${index + 1}.tex`,
                contents: convertedDoc.latex
            })
            bibIds = [
                ...new Set(bibIds.concat(Object.keys(convertedDoc.usedBibDB)))
            ]
            imageIds = [...new Set(imageIds.concat(convertedDoc.imageIds))]
            Object.assign(features, converter.features)
            Object.keys(convertedDoc.usedBibDB).forEach(
                bibId =>
                    (combinedBibliography[bibId] = doc.bibliography?.[bibId])
            )
            convertedDoc.imageIds.forEach(
                (imageId: string) =>
                    (combinedImages[imageId] = doc.images?.[imageId] as {
                        image: string
                    })
            )
        })
        if (bibIds.length > 0) {
            const bibExport = new BibLatexExporter(
                combinedBibliography as unknown as ConstructorParameters<typeof BibLatexExporter>[0],
                bibIds
            )
            this.textFiles.push({
                filename: "bibliography.bib",
                contents: (bibExport as unknown as {output: string}).output
            })
        }
        imageIds.forEach(id => {
            const image = combinedImages[id]
            if (image?.image) {
                this.httpFiles.push({
                    // Data URLs have no usable last path segment (the base64
                    // payload may contain "/"); the helper derives a stable
                    // name.
                    filename: getImageDBEntryFilename(
                        image as ImageDBEntry,
                        id
                    ),
                    url: image.image
                })
            }
        })
        const bookConverter = new LatexExporterConvert(
            this,
            {db: combinedImages as unknown as ImageDB["db"]},
            {db: combinedBibliography as unknown as BibDB["db"]},
            {
                language: this.book.settings.language,
                bibliography_header: {} as FidusNode
            }
        )
        bookConverter.features = features
        const preamble = bookConverter.assemblePreamble()
        const epilogue = bookConverter.assembleEpilogue()
        this.textFiles.push({
            filename: "book.tex",
            contents: bookTexTemplate({
                book: this.book,
                preamble,
                epilogue
            })
        })

        return this.createZip()
    }

    createZip(): Promise<Blob> {
        this.progressCallback?.(gettext("Finalizing LaTeX book..."), 90)
        const zipper = new ZipFileCreator(
            this.textFiles,
            this.httpFiles,
            undefined,
            undefined,
            new Date(this.updated * 1000)
        )

        return zipper.init().then(blob => {
            this.progressCallback?.(gettext("LaTeX book export complete."), 100)
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
