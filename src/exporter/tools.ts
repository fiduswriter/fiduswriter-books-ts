/**
 * Shared tools for book exporters.
 *
 * `getMissingChapterData` is fully dependency-injected: it no longer imports
 * browser/server-specific helpers from the Fidus Writer core.  Callers supply
 * a `ChapterLoader` to fetch missing chapter data and an `E2EEStrategy` to
 * decrypt end-to-end encrypted chapters.
 */

import type {Node, Schema} from "prosemirror-model"
import {getSettings} from "@fiduswriter/document/schema/convert"
import {acceptAllNoInsertions} from "@fiduswriter/document/transform"
import {gettext} from "fwtoolkit"
import type {ProgressCallback} from "@fiduswriter/document/exporter/tools/progress"
import type {FidusDoc} from "@fiduswriter/document"

import type {
    ChapterLoader,
    DocumentListEntry,
    E2EEStrategy,
    Book
} from "../types.js"

/** Default no-op chapter loader. */
export const noopChapterLoader: ChapterLoader = {
    loadChapters: async () => {
        // noop
    }
}

/** Default no-op E2EE strategy. */
export const noopE2EEStrategy: E2EEStrategy = {
    ensurePassphraseUnlocked: async () => false,
    getDocumentPassword: async () => null,
    resolvePasswordToKey: async () => {
        throw new Error("No E2EE strategy provided")
    },
    decryptObject: async () => {
        throw new Error("No E2EE strategy provided")
    },
    decryptImageToUrl: async () => {
        throw new Error("No E2EE strategy provided")
    }
}

/**
 * Ensure all chapter data required for export is present.
 *
 * @param book - The book being exported.
 * @param documentList - Document entries for the book's chapters.
 * @param schema - ProseMirror schema used when parsing decrypted content.
 * @param options - Optional loader and E2EE strategy.
 * @returns Promise that resolves when data is ready.
 */
export async function getMissingChapterData(
    book: Book,
    documentList: DocumentListEntry[],
    schema: Schema,
    options: {
        rawContent?: boolean
        loader?: ChapterLoader
        e2ee?: E2EEStrategy
        progressCallback?: ProgressCallback
    } = {}
): Promise<void> {
    const {
        rawContent = false,
        loader = noopChapterLoader,
        e2ee = noopE2EEStrategy,
        progressCallback
    } = options

    progressCallback?.(gettext("Loading chapter data..."), 0)

    const bookDocuments = book.chapters.map(chapter =>
        documentList.find(doc => doc.id === chapter.text)
    )

    if (bookDocuments.some(doc => doc === undefined)) {
        throw new Error(
            gettext(
                "Cannot produce book as you lack access rights to its chapters."
            )
        )
    }

    const docIds = book.chapters.map(chapter => chapter.text)
    await loader.loadChapters(docIds, documentList, schema, rawContent)
    await decryptE2EEChapters(book, documentList, schema, rawContent, e2ee)

    // Chapter files read straight from disk (WebDAV/desktop hosts) or
    // produced by importers may carry nodes without every schema attr filled
    // in. Round-trip every chapter through the schema so exporters see
    // exactly what the editor would have saved. Best-effort: a chapter whose
    // content does not parse is left untouched, matching what exporters did
    // with it before.
    book.chapters.forEach(chapter => {
        const doc = documentList.find(
            doc => Number(doc.id) === Number(chapter.text)
        )
        if (
            !doc ||
            doc.missing ||
            typeof doc.content !== "object" ||
            !doc.content
        ) {
            return
        }
        try {
            doc.content = schema.nodeFromJSON(
                doc.content as Parameters<Schema["nodeFromJSON"]>[0]
            ).toJSON()
            if (doc.rawContent && typeof doc.rawContent === "object") {
                doc.rawContent = schema.nodeFromJSON(
                    doc.rawContent as Parameters<Schema["nodeFromJSON"]>[0]
                ).toJSON()
            }
            doc.settings = {
                ...doc.settings,
                ...getSettings(doc.content as unknown as FidusDoc)
            }
        } catch {
            // Leave the chapter as stored and let the exporter handle it.
        }
    })

    progressCallback?.(gettext("Chapter data loaded."), 50)
}

