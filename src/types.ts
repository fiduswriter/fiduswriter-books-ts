/**
 * Core types for the @fiduswriter/books package.
 */

import type {Schema} from "prosemirror-model"
import type {
    BibDB,
    CSL,
    ExportDoc,
    ExportMetadata,
    ImageDB,
    User
} from "@fiduswriter/document"

export type {CSL, User} from "@fiduswriter/document"

/** A single chapter entry inside a book. */
export interface Chapter {
    /** Document ID of the chapter. */
    text: number
    /** Display number / order of the chapter. */
    number: number
    /** Optional part title. */
    part?: string
    /** Archive storage index (used by the native importer). */
    chapter_index?: number
    /**
     * Location of the chapter's source `.fidus` file.
     *
     * File-based hosts (desktop app, WebDAV) reference chapters as standalone
     * files rather than database documents; the embedded chapter data inside a
     * `.fidusbook` container is then a snapshot of that file. Hosts without a
     * filesystem (the Django server) leave this unset.
     */
    path?: string
}

/** Book metadata block. */
export interface BookMetadata {
    subtitle?: string
    author?: string
    version?: string
    publisher?: string
    copyright?: string
    description?: string
    isbn?: string
    publication_date?: string
    series_title?: string
    series_position?: string
    keywords?: string
    [key: string]: unknown
}

/** Book settings block. */
export interface BookSettings {
    language: string
    book_style?: string
    papersize?: string
    [key: string]: unknown
}

/** A book record. */
export interface Book {
    id?: number
    title: string
    path?: string
    metadata: BookMetadata
    settings: BookSettings
    chapters: Chapter[]
    cover_image?: number
    cover_image_data?: BookCoverImage
    updated?: number
    added?: number
    docx_template?: string
    odt_template?: string
    rights?: string
    [key: string]: unknown
}

/** Cover image description stored in a book. */
export interface BookCoverImage {
    title?: string
    checksum?: string
    file_type?: string
    image?: string
    [key: string]: unknown
}

/** A single book style with its associated media files. */
export interface BookStyle {
    slug: string
    contents: string
    bookstylefile_set: Array<[string, string]>
    [key: string]: unknown
}

export type BookStyles = BookStyle[]

/** A document entry as held in the book's document list. */
export interface DocumentListEntry extends ExportDoc {
    /** Raw ProseMirror content (used by DOCX/ODT exporters). */
    rawContent?: Record<string, unknown>
    /** Whether the document is end-to-end encrypted. */
    e2ee?: boolean
    /** Base64-encoded salt for E2EE key derivation. */
    e2ee_salt?: string
    /** PBKDF2 iterations for E2EE key derivation. */
    e2ee_iterations?: number
    images?: ImageDB["db"]
    bibliography?: BibDB["db"]
    /**
     * The document lives outside the book as a standalone file; `path` holds
     * its location. The book's chapter then carries the same `path`.
     */
    external?: boolean
    /**
     * The document's source could not be read (a referenced file is missing
     * and no snapshot is embedded). Such entries render as inaccessible and
     * are skipped by exporters.
     */
    missing?: boolean
}

/** Options shared by book exporters. */
export interface BookExporterOptions {
    /** ProseMirror schema used for E2EE decryption. */
    schema?: Schema
    /** CSL engine provider. */
    csl?: CSL
    /** Book styles data. */
    bookStyles?: BookStyles
    /** Logged-in user. */
    user?: User
    /** Document list entries for the book's chapters. */
    documentList?: DocumentListEntry[]
    /** Last-modified timestamp (seconds since epoch). */
    updated?: number
    /** Whether to produce multiple HTML files (HTML exporter only). */
    multiDoc?: boolean
    /** Use relative URLs for linked assets (HTML exporter only). */
    relativeUrls?: boolean
}

/** Strategy for loading missing chapter data before export. */
export interface ChapterLoader {
    loadChapters(
        chapterIds: number[],
        documentList: DocumentListEntry[],
        schema?: Schema,
        rawContent?: boolean
    ): Promise<void>
}

/** Strategy for handling end-to-end encrypted chapters. */
export interface E2EEStrategy {
    ensurePassphraseUnlocked(): Promise<boolean>
    getDocumentPassword(docId: number): Promise<string | null>
    resolvePasswordToKey(
        password: string,
        salt: Uint8Array,
        iterations: number
    ): Promise<CryptoKey>
    decryptObject(encrypted: string, key: CryptoKey): Promise<unknown>
    decryptImageToUrl(encrypted: string, key: CryptoKey): Promise<string>
    storePasswordInSession?(docId: number, password: string): void
}

/** Backend used by NativeBookImporter to create the book record. */
export interface BookImporterBackend {
    /**
     * Create a book record from the imported book data and chapter documents.
     *
     * @param bookData - The raw book object from book.json.
     * @param chapters - The chapters with their final document IDs.
     * @param coverImageId - ID of the imported cover image, or false.
     * @returns A promise resolving to the created book record.
     */
    createBook(
        bookData: Record<string, unknown>,
        chapters: Chapter[],
        coverImageId: number | false
    ): Promise<Book>
}

/** Raw archive content returned by FidusBookReader. */
export interface FidusBookArchive {
    book: Record<string, unknown>
    documentList: DocumentListEntry[]
}

/** Parameters passed to the book.tex template. */
export interface BookTexTemplateParams {
    book: Book
    preamble: string
    epilogue: string
}

/** Parameters passed to the BITS book template. */
export interface BitsTemplateParams {
    front: string
    body: string
    back: string
}

/** Base metadata used by DOCX/ODT book exporters. */
export interface BookBaseMetadata extends ExportMetadata {
    language: string
}
