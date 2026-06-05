/**
 * Minimal safetensors reader for F32 tensors.
 * Adapted from @yarflam/potion-base-8m (MIT). See LICENSE.attribution.
 */
import fs from "node:fs";
export function loadSafetensorsSync(filePath) {
    const fd = fs.openSync(filePath, "r");
    try {
        const lenBuf = Buffer.alloc(8);
        fs.readSync(fd, lenBuf, 0, 8, 0);
        const headerLen = Number(lenBuf.readBigUInt64LE(0));
        const headerBuf = Buffer.alloc(headerLen);
        fs.readSync(fd, headerBuf, 0, headerLen, 8);
        const header = JSON.parse(headerBuf.toString("utf-8"));
        const dataStart = 8 + headerLen;
        const result = {};
        for (const [name, info] of Object.entries(header)) {
            if (name === "__metadata__")
                continue;
            const { dtype, data_offsets } = info;
            if (dtype !== "F32")
                throw new Error(`Unsupported dtype ${dtype} for tensor ${name}`);
            const start = dataStart + data_offsets[0];
            const byteLen = data_offsets[1] - data_offsets[0];
            const buf = Buffer.alloc(byteLen);
            fs.readSync(fd, buf, 0, byteLen, start);
            result[name] = new Float32Array(buf.buffer, buf.byteOffset, byteLen / 4);
        }
        return result;
    }
    finally {
        fs.closeSync(fd);
    }
}
