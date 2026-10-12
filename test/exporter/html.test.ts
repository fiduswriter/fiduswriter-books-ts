import {describe, expect, it} from "@jest/globals"
import JSZip from "jszip"

import {HTMLBookExporter} from "../../src/exporter/html/index.js"
import {
    fakeCSL,
    makeBook,
    makeDocumentList,
    schema,
    user
} from "./support.js"

async function combinedHTML(blob: Blob): Promise<string> {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const htmlNames = Object.keys(zip.files).filter(name =>
        name.endsWith(".html")
    )
    const parts = await Promise.all(
        htmlNames.map(name => zip.file(name)!.async("string"))
    )
    return parts.join("\n")
}

describe("HTML book exporter", () => {
    it("exports a two-chapter book with both titles and per-chapter id prefixes", async () => {
        const book = makeBook()
        const documentList = makeDocumentList()

        const exporter = new HTMLBookExporter(
            schema,
            fakeCSL,
            [],
            book,
            user,
            documentList,
            0
        )
        const blob = (await exporter.init()) as Blob
        expect(blob).toBeInstanceOf(Blob)

        const zip = await JSZip.loadAsync(await blob.arrayBuffer())
        expect(zip.files["index.html"]).toBeDefined()
        expect(zip.files["document-1.html"]).toBeDefined()
        expect(zip.files["document-2.html"]).toBeDefined()

        const html = await combinedHTML(blob)
        expect(html).toContain("Chapter One")
        expect(html).toContain("Chapter Two")
        // The HTML exporter prefixes every chapter's ids with `c-<number>-`.
        expect(html).toContain("c-1-")
        expect(html).toContain("c-2-")
    })

    it("exports when a chapter's settings have no language", async () => {
        // Chapters created from a template carry no `language` in their
        // settings until the user picks one.
        const book = makeBook()
        const documentList = makeDocumentList()
        documentList.forEach(doc => {
            delete doc.settings!.language
        })

        const exporter = new HTMLBookExporter(
            schema,
            fakeCSL,
            [],
            book,
            user,
            documentList,
            0
        )
        const blob = (await exporter.init()) as Blob
        expect(blob).toBeInstanceOf(Blob)

        const html = await combinedHTML(blob)
        expect(html).toContain("Chapter One")
        // Without a language the export falls back to English.
        expect(html).toContain('lang="en"')
    })

    it("exports unified HTML when neither chapters nor the book have a language", async () => {
        const book = makeBook()
        delete book.settings.language
        const documentList = makeDocumentList()
        documentList.forEach(doc => {
            delete doc.settings!.language
        })

        const exporter = new HTMLBookExporter(
            schema,
            fakeCSL,
            [],
            book,
            user,
            documentList,
            0,
            false
        )
        const blob = (await exporter.init()) as Blob
        expect(blob).toBeInstanceOf(Blob)

        const zip = await JSZip.loadAsync(await blob.arrayBuffer())
        expect(zip.files["index.html"]).toBeDefined()
        const index = await zip.file("index.html")!.async("string")
        expect(index).toContain("Chapter One")
        expect(index).toContain('lang="en"')
    })
})
