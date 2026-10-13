/**
 * @jest-environment jsdom
 */
import {describe, expect, jest, test} from "@jest/globals"

import {bookExportMenuModel} from "../../src/ui/book_dialog/export.js"
import type {Book} from "../../src/types.js"

/**
 * Export menu semantics around saving.
 *
 * Every entry saves the book before exporting and hands its export id to the
 * save. A host whose first save hands the session to a new window (the
 * desktop promoting an untitled book) resolves that save falsy and resumes
 * the export itself; the menu must then NOT run the export in the closing
 * window.
 */

function makeBook(): Book {
    return {
        title: "My Book",
        id: 0,
        chapters: [],
        metadata: {},
        settings: {
            bibliography_header: "Bibliography",
            citationstyle: "apa",
            language: "en-US"
        },
        rights: "write"
    } as Book
}

function makeContext() {
    return {
        schema: {} as never,
        csl: {} as never,
        bookStyles: [],
        user: {} as never,
        chapterLoader: {loadChapters: () => Promise.resolve()},
        e2ee: {} as never,
        deliver: jest.fn()
    } as never
}

async function flush(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
}

afterEach(() => {
    document.body.innerHTML = ""
})

describe("book export menu save flow", () => {
    const menu = bookExportMenuModel()
    const find = (title: string) => {
        const entry = menu.content.find(
            item => typeof item.title === "string" && item.title === title
        )
        expect(entry).toBeDefined()
        return entry!
    }

    test("hands its export id to saveBook", async () => {
        const saveBook = jest.fn(async () => false)
        find("Export as BITS").action({
            saveBook,
            book: makeBook(),
            documentList: [],
            context: makeContext()
        })
        await flush()
        expect(saveBook).toHaveBeenCalledWith("bits")
    })

    test("does not run the export when the save resolved falsy", async () => {
        const saveBook = jest.fn(async () => false)
        const context = makeContext()
        find("Export as BITS").action({
            saveBook,
            book: makeBook(),
            documentList: [],
            context
        })
        await flush()
        // The export never started: no delivery, no exporter activity at
        // all. (The host resumed it in the window that took over.)
        expect(context.deliver).not.toHaveBeenCalled()
        expect(document.getElementById("fw-progress-outer-wrapper")).toBeNull()
    })
})