/**
 * Decrypt all E2EE chapters in the book whose content is still an encrypted
 * string.
 */
async function decryptE2EEChapters(
    book: Book,
    documentList: DocumentListEntry[],
    schema: Schema,
    rawContent: boolean,
    e2ee: E2EEStrategy
): Promise<void> {
    const e2eeChapters = book.chapters.filter(chapter => {
        const doc = documentList.find(doc => doc.id === chapter.text)
        return doc && doc.e2ee && typeof doc.content === "string"
    })

    if (!e2eeChapters.length) {
        return
    }

    const unlocked = await e2ee.ensurePassphraseUnlocked()
    if (!unlocked) {
        throw new Error(
            gettext(
                "A personal passphrase is required to work with books that contain encrypted chapters. Please set up or unlock your personal passphrase in your profile settings."
            )
        )
    }

    await Promise.all(
        e2eeChapters.map(async chapter => {
            const doc = documentList.find(d => d.id === chapter.text)
            if (!doc) {
                return
            }
            const chapterLabel = doc.title
                ? `"${doc.title}"`
                : gettext("Untitled")

            const password = await e2ee.getDocumentPassword(Number(doc.id))
            if (!password) {
                throw new Error(
                    `${gettext("No encryption key found for chapter:")} ${chapterLabel}. ${gettext("The key may not have been shared with you.")}`
                )
            }

            if (!doc.e2ee_salt) {
                // No salt means the document has no encrypted snapshot yet.
                return
            }

            const salt = base64ToUint8Array(doc.e2ee_salt)
            const iterations = doc.e2ee_iterations || 600000

            const key = await e2ee.resolvePasswordToKey(password, salt, iterations)

            try {
                const decryptedContent = (await e2ee.decryptObject(
                    doc.content as unknown as string,
                    key
                )) as Record<string, unknown>

                // Update the plaintext title.
                const titleNode = (decryptedContent.content as Record<string, unknown>[] | undefined)?.[0]
                const titleContent = (titleNode?.content as Record<string, unknown>[] | undefined) || []
                let title = ""
                titleContent.forEach(child => {
                    const marks = (child.marks as Record<string, unknown>[] | undefined) || []
                    if (!marks.some(m => (m.type as string) === "deletion")) {
                        title += (child.text as string) || ""
                    }
                })
                if (title) {
                    doc.title = title.substring(0, 255)
                    if (typeof sessionStorage !== "undefined") {
                        sessionStorage.setItem(`e2ee_title_${String(doc.id)}`, doc.title)
                    }
                }

                // Parse ProseMirror content.
                if (rawContent) {
                    doc.rawContent = JSON.parse(
                        JSON.stringify(schema.nodeFromJSON(decryptedContent as unknown as Record<string, unknown>).toJSON())
                    )
                }
                doc.content = acceptAllNoInsertions(
                    schema.nodeFromJSON(decryptedContent as unknown as Record<string, unknown>) as Node
                ).toJSON()
                doc.settings = getSettings(doc.content as unknown as FidusDoc)

                // Decrypt encrypted images.
                const encryptedImageEntries = Object.entries(doc.images || {}).filter(
                    ([, entry]) =>
                        entry.file_type === "application/octet-stream" &&
                        typeof entry.image === "string"
                )

                if (!encryptedImageEntries.length) {
                    return
                }

                await Promise.all(
                    encryptedImageEntries.map(async ([id, entry]) => {
                        try {
                            const blobUrl = await e2ee.decryptImageToUrl(
                                entry.image as string,
                                key
                            )
                            doc.images![id] = {
                                ...entry,
                                image: blobUrl,
                                file_type: "image/png"
                            }
                        } catch {
                            delete doc.images![id]
                        }
                    })
                )
            } catch (err) {
                if (
                    err instanceof Error &&
                    err.message.startsWith("No encryption key")
                ) {
                    throw err
                }
                throw new Error(
                    `${gettext("Could not decrypt chapter:")} ${chapterLabel}. ${gettext("The document may have been re-encrypted with a different password.")}`
                )
            }
        })
    )
}

function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}
