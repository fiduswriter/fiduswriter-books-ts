/**
 * Stable document ids for file-based hosts.
 *
 * The server assigns every chapter document a numeric id in its database.
 * File-based hosts (the desktop app, WebDAV) have no such database: a chapter
 * there is a standalone `.fidus` file, so its id is derived from the file's
 * location instead. The derivation is deterministic, so the id a chapter gets
 * when it is added is the same id every later load computes from the path
 * stored in `book.json`.
 */

/**
 * Derive the document id of an external chapter file from its path.
 *
 * FNV-1a over the path with separators normalized to `/`, folded to an
 * unsigned 32-bit integer. Windows and POSIX spellings of the same location
 * therefore produce the same id.
 */
export function chapterIdFromPath(path: string): number {
    const normalized = path.replace(/\\/g, "/")
    let hash = 0x811c9dc5
    for (let i = 0; i < normalized.length; i++) {
        hash ^= normalized.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return hash >>> 0
}
