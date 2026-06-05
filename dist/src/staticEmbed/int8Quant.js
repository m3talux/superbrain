/**
 * Int8 quantization helpers for sqlite-vec int8 vectors.
 * round(v * 127), clamped to [-128, 127].
 */
export function quantizeToInt8(v) {
    const out = new Int8Array(v.length);
    for (let i = 0; i < v.length; i++) {
        const scaled = Math.round(v[i] * 127);
        out[i] = scaled > 127 ? 127 : scaled < -128 ? -128 : scaled;
    }
    return out;
}
export function serializeInt8ForSql(q) {
    return "[" + Array.from(q).join(",") + "]";
}
export function int8ArrayFromBuffer(buf) {
    return new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
