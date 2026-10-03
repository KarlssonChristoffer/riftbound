// GL STATS: what a frame asks of WebGL, counted for the frame profiler (core/perf.js counts: F3 and tools/perf/bench.mjs):
// draw calls, uniform calls, texture uploads from a canvas / image (a DOM source: Chrome snapshots it whole) and from an
// array (G.texData, data textures), their bytes, and buffer uploads' bytes. While it's on it wraps the context's methods
// (one more function call each: ~10 µs a frame at today's ~110 draws and ~250 uniform calls); off, they are the
// prototype's again (no cost).
//   const S = createGLStats(gl); S.enable(on) (cheap to call every frame); S.take() -> this frame's counts (a reused
//   object: read it before the next take) and starts the next frame
const DRAW = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'];
const UNI = ['uniform1f', 'uniform2f', 'uniform3f', 'uniform4f', 'uniform1i', 'uniform2i', 'uniform3i', 'uniform4i',
  'uniform1ui', 'uniform2ui', 'uniform3ui', 'uniform4ui', 'uniform1fv', 'uniform2fv', 'uniform3fv', 'uniform4fv',
  'uniform1iv', 'uniform2iv', 'uniform3iv', 'uniform4iv', 'uniform1uiv', 'uniform2uiv', 'uniform3uiv', 'uniform4uiv',
  'uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv', 'uniformMatrix2x3fv', 'uniformMatrix3x2fv', 'uniformMatrix2x4fv',
  'uniformMatrix4x2fv', 'uniformMatrix3x4fv', 'uniformMatrix4x3fv'];
const isDom = s => s && typeof s === 'object' && !ArrayBuffer.isView(s) && !(s instanceof ImageData) && 'width' in s;
const domPx = s => (s.naturalWidth || s.videoWidth || s.displayWidth || s.width || 0) * (s.naturalHeight || s.videoHeight || s.displayHeight || s.height || 0);

export function createGLStats(gl) {
  const C = {draws: 0, uniforms: 0, texCanvas: 0, texData: 0, texBytes: 0, bufBytes: 0}, out = {...C};
  const tex = (dom, bytes) => { if (dom) C.texCanvas++; else C.texData++; C.texBytes += bytes; };
  let on = false;
  const own = [];
  const wrap = (k, make) => { const f = gl[k]; if (typeof f !== 'function') return; gl[k] = make(f); own.push(k); };
  function enable(v) {
    v = !!v; if (v === on) return; on = v;
    if (!on) { for (const k of own) delete gl[k]; own.length = 0; return; }   // (the prototype's methods again)
    for (const k of DRAW) wrap(k, f => function () { C.draws++; return f.apply(gl, arguments); });
    for (const k of UNI) wrap(k, f => function () { C.uniforms++; return f.apply(gl, arguments); });
    // texImage2D(t, l, if, format, type, SOURCE) | (t, l, if, w, h, border, format, type, src, ...)
    wrap('texImage2D', f => function (t, l, i, a, b, c, d, e, s) {
      if (arguments.length === 6) tex(true, domPx(c) * 4); else tex(isDom(s), a * b * 4);
      return f.apply(gl, arguments);
    });
    // texSubImage2D(t, l, x, y, format, type, SOURCE) | (t, l, x, y, w, h, format, type, src, ...)
    wrap('texSubImage2D', f => function (t, l, x, y, a, b, c, d, s) {
      if (arguments.length === 7) tex(true, domPx(c) * 4); else tex(isDom(s), a * b * 4);
      return f.apply(gl, arguments);
    });
    // bufferSubData(t, offset, src, srcOffset, length) / bufferData(t, src | size, usage, srcOffset, length)
    const bytes = (src, off, len) => typeof src === 'number' ? 0 : len ? len * (src.BYTES_PER_ELEMENT || 1) : src.byteLength - (off || 0) * (src.BYTES_PER_ELEMENT || 1);
    wrap('bufferSubData', f => function (t, o, src, so, len) { C.bufBytes += bytes(src, so, len); return f.apply(gl, arguments); });
    wrap('bufferData', f => function (t, src, u, so, len) { C.bufBytes += bytes(src, so, len); return f.apply(gl, arguments); });
  }
  function take() {
    for (const k in C) { out[k] = C[k]; C[k] = 0; }
    return out;
  }
  return {enable, take, get on() { return on; }};
}
