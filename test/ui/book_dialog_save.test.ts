/**
 * @jest-environment jsdom
 */
import {describe, expect, jest, test} from "@jest/globals"

import {BookDialog} from "../../src/ui/book_dialog/dialog.js"
import type {Book} from "../../src/types.js"
import {noopChapterLoader, noopE2EEStrategy} from "../../src/exporter/tools.js"

/**
 * The dialog's Save flow, driven through the real DOM: fill in the form
 * fields, click the Save button, and verify that the backend receives the
 * edited book and that a `keepOpen` Save leaves the dialog open.
 */

function makeBook(): Book {
    return {
        title: "",
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

/** Click the button whose label matches. */
function clickButton(label: string): void {
    const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
            ".fw-dialog-buttonpane button"
        )
    )
    const button = buttons.find(candidate =>
        (candidate.textContent ?? "").includes(label)
    )
    expect(button).toBeDefined()
    button!.click()
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
}

// The jsdom document persists between tests; dialogs must not.
afterEach(() => {
    document.body.innerHTML = ""
})

describe("BookDialog save flow", () => {
    test("Save keeps the dialog open and hands the edited book to the backend", async () => {
        const saveBook = jest.fn(async (book: Book) => book)
        const dialog = new BookDialog({
            schema: {} as never,
            chapterLoader: noopChapterLoader,
            e2ee: noopE2EEStrategy,
            book: makeBook(),
            documentList: [],
            backend: {saveBook: saveBook as never}
        })
        dialog.open()
        expect(dialog.dialog).not.toBeNull()

        // The user fills in the basic info fields.
        ;(document.getElementById("book-title") as HTMLInputElement).value =
            "My Test Book"
        ;(
            document.getElementById("book-metadata-author") as HTMLInputElement
        ).value = "Doe, Jane"

        // ...and adds a chapter through the picker path.
        dialog.addChapter({
            id: 5,
            title: "Chapter file",
            path: "/docs/chapter.fidus",
            external: true,
            content: {type: "doc", content: []},
            settings: {},
            comments: {},
            images: {},
            bibliography: {}
        } as never)

        clickButton("Save")
        await flushMicrotasks()

        expect(saveBook).toHaveBeenCalledTimes(1)
        const saved = saveBook.mock.calls[0]?.[0] as Book
        expect(saved.title).toBe("My Test Book")
        expect(saved.metadata.author).toBe("Doe, Jane")
        expect(saved.chapters).toEqual([
            {text: 5, number: 1, part: "", path: "/docs/chapter.fidus"}
        ])

        // The default Save closes the dialog after the save resolves.
        expect(document.querySelector(".fw-dialog-wrapper")).toBeNull()
    })

    test("a keepOpen Save leaves the dialog open after saving", async () => {
        const saveBook = jest.fn(async (book: Book) => book)
        const dialog = new BookDialog({
            schema: {} as never,
            chapterLoader: noopChapterLoader,
            e2ee: noopE2EEStrategy,
            book: makeBook(),
            documentList: [],
            backend: {saveBook: saveBook as never},
            buttons: [
                {text: "Save", keepOpen: true, click: d => d.saveBook()},
                {type: "cancel"}
            ]
        })
        dialog.open()

        ;(document.getElementById("book-title") as HTMLInputElement).value =
            "Keep Me Open"
        clickButton("Save")
        await flushMicrotasks()

        expect(saveBook).toHaveBeenCalledTimes(1)
        expect(
            (saveBook.mock.calls[0]?.[0] as Book).title
        ).toBe("Keep Me Open")
        expect(dialog.dialog).not.toBeNull()
        dialog.dialog?.close()
    })

    test("syncEdits reads the form fields without persisting", () => {
        const dialog = new BookDialog({
            schema: {} as never,
            chapterLoader: noopChapterLoader,
            e2ee: noopE2EEStrategy,
            book: makeBook(),
            documentList: [],
            backend: {saveBook: jest.fn(async (book: Book) => book) as never},
            buttons: [{type: "cancel"}]
        })
        dialog.open()
        ;(document.getElementById("book-title") as HTMLInputElement).value =
            "Unsaved Title"

        const synced = dialog.syncEdits()
        expect(synced.title).toBe("Unsaved Title")
        expect(dialog.options.backend.saveBook).not.toHaveBeenCalled()
    })
})