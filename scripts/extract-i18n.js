#!/usr/bin/env node

/**
 * extract-i18n.js
 *
 * Scans src/ for gettext() calls, extracts unique msgids, looks up
 * translations from a Django djangojs.po file (including obsolete #~ entries),
 * and writes per-language messages.po into locale/.
 *
 * Translations already present in the target messages.po files are preserved,
 * so re-running extraction never loses work done by translate_all.py or by
 * human translators.  All .po parsing handles msgids and msgstrs wrapped over
 * multiple lines (polib and msgcat wrap long lines when saving) — a naive
 * line-based parser silently drops every translation long enough to wrap.
 *
 * Usage:
 *   node scripts/extract-i18n.js <path-to-django-locale>
 */

import {
    readFileSync,
    writeFileSync,
    mkdirSync,
    readdirSync,
    existsSync
} from "node:fs"
import {join, dirname} from "node:path"
import {fileURLToPath} from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const djangoLocalePath = process.argv[2]

if (!djangoLocalePath) {
    console.error("Usage: node scripts/extract-i18n.js <django-locale-dir>")
    process.exit(1)
}

const GETTEXT_RE = /gettext\s*\(\s*["']([^"']+)["']\s*\)/g

const msgids = new Set()

function scanDir(dir) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const full = join(dir, entry.name)
        if (
            entry.isDirectory() &&
            entry.name !== "node_modules" &&
            !entry.name.startsWith(".")
        ) {
            scanDir(full)
        } else if (
            entry.isFile() &&
            (entry.name.endsWith(".ts") ||
                entry.name.endsWith(".js") ||
                entry.name.endsWith(".mjs"))
        ) {
            const content = readFileSync(full, "utf8")
            let match
            while ((match = GETTEXT_RE.exec(content)) !== null) {
                msgids.add(match[1])
            }
        }
    }
}

console.log("Scanning src/ for gettext() calls...")
scanDir(join(root, "src"))
console.log(`Found ${msgids.size} unique msgids.\n`)

if (msgids.size === 0) {
    console.log("No gettext() calls found.")
    process.exit(0)
}

/**
 * Parse the active (non-obsolete) entries of a .po file into a Map of
 * msgid → {msgstr, comment}.  Handles msgids and msgstrs wrapped over
 * multiple lines.  Entries with an empty msgstr and plural entries are
 * skipped.
 */
function parsePoEntries(content) {
    const entries = new Map()
    let msgid = null
    let msgstr = ""
    let comment = ""
    let pendingComment = ""
    let mode = null // null | "msgid" | "msgstr"

    const flush = () => {
        if (msgid && msgstr) {
            entries.set(msgid, {msgstr, comment: comment.trim()})
        }
        msgid = null
        msgstr = ""
        comment = ""
        mode = null
    }

    for (const line of content.split("\n")) {
        const trimmed = line.trim()
        if (trimmed === "") {
            flush()
            pendingComment = ""
            continue
        }
        if (trimmed.startsWith("#~")) {
            // Obsolete entries are handled by parseObsoleteEntries().
            continue
        }
        if (trimmed.startsWith("#")) {
            if (msgid === null) pendingComment += line + "\n"
            continue
        }
        if (trimmed.startsWith("msgid ")) {
            flush()
            comment = pendingComment
            pendingComment = ""
            mode = "msgid"
            msgid = unescapePo(stripQuotes(trimmed.slice(6)))
            continue
        }
        if (
            trimmed.startsWith("msgid_plural") ||
            trimmed.startsWith("msgstr[")
        ) {
            msgid = null
            mode = null
            continue
        }
        if (trimmed.startsWith("msgstr ")) {
            if (msgid === null) continue
            mode = "msgstr"
            msgstr = unescapePo(stripQuotes(trimmed.slice(7)))
            continue
        }
        if (trimmed.startsWith('"')) {
            const fragment = unescapePo(stripQuotes(trimmed))
            if (mode === "msgid") {
                msgid += fragment
            } else if (mode === "msgstr") {
                msgstr += fragment
            }
        }
    }
    flush()
    return entries
}

/**
 * Parse the obsolete (#~) entries of a .po file into a Map of
 * msgid → {msgstr, comment}.  These often still hold the translation of a
 * string that was reworded slightly, so they seed new msgids as well.
 */
