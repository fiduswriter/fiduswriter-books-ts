global.gettext = text => text
global.interpolate = (fmt, ...args) => {
    const values = Array.isArray(args[0]) ? args[0] : args
    return fmt.replace(/%s/g, () => values.shift())
}

// The jsdom environment lacks the Node globals some transitive imports
// (restructure, via DOCX tooling) expect.
import {TextEncoder, TextDecoder} from "node:util"
if (typeof global.TextEncoder === "undefined") {
    global.TextEncoder = TextEncoder
}
if (typeof global.TextDecoder === "undefined") {
    global.TextDecoder = TextDecoder
}

// The document HTML/EPUB exporters load stylesheets through the global
// `fetch`. Stub it so no network access is attempted during tests.
global.fetch = () =>
    Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({}),
        blob: () => Promise.resolve(new Blob([]))
    })
