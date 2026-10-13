import {describe, expect, it} from "@jest/globals"
import JSZip from "jszip"

import {BITSBookExporter} from "../../src/exporter/bits/index.js"
import {
    fakeCSL,
    makeBook,
    makeDocumentList,
    schema,
    user
} from "./support.js"

describe("BITS book exporter", () => {
    it("produces a zip with manuscript.xml and manifest.xml", async () => {
        const book = makeBook()
        const documentList = makeDocumentList()

        const exporter = new BITSBookExporter(
            schema,
            fakeCSL,
            book,
            user,
            documentList,
            new Date()
        )
        const result = exporter.init()
        expect(result).not.toBe(false)
        const blob = (await result) as Blob
        expect(blob).toBeInstanceOf(Blob)

        const zip = await JSZip.loadAsync(await blob.arrayBuffer())

        expect(zip.files["manuscript.xml"]).toBeDefined()
        expect(zip.files["manifest.xml"]).toBeDefined()

        const manuscript = (await zip
            .file("manuscript.xml")
            ?.async("string")) as string
        expect(manuscript).toContain("Chapter One")
        expect(manuscript).toContain("Chapter Two")
    })

    it("names data-URL images stably and dates entries sanely", async () => {
        const book = makeBook()
        const documentList = makeDocumentList()
        // A figure referencing an image stored as a data URL, as the desktop
        // holds it after parseFidusBlob. The base64 payload contains "/";
        // the old `split("/").pop()` naming used the tail ("wAAAA...") as
        // the file name.
        const doc = documentList[0]
        const figure = {
            type: "figure",
            attrs: {category: "figure", caption: false, id: false},
            content: [{type: "image", attrs: {image: 7}}]
        }
        ;(doc.content as {content: unknown[]}).content.push(figure)
        doc.images = {
            7: {
                id: 7,
                title: "Pixel",
                image: "data:image/png;base64,iVBOR/wAAAUAAAAABJRU5ErkJggg==",
                file_type: "image/png",
                width: 1,
                height: 1
            }
        }

        const updated = Math.floor(Date.now() / 1000)
        const exporter = new BITSBookExporter(
            schema,
            fakeCSL,
            book,
            user,
            documentList,
            updated
        )
        const blob = (await exporter.init()) as Blob
        const zip = await JSZip.loadAsync(await blob.arrayBuffer())

        const names = Object.keys(zip.files)
        console.log("ZIP NAMES:", names)
        expect(names).toContain("image-7.png")
        for (const name of names) {
            expect(name).not.toContain("=")
        }

        // Zip entries carry the book's `updated` date: a 0/garbage value
        // produced 1970 (misread by unzip tools as 2098).
        const manuscriptDate = zip.files["manuscript.xml"].date
        const year = manuscriptDate.getUTCFullYear()
        expect(year).toBeGreaterThan(2020)
        expect(year).toBeLessThan(2100)
        expect(
            Math.abs(manuscriptDate.getTime() / 1000 - updated)
        ).toBeLessThan(120)
    })
})
