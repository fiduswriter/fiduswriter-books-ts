// Mock for `fwtoolkit`.
//
// Mirrors the browser helpers the exporters rely on. `get` is "smart": when a
// DOCX/ODT export template is requested it returns the matching binary fixture
// so the XmlZip loader can unpack a real template; every other request returns
// an empty text/blob response.

import JSZip from "jszip"
import {existsSync, readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures")

const readFixture = name => {
    const path = join(fixturesDir, name)
    return existsSync(path) ? readFileSync(path) : Buffer.from([])
}

export const addAlert = (_type, _message) => {}

/** Progress handle; the dialog only ever closes its tasks in tests. */
export const addProgress = () => ({
    update: () => {},
    close: () => {}
})

/** Ancestor matching, close to the real helper's contract. */
export const findTarget = (event, selector, el) => {
    const target = event.target
    if (!(target instanceof Element)) {
        return false
    }
    const match = target.closest(selector)
    if (match) {
        el.target = match
        return true
    }
    return false
}

/**
 * Minimal stand-in for fwtoolkit's Dialog: renders the title, body and a
 * button pane with real <button> elements, so dialog tests can drive the
 * actual button click wiring (findTarget → button.click handler).
 */
export class Dialog {
    constructor(options) {
        this.options = options
        this.dialogEl = null
        this.opened = false
    }

    open() {
        this.opened = true
        const wrapper = document.createElement("div")
        wrapper.className = "fw-dialog-wrapper"
        const pane = document.createElement("div")
        pane.className = "fw-dialog-buttonpane"
        const set = document.createElement("div")
        set.className = "fw-dialog-buttonset"
        for (const button of this.options.buttons ?? []) {
            const el = document.createElement("button")
            el.type = "button"
            el.className = button.classes ?? "fw-light"
            el.textContent = button.text ?? button.type ?? ""
            if (button.dropdown) {
                const caret = document.createElement("i")
                caret.className = "fa fa-caret-down"
                el.appendChild(caret)
            }
            set.appendChild(el)
        }
        pane.appendChild(set)
        const content = document.createElement("div")
        content.className = "fw-dialog-content"
        content.innerHTML = this.options.body ?? ""
        wrapper.append(content, pane)
        document.body.appendChild(wrapper)
        this.dialogEl = wrapper

        // Wire the button clicks the way the real Dialog does: a click on
        // any button in the pane invokes the matching spec's handler.
        pane.addEventListener("click", event => {
            const target = event.target.closest("button")
            if (!target) {
                return
            }
            const buttons = this.options.buttons ?? []
            const index = Array.from(set.children).indexOf(target)
            const button = buttons[index]
            if (button?.click) {
                button.click(event)
            }
        })
    }

    close() {
        this.dialogEl?.remove()
        this.dialogEl = null
        this.opened = false
    }
}

export class ContentMenu {}

/** Enough of the file selector for dialog tests to open. */
export class FileSelector {
    constructor({dom, files}) {
        this.dom = dom
        this.files = files
        this.selected = []
    }

    init() {}

    deselectAll() {
        this.selected = []
    }
}

export const get = url => {
    let buffer = Buffer.from([])
    if (typeof url === "string") {
        if (url.endsWith(".docx")) {
            buffer = readFixture("template.docx")
        } else if (url.endsWith(".odt")) {
            buffer = readFixture("template.odt")
        }
    }
    return Promise.resolve({
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({}),
        // ZipFileCreator/XmlZip pass the returned value straight to
        // JSZip.loadAsync, which accepts a Node Buffer.
        blob: () => Promise.resolve(buffer)
    })
}

export const post = (_url, _params) => Promise.resolve({ok: true})

export const postJson = (_url, _data) => Promise.resolve({json: {}})

export const getJson = _url => Promise.resolve({})

export const convertDataURIToBlob = _dataURI => new Blob([])

export const escapeText = text =>
    String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")

export const shortFileTitle = (title, path) => title || path || "untitled"

export const longFilePath = (path, filename) => `${path}${filename}`

export const localizeDate = date => new Date(date).toISOString()

export const staticUrl = path => `/static/${path}`

export const gettext = text => text

export const interpolate = (fmt, ...args) => {
    const values = Array.isArray(args[0]) ? args[0] : args
    return fmt.replace(/%s/g, () => values.shift())
}

export const noSpaceTmp = (strings, ...values) => {
    const tmpStrings = Array.from(strings)
    let combined = ""
    while (tmpStrings.length > 0 || values.length > 0) {
        if (tmpStrings.length > 0) {
            combined += tmpStrings.shift()
        }
        if (values.length > 0) {
            const value = values.shift()
            combined += value !== undefined && value !== null ? String(value) : ""
        }
    }
    return combined
        .split("\n")
        .map(line => line.replace(/^\s*/g, ""))
        .join("")
}

export class ZipFileCreator {
    constructor(
        textFiles = [],
        binaryFiles = [],
        zipFiles = [],
        mimeType = "application/zip",
        date = new Date()
    ) {
        this.textFiles = textFiles
        this.binaryFiles = binaryFiles
        this.zipFiles = zipFiles
        this.mimeType = mimeType
        this.date = date
    }

    init() {
        const zipFs = new JSZip()
        if (this.mimeType !== "application/zip") {
            zipFs.file("mimetype", this.mimeType, {compression: "STORE"})
        }
        this.textFiles.forEach(textFile => {
            zipFs.file(textFile.filename, textFile.contents, {
                compression: "DEFLATE"
            })
        })
        const binaryPromises = this.binaryFiles.map(binaryFile =>
            binaryFile.blob
                ? Promise.resolve(binaryFile)
                : get(binaryFile.url).then(response =>
                      response.blob().then(blob => ({...binaryFile, blob}))
                  )
        )
        return Promise.all(binaryPromises).then(binaryFiles => {
            binaryFiles.forEach(binaryFile => {
                zipFs.file(binaryFile.filename, binaryFile.blob, {
                    binary: true,
                    compression: "DEFLATE"
                })
            })
            return zipFs.generateAsync({type: "blob", mimeType: this.mimeType})
        })
    }

    convertDataURIToBlob(_dataURI) {
        return new Blob([])
    }
}

export const isSafeLinkHref = href => {
    if (typeof href !== "string") {
        return false
    }
    const trimmed = href.trim()
    if (!trimmed) {
        return false
    }
    if (trimmed.startsWith("#")) {
        return true
    }
    try {
        const url = new URL(trimmed, "http://localhost")
        return ["http:", "https:"].includes(url.protocol)
    } catch {
        return false
    }
}
