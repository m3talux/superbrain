import { parseNote } from "./frontmatter.js";
function slug(s) {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
export function chunkNote(raw) {
    const { content } = parseNote(raw);
    const lines = content.split("\n");
    const out = [];
    const stack = [];
    let buf = [];
    let curPath = "";
    let curAnchor = "";
    const flush = () => {
        const text = buf.join("\n").trim();
        if (text)
            out.push({ headingPath: curPath, anchor: curAnchor, text });
        buf = [];
    };
    for (const line of lines) {
        const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
        if (m) {
            flush();
            const level = m[1].length;
            const title = m[2].trim();
            while (stack.length && stack[stack.length - 1].level >= level)
                stack.pop();
            stack.push({ level, title });
            curPath = stack.map((s) => s.title).join(" > ");
            curAnchor = slug(title);
        }
        else {
            buf.push(line);
        }
    }
    flush();
    return out;
}
