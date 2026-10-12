import {describe, expect, it} from "@jest/globals"

import {chapterIdFromPath} from "../src/ids.js"

describe("chapterIdFromPath", () => {
    it("is deterministic", () => {
        expect(chapterIdFromPath("/books/chapter-1.fidus")).toBe(
            chapterIdFromPath("/books/chapter-1.fidus")
        )
    })

    it("produces positive 32-bit integers", () => {
        const id = chapterIdFromPath("/some/path.fidus")
        expect(Number.isInteger(id)).toBe(true)
        expect(id).toBeGreaterThan(0)
        expect(id).toBeLessThanOrEqual(0xffffffff)
    })

    it("treats Windows and POSIX spellings of a path as the same file", () => {
        expect(chapterIdFromPath("C:\\books\\chapter 1.fidus")).toBe(
            chapterIdFromPath("C:/books/chapter 1.fidus")
        )
    })

    it("distinguishes different files", () => {
        expect(chapterIdFromPath("/books/a.fidus")).not.toBe(
            chapterIdFromPath("/books/b.fidus")
        )
    })
})
