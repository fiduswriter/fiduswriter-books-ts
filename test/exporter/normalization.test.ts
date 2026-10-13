import {describe, expect, it} from "@jest/globals"
import JSZip from "jszip"

import {BITSBookExporter} from "../../src/exporter/bits/index.js"
import {EpubBookExporter} from "../../src/exporter/epub/index.js"
import {HTMLBookExporter} from "../../src/exporter/html/index.js"
import {LatexBookExporter} from "../../src/exporter/latex/index.js"
import type {DocumentListEntry} from "../../src/types.js"
import {docSchema} from "@fiduswriter/document/schema/document/index"
import {fakeCSL, makeBook, schema, user} from "./support.js"

/**
 * A chapter the way older writers and importers store it: schema-valid, but
 * without the schema's default attrs filled in. Exporting a book whose
 * chapters look like this used to crash the exporters (missing `language`,
 * `figure.attrs.aligned`, contributor attrs, ...).
 */
function makeLegacyChapterDoc(id: number, title: string): DocumentListEntry {
    const content = docSchema
        .nodeFromJSON({
            type: "doc",
            content: [
                {type: "title", content: [{type: "text", text: title}]},
                {
                    type: "contributors_part",
                    attrs: {id: "authors", metadata: "authors"},
                    content: [
                        {
                            type: "contributor",
                            attrs: {
                                firstname: "Jane",
                                lastname: "Doe",
                                institution: false,
                                email: false,
                                id_type: false,
                                id_value: false
                            }
                        }
                    ]
                },
                {
                    type: "figure",
                    attrs: {category: "figure", caption: false, id: false},
                    content: [
                        {type: "image", attrs: {image: 1}},
                        {
                            type: "figure_caption",
                            content: [{type: "text", text: "A figure"}]
                        }
                    ]
                },
                {
                    type: "paragraph",
                    content: [{type: "text", text: "Hello"}]
                }
            ]
        } as never)
        .toJSON()
    // Strip everything a legacy writer would not have stored.
    delete content.attrs.language
    content.content[1].content[0].attrs = {}
    delete content.content[2].attrs.aligned
    delete content.content[2].attrs.width
    return {
        id,
        title,
        path: `/Sample Book/${title}`,
        content,
        settings: {citationstyle: "apa"},
        comments: {},
        images: {
            1: {
                id: 1,
                title: "Image",
                image: "images/image.png",
                file_type: "image/png"
            }
        } as never,
        bibliography: {}
    }
}

const makeLegacyBook = () => {
    const book = makeBook()
    const documentList = [
        makeLegacyChapterDoc(1, "Chapter One"),
        makeLegacyChapterDoc(2, "Chapter Two")
    ]
    return {book, documentList}
}

describe("book exporters with legacy-stored chapters", () => {
    it("normalizes chapter content before HTML export (multi-doc and unified)", async () => {
        const {book, documentList} = makeLegacyBook()
        for (const multiDoc of [true, false]) {
            const exporter = new HTMLBookExporter(
                schema,
                fakeCSL,
                [],
                book,
                user,
                documentList,
                0,
                multiDoc
            )
            const blob = (await exporter.init()) as Blob
            expect(blob).toBeInstanceOf(Blob)
            const zip = await JSZip.loadAsync(await blob.arrayBuffer())
            const index = await zip
                .file("index.html")!
                .async("string")
            // The doc node's schema default language is restored.
            expect(index).toContain('lang="en"')
        }
    })

    it("LaTeX export succeeds", async () => {
        const {book, documentList} = makeLegacyBook()
        const exporter = new LatexBookExporter(
            schema,
            book,
            user,
            documentList,
            0
        )
        const blob = (await exporter.init()) as Blob
        expect(blob).toBeInstanceOf(Blob)
    })

    it("BITS export succeeds", async () => {
        const {book, documentList} = makeLegacyBook()
        const exporter = new BITSBookExporter(
            schema,
            fakeCSL,
            book,
            user,
            documentList,
            0
        )
        const blob = (await exporter.init()) as Blob
        expect(blob).toBeInstanceOf(Blob)
    })

    it("EPUB export succeeds", async () => {
        const {book, documentList} = makeLegacyBook()
        const exporter = new EpubBookExporter(
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
    })
})
