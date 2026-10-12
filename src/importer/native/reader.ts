/**
 * Pure reader for `.fidusbook` archives.
 *
 * Reads the ZIP file, validates the mimetype/version, and returns the raw
 * book metadata plus a `documentList` shaped like the one used by the
 * exporters.  No server interaction.
 */

import type {DocumentListEntry} from "../../types.js"
import {FW_DOCUMENT_VERSION} from "@fiduswriter/document/schema"
import {MAX_FW_DOCUMENT_VERSION} from "@fiduswriter/document/importer/native"

export const FIDUSBOOK_MIMETYPES = [
    "application/fidusbook+zip",
    "application/vnd.fiduswriter.book+zip"
]
/**
 * The Fidus Writer book archive version tracks the document version; there is
 * no independent book version. Legacy book archives (before the unification)
 * used version 1.0, which is still accepted for reading.
 */
export const FIDUSBOOK_VERSION = FW_DOCUMENT_VERSION
export const MIN_FIDUSBOOK_VERSION = 1.0
export const MAX_FIDUSBOOK_VERSION = MAX_FW_DOCUMENT_VERSION

interface ArchiveFile {
    filename: string
    content: string | Blob
}

export interface FidusBookReaderResult {
    book: Record<string, unknown>
    documentList: DocumentListEntry[]
}

/**
 * Read a `.fidusbook` archive and return its contents.
 *
 * @param file - A File/Blob/ArrayBuffer containing the archive.
 * @returns The parsed book and document list.
 */
export async function readFidusBookFile(
    file: Blob | ArrayBuffer
): Promise<FidusBookReaderResult> {
    const JSZip = (await import("jszip")).default
    const zipfs = await JSZip.loadAsync(file)

    const filenames: string[] = []
    zipfs.forEach(filename => filenames.push(filename))

    if (
        !filenames.includes("book.json") ||
        !filenames.includes("filetype-version")
    ) {
        throw new Error("The file does not appear to be a Fidusbook file.")
    }

    const textFiles: ArchiveFile[] = []
    const binaryFiles: ArchiveFile[] = []

    await Promise.all(
        filenames
            .filter(f => !f.endsWith("/"))
            .map(async filename => {
                const isText =
                    filename.endsWith(".json") ||
                    filename === "filetype-version" ||
                    filename === "mimetype"
                const content = await zipfs.files[filename].async(
                    isText ? "string" : "blob"
                )
                const entry = {filename, content}
                if (isText) {
                    textFiles.push(entry as ArchiveFile)
                } else {
                    binaryFiles.push(entry as ArchiveFile)
                }
            })
    )

    const versionEntry = textFiles.find(f => f.filename === "filetype-version")
    const filetypeVersion = Number.parseFloat(versionEntry?.content as string)

    if (
        filetypeVersion < MIN_FIDUSBOOK_VERSION ||
        filetypeVersion > MAX_FIDUSBOOK_VERSION
    ) {
        throw new Error(
            `The Fidusbook file version is not supported by this reader: ${String(
                versionEntry?.content
            )}`
        )
    }

    const mimetypeEntry = textFiles.find(f => f.filename === "mimetype")
    if (
        mimetypeEntry &&
        !FIDUSBOOK_MIMETYPES.includes(mimetypeEntry.content as string)
    ) {
        throw new Error("The file does not appear to be a Fidusbook file.")
    }

    const bookData = JSON.parse(
        textFiles.find(f => f.filename === "book.json")?.content as string
    ) as Record<string, unknown>

    const sortedChapters = [
        ...(bookData.chapters as Array<{
            chapter_index: number
            text?: number
            path?: string
        }>)
    ].sort((a, b) => a.chapter_index - b.chapter_index)

    const documentList: DocumentListEntry[] = []

    for (const chapter of sortedChapters) {
        const ci = chapter.chapter_index

        const docFile = textFiles.find(
            f => f.filename === `chapters/${ci}/document.json`
        )
        const imagesFile = textFiles.find(
            f => f.filename === `chapters/${ci}/images.json`
        )
        const bibFile = textFiles.find(
            f => f.filename === `chapters/${ci}/bibliography.json`
        )

        if (!docFile || !imagesFile || !bibFile) {
            if (chapter.path) {
                // The chapter is a reference to a standalone `.fidus` file and
                // carries no snapshot in this container. The host resolves the
                // live file; the entry is a placeholder until then.
                documentList.push({
                    id: chapter.text ?? 0,
                    title: "",
                    path: chapter.path,
                    external: true,
                    missing: true,
                    content: {type: "doc", content: []},
                    settings: {},
                    comments: {},
                    images: {},
                    bibliography: {}
                } as DocumentListEntry)
                continue
            }
            throw new Error(`Missing chapter data for index ${ci}`)
        }

        const docJson = JSON.parse(docFile.content as string) as Record<string, unknown>
        const imagesJson = JSON.parse(imagesFile.content as string) as Record<string, {image: string; file?: Blob}>
        const bibJson = JSON.parse(bibFile.content as string) as Record<string, unknown>

        const chapterPrefix = `chapters/${ci}/images/`
        const chapterImages: Record<string, Blob> = {}
        binaryFiles
            .filter(f => f.filename.startsWith(chapterPrefix))
            .forEach(f => {
                chapterImages[
                    `images/${f.filename.slice(chapterPrefix.length)}`
                ] = f.content as Blob
            })

        Object.entries(imagesJson).forEach(([, image]) => {
            if (chapterImages[image.image]) {
                image.file = chapterImages[image.image]
            }
        })

        documentList.push({
            id: (docJson.id as number) || 0,
            title: (docJson.title as string) || "",
            path: (docJson.path as string) || "",
            content: (docJson.content || {
                type: "doc",
                content: []
            }) as DocumentListEntry["content"],
            settings: (docJson.settings || {}) as DocumentListEntry["settings"],
            comments: (docJson.comments || {}) as DocumentListEntry["comments"],
            images: imagesJson as DocumentListEntry["images"],
            bibliography: bibJson as DocumentListEntry["bibliography"],
            rawContent: docJson.rawContent as DocumentListEntry["rawContent"],
            e2ee: docJson.e2ee as boolean | undefined,
            e2ee_salt: docJson.e2ee_salt as string | undefined,
            e2ee_iterations: docJson.e2ee_iterations as number | undefined
        } as DocumentListEntry)
    }

    return {book: bookData, documentList}
}

export class FidusBookReader {
    async read(file: Blob | ArrayBuffer): Promise<FidusBookReaderResult> {
        return readFidusBookFile(file)
    }
}