function parseObsoleteEntries(content) {
    const entries = new Map()
    let state = null // null | "msgid" | "msgstr"
    let msgid = ""
    let msgstr = ""
    let prevMsgid = null

    const flush = () => {
        if (msgid && msgstr && !entries.has(msgid)) {
            entries.set(msgid, {msgstr, comment: ""})
        }
        if (prevMsgid && msgstr && !entries.has(prevMsgid)) {
            entries.set(prevMsgid, {msgstr, comment: ""})
        }
        state = null
        msgid = ""
        msgstr = ""
        prevMsgid = null
    }

    for (const line of content.split("\n")) {
        const trimmed = line.trim()
        if (
            trimmed.startsWith('#~ msgid "') ||
            trimmed.startsWith("#~ msgid ")
        ) {
            flush()
            state = "msgid"
            msgid = unescapePo(stripQuotes(trimmed.slice(9)))
            continue
        }
        if (
            trimmed.startsWith('#~| msgid "') ||
            trimmed.startsWith("#~| msgid ")
        ) {
            prevMsgid = unescapePo(stripQuotes(trimmed.slice(11)))
            continue
        }
        if (
            state === "msgid" &&
            (trimmed.startsWith('#~ msgstr "') ||
                trimmed.startsWith("#~ msgstr "))
        ) {
            state = "msgstr"
            msgstr = unescapePo(stripQuotes(trimmed.slice(11)))
            continue
        }
        if (trimmed.startsWith('#~ "') && state !== null) {
            const fragment = unescapePo(stripQuotes(trimmed.slice(4)))
            if (state === "msgid") {
                msgid += fragment
            } else {
                msgstr += fragment
            }
            continue
        }
        if (state === "msgstr" && !trimmed.startsWith("#~")) {
            flush()
        }
    }
    flush()
    return entries
}

// Build translation maps from djangojs.po — including obsolete #~ entries
const languages = readdirSync(djangoLocalePath, {withFileTypes: true})
    .filter(e => e.isDirectory())
    .map(e => e.name)

console.log(
    `Looking up translations in ${languages.length} languages (including obsolete entries)...`
)

let totalTranslated = 0

for (const lang of languages) {
    const poFile = join(djangoLocalePath, lang, "LC_MESSAGES", "djangojs.po")
    if (!existsSync(poFile)) continue

    const poContent = readFileSync(poFile, "utf8")
    const translationMap = parsePoEntries(poContent)
    for (const [key, value] of parseObsoleteEntries(poContent)) {
        if (!translationMap.has(key)) translationMap.set(key, value)
    }

    // Merge existing translations from the target .po file so translations
    // added by translate_all.py or manual editing are preserved across
    // re-extractions.
    const existingPo = join(root, "locale", lang, "LC_MESSAGES", "messages.po")
    const existingTranslations = new Map()
    if (existsSync(existingPo)) {
        for (const [key, value] of parsePoEntries(
            readFileSync(existingPo, "utf8")
        )) {
            existingTranslations.set(key, value.msgstr)
        }
    }

    // Build entries
    const entries = []
    for (const msgid of msgids) {
        // Prefer existing translation over djangojs.po lookup (no synthetic comment)
        const existing = existingTranslations.get(msgid)
        const t = existing
            ? {msgstr: existing, comment: ""}
            : translationMap.get(msgid)
        entries.push({
            msgid,
            msgstr: t ? t.msgstr : "",
            comment: t ? t.comment : ""
        })
        if (t?.msgstr) totalTranslated++
    }
    entries.sort((a, b) => a.msgid.localeCompare(b.msgid))

    const header = [
        `# Translations for this package`,
        `# Language: ${lang}`,
        "# Auto-generated by extract-i18n.js",
        "#",
        'msgid ""',
        'msgstr ""',
        '"Content-Type: text/plain; charset=UTF-8\\n"',
        `"Language: ${lang}\\n"`,
        '"Plural-Forms: nplurals=2; plural=(n != 1);\\n"',
        ""
    ].join("\n")

    const body = entries
        .map(e => {
            let lines = ""
            if (e.comment && !e.comment.startsWith("# obsolete")) {
                lines += e.comment + "\n"
            }
            lines += `msgid "${escapePo(e.msgid)}"\n`
            lines += `msgstr "${escapePo(e.msgstr)}"\n`
            return lines + "\n"
        })
        .join("")

    const langDir = join(root, "locale", lang, "LC_MESSAGES")
    mkdirSync(langDir, {recursive: true})
    writeFileSync(join(langDir, "messages.po"), header + body, "utf8")

    const translated = entries.filter(e => e.msgstr).length
    console.log(
        `  ${lang}: ${entries.length} entries, ${translated} translated`
    )
}

console.log(`\nTotal translated strings: ${totalTranslated}`)

function escapePo(s) {
    return s
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t")
}

function unescapePo(s) {
    return s
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\t/g, "\t")
        .replace(/\\\\/g, "\\")
}

function stripQuotes(s) {
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
        return s.slice(1, -1)
    }
    return s
}
