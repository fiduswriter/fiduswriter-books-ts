import {readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "@jest/globals"

import {
    FidusBookReader,
    readFidusBookFile
} from "../../src/importer/native/reader.js"

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(currentDir, "..", "fixtures", "minimal.fidusbook")

describe("FidusBookReader", () => {
    it("reads a minimal .fidusbook into {book, documentList}", async () => {
        const buffer = readFileSync(fixturePath)

        const reader = new FidusBookReader()
        const result = await reader.read(buffer)

        expect(result).toHaveProperty("book")
        expect(result).toHaveProperty("documentList")

        const {book, documentList} = result
        expect(book.title).toBe("Minimal Book")
        expect(Array.isArray(book.chapters)).toBe(true)
        expect((book.chapters as unknown[]).length).toBe(2)

        expect(documentList).toHaveLength(2)
        // Chapters are returned ordered by chapter_index.
        expect(documentList.map(doc => doc.title)).toEqual([
            "Chapter One",
            "Chapter Two"
        ])

        const first = documentList[0]
        expect(first.id).toBe(1)
        const content = first.content as {
            type: string
            content: Array<{type: string; content?: Array<{text?: string}>}>
        }
        expect(content.type).toBe("doc")
        expect(content.content[0].type).toBe("title")
        expect(content.content[0].content?.[0]?.text).toBe("Chapter One")

        // The document list entries carry image/bibliography databases.
        expect(first.images).toBeDefined()
        expect(first.bibliography).toBeDefined()
    })

    it("exposes readFidusBookFile as a standalone function", async () => {
        const buffer = readFileSync(fixturePath)
        const {book, documentList} = await readFidusBookFile(buffer)
        expect(book.title).toBe("Minimal Book")
        expect(documentList).toHaveLength(2)
    })

    it("rejects a file that is not a Fidusbook", async () => {
        const notABook = new Uint8Array([1, 2, 3, 4]).buffer
        await expect(readFidusBookFile(notABook)).rejects.toThrow()
    })

    it("migrates chapter snapshots written by older file format versions", async () => {
        const JSZip = (await import("jszip")).default

        const makeBook = async (
            version: string,
            chapterDoc: Record<string, unknown>
        ) => {
            const zip = new JSZip()
            zip.file("mimetype", "application/fidusbook+zip")
            zip.file("filetype-version", version)
            zip.file(
                "book.json",
                JSON.stringify({
                    title: "Legacy Book",
                    chapters: [{chapter_index: 0, text: 7}]
                })
            )
            zip.file(
                "chapters/0/document.json",
                JSON.stringify(chapterDoc)
            )
            zip.file("chapters/0/images.json", JSON.stringify({}))
            zip.file("chapters/0/bibliography.json", JSON.stringify({}))
            return zip.generateAsync({type: "arraybuffer"})
        }

        // A 3.4-era bare-node chapter: the top node is still "article"
        // (renamed to "doc" at 3.4).
        const bareChapter = {
            type: "article",
            attrs: {languages: ["en-US"]},
            content: [{type: "title", attrs: {id: "title"}}]
        }
        const bareResult = await readFidusBookFile(
            await makeBook("3.4", bareChapter)
        )
        expect(bareResult.documentList).toHaveLength(1)
        const bareContent = bareResult.documentList[0]
            .content as unknown as {type: string}
        expect(bareContent.type).toBe("doc")

        // A 3.5-era wrapped chapter with the pre-3.6 citation style name
        // (renamed at 3.6).
        const wrappedChapter = {
            id: 7,
            content: {
                type: "doc",
                attrs: {
                    citationstyle: "chicago-note-bibliography",
                    languages: ["en-US"]
                },
                content: [{type: "title", attrs: {id: "title"}}]
            }
        }
        const wrappedResult = await readFidusBookFile(
            await makeBook("3.5", wrappedChapter)
        )
        const wrappedContent = wrappedResult.documentList[0]
            .content as unknown as {
            type: string
            attrs: {citationstyle: string}
        }
        expect(wrappedResult.documentList[0].id).toBe(7)
        expect(wrappedContent.type).toBe("doc")
        expect(wrappedContent.attrs.citationstyle).toBe(
            "chicago-notes-bibliography"
        )
    })
})
