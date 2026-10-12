// PIXEL FONT: a small bitmap font (5 x 7 capitals, a 5-row x-height, 2-row descenders, proportional) drawn here glyph by
// glyph and built into a TrueType font in code (each lit pixel row a run of squares), registered with the page as
// 'RiftPixel' (document.fonts). Set its size to 10 x U css px and every font pixel is U px: crisp pixel text in the DOM
// (dev/wardrobe.js). Characters it lacks fall back to the next font in the stack.
// API: loadPixelFont() -> Promise<FontFace | null> (made once).  BUDGET: ~1 ms once (a few KB of font).
const NAME = 'RiftPixel', PX = 100, ASC = 8, DESC = 2;   // a font pixel = 100 units, the em = 10 rows (8 above the baseline)

// the glyphs: rows top down ('#' lit), row 6 sits on the baseline, rows 7-8 hang below it
const G = {
  'A': '.###./#...#/#...#/#####/#...#/#...#/#...#', 'B': '####./#...#/#...#/####./#...#/#...#/####.', 'C': '.###./#...#/#..../#..../#..../#...#/.###.',
  'D': '####./#...#/#...#/#...#/#...#/#...#/####.', 'E': '#####/#..../#..../####./#..../#..../#####', 'F': '#####/#..../#..../####./#..../#..../#....',
  'G': '.###./#...#/#..../#.###/#...#/#...#/.####', 'H': '#...#/#...#/#...#/#####/#...#/#...#/#...#', 'I': '###/.#./.#./.#./.#./.#./###',
  'J': '..###/...#./...#./...#./#..#./#..#./.##..', 'K': '#...#/#..#./#.#../##.../#.#../#..#./#...#', 'L': '#..../#..../#..../#..../#..../#..../#####',
  'M': '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#', 'N': '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#', 'O': '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  'P': '####./#...#/#...#/####./#..../#..../#....', 'Q': '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#', 'R': '####./#...#/#...#/####./#.#../#..#./#...#',
  'S': '.####/#..../#..../.###./....#/....#/####.', 'T': '#####/..#../..#../..#../..#../..#../..#..', 'U': '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  'V': '#...#/#...#/#...#/#...#/#...#/.#.#./..#..', 'W': '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#', 'X': '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  'Y': '#...#/#...#/.#.#./..#../..#../..#../..#..', 'Z': '#####/....#/...#./..#../.#.../#..../#####',
  'a': '...../...../.###./....#/.####/#...#/.####', 'b': '#..../#..../####./#...#/#...#/#...#/####.', 'c': '..../..../.###/#.../#.../#.../.###',
  'd': '....#/....#/.####/#...#/#...#/#...#/.####', 'e': '...../...../.###./#...#/#####/#..../.###.', 'f': '..##/.#../####/.#../.#../.#../.#..',
  'g': '...../...../.####/#...#/#...#/#...#/.####/....#/.###.', 'h': '#..../#..../####./#...#/#...#/#...#/#...#', 'i': '#/./#/#/#/#/#',
  'j': '..#/.../..#/..#/..#/..#/..#/#.#/.#.', 'k': '#.../#.../#..#/#.#./##../#.#./#..#', 'l': '#./#./#./#./#./#./.#',
  'm': '...../...../##.#./#.#.#/#.#.#/#.#.#/#.#.#', 'n': '...../...../####./#...#/#...#/#...#/#...#', 'o': '...../...../.###./#...#/#...#/#...#/.###.',
  'p': '...../...../####./#...#/#...#/#...#/####./#..../#....', 'q': '...../...../.####/#...#/#...#/#...#/.####/....#/....#',
  'r': '..../..../#.##/##../#.../#.../#...', 's': '...../...../.####/#..../.###./....#/####.', 't': '.#../.#../####/.#../.#../.#../..##',
  'u': '...../...../#...#/#...#/#...#/#...#/.####', 'v': '...../...../#...#/#...#/#...#/.#.#./..#..', 'w': '...../...../#...#/#...#/#.#.#/#.#.#/.#.#.',
  'x': '...../...../#...#/.#.#./..#../.#.#./#...#', 'y': '...../...../#...#/#...#/#...#/#...#/.####/....#/.###.', 'z': '...../...../#####/...#./..#../.#.../#####',
  '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###.', '1': '.#./##./.#./.#./.#./.#./###', '2': '.###./#...#/....#/...#./..#../.#.../#####',
  '3': '####./....#/....#/.###./....#/....#/####.', '4': '...#./..##./.#.#./#..#./#####/...#./...#.', '5': '#####/#..../####./....#/....#/#...#/.###.',
  '6': '.###./#..../#..../####./#...#/#...#/.###.', '7': '#####/....#/...#./..#../..#../..#../..#..', '8': '.###./#...#/#...#/.###./#...#/#...#/.###.',
  '9': '.###./#...#/#...#/.####/....#/....#/.###.',
  '!': '#/#/#/#/#/./#', '"': '#.#/#.#', '#': '.#.#./#####/.#.#./.#.#./#####/.#.#.', '$': '..#../.####/#.#../.###./..#.#/####./..#..',
  '%': '##.../##..#/...#./..#../.#.../#..##/...##', '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#', "'": '#/#', '(': '.#/#./#./#./#./#./.#',
  ')': '#./.#/.#/.#/.#/.#/#.', '*': '...../..#../#.#.#/.###./#.#.#/..#..', '+': '...../..#../..#../#####/..#../..#..', ',': './././././#/#/#',
  '-': '..../..../..../####', '.': '././././././#', '/': '....#/...#./...#./..#../.#.../.#.../#....',
  ':': './././#/././#', ';': '../../../.#/../../.#/#.', '<': '...#/..#./.#../#.../.#../..#./...#', '=': '..../..../####/..../####',
  '>': '#.../.#../..#./...#/..#./.#../#...', '?': '.###./#...#/....#/...#./..#../...../..#..', '@': '.###./#...#/#.###/#.#.#/#.##./#..../.####',
  '[': '##/#./#./#./#./#./##', '\\': '#..../.#.../.#.../..#../...#./...#./....#', ']': '##/.#/.#/.#/.#/.#/##', '^': '..#../.#.#./#...#',
  '_': '...../...../...../...../...../...../#####', '`': '#./.#', '{': '..#/.#./.#./#../.#./.#./..#', '|': '#/#/#/#/#/#/#',
  '}': '#../.#./.#./..#/.#./.#./#..', '~': '...../...../.#..#/#.#.#/#..#.',
  '×': '...../#...#/.#.#./..#../.#.#./#...#', '·': './././#', '—': '......./......./......./#######', '−': '...../...../...../#####',
  '…': '...../...../...../...../...../...../#.#.#', '°': '.#./#.#/.#.', '‹': '.../..#/.#./#../.#./..#', '›': '.../#../.#./..#/.#./#..',
  '⟳': '.###.#/#...##/#..###/#...../#....#/.#..#./..##..', '⟲': '#.###./##...#/###..#/.....#/#....#/.#..#./..##..',
  'å': '..#../...../.###./....#/.####/#...#/.####', 'ä': '.#.#./...../.###./....#/.####/#...#/.####', 'ö': '.#.#./...../.###./#...#/#...#/#...#/.###.',
  'é': '...#./..#../.###./#...#/#####/#..../.###.', '’': '.#/.#/#.',
};

// the font's bytes (TrueType: the glyphs' outlines are squares, one run of lit pixels a row each)
function build() {
  const list = Object.keys(G).map(ch => ch.codePointAt(0)).filter(c => c <= 0xffff).sort((a, b) => a - b);
  if (!list.includes(32)) list.unshift(32);
  const glyphs = [{code: -1, rects: [], adv: 4 * PX}];   // .notdef
  for (const code of list) {
    const rows = code === 32 ? [] : G[String.fromCharCode(code)].split('/'), rects = [];
    let w = 0;
    rows.forEach((row, r) => {
      w = Math.max(w, row.length);
      for (let c = 0; c < row.length;) {
        if (row[c] !== '#') { c++; continue; }
        let e = c; while (e < row.length && row[e] === '#') e++;
        rects.push([c * PX, (6 - r) * PX, e * PX, (7 - r) * PX]);   // x0, y0 (bottom), x1, y1 (top): font units, y up from the baseline
        c = e;
      }
    });
    glyphs.push({code, rects, adv: code === 32 ? 4 * PX : (w + 1) * PX});
  }
  const n = glyphs.length;
  // glyf + loca
  const gl = [], loca = [0];
  let maxPts = 0, maxCt = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
  for (const g of glyphs) {
    if (!g.rects.length) { loca.push(loca[loca.length - 1]); continue; }
    const xs = g.rects.flatMap(r => [r[0], r[2]]), ys = g.rects.flatMap(r => [r[1], r[3]]);
    g.x0 = Math.min(...xs); g.x1 = Math.max(...xs); const y0 = Math.min(...ys), y1 = Math.max(...ys);
    bx0 = Math.min(bx0, g.x0); by0 = Math.min(by0, y0); bx1 = Math.max(bx1, g.x1); by1 = Math.max(by1, y1);
    const nc = g.rects.length, np = nc * 4; maxPts = Math.max(maxPts, np); maxCt = Math.max(maxCt, nc);
    const len = 10 + nc * 2 + 2 + np + np * 4, pad = (4 - len % 4) % 4, b = new DataView(new ArrayBuffer(len + pad));
    let o = 0; const i16 = v => { b.setInt16(o, v); o += 2; };
    i16(nc); i16(g.x0); i16(y0); i16(g.x1); i16(y1);
    for (let k = 0; k < nc; k++) i16(k * 4 + 3);
    i16(0);   // (no instructions)
    for (let k = 0; k < np; k++) b.setUint8(o++, 1);   // (on the curve; x and y as int16 deltas)
    const pts = g.rects.flatMap(([x0, y0r, x1, y1r]) => [[x0, y1r], [x1, y1r], [x1, y0r], [x0, y0r]]);   // (clockwise: an outer contour)
    let px = 0; for (const [x] of pts) { i16(x - px); px = x; }
    let py = 0; for (const [, y] of pts) { i16(y - py); py = y; }
    gl.push(new Uint8Array(b.buffer)); loca.push(loca[loca.length - 1] + b.byteLength);
  }
  const cat = arrs => { const t = arrs.reduce((s, a) => s + a.length, 0), u = new Uint8Array(t); let o = 0; for (const a of arrs) { u.set(a, o); o += a.length; } return u; };
  const T = (len, fn) => { const b = new DataView(new ArrayBuffer(len)); let o = 0; const w = {u8: v => { b.setUint8(o, v); o += 1; }, u16: v => { b.setUint16(o, v); o += 2; }, i16: v => { b.setInt16(o, v); o += 2; }, u32: v => { b.setUint32(o, v >>> 0); o += 4; }}; fn(w); return new Uint8Array(b.buffer); };
  const glyf = cat(gl);
  const locaT = T(loca.length * 4, w => loca.forEach(v => w.u32(v)));
  const advMax = Math.max(...glyphs.map(g => g.adv));
  const head = T(54, w => {
    w.u32(0x10000); w.u32(0x10000); w.u32(0); w.u32(0x5F0F3CF5); w.u16(0x000B); w.u16(PX * (ASC + DESC));
    for (let k = 0; k < 4; k++) w.u32(0);   // created, modified
    w.i16(bx0); w.i16(by0); w.i16(bx1); w.i16(by1); w.u16(0); w.u16(6); w.i16(2); w.i16(1); w.i16(0);
  });
  const hhea = T(36, w => {
    w.u32(0x10000); w.i16(ASC * PX); w.i16(-DESC * PX); w.i16(0); w.u16(advMax); w.i16(0); w.i16(0); w.i16(bx1); w.i16(1); w.i16(0); w.i16(0);
    for (let k = 0; k < 4; k++) w.i16(0); w.i16(0); w.u16(n);
  });
  const hmtx = T(n * 4, w => glyphs.forEach(g => { w.u16(g.adv); w.i16(g.x0 ?? 0); }));
  const maxp = T(32, w => { w.u32(0x10000); w.u16(n); w.u16(maxPts); w.u16(maxCt); for (let k = 0; k < 2; k++) w.u16(0); w.u16(2); for (let k = 0; k < 8; k++) w.u16(0); });
  const codes = glyphs.slice(1).map(g => g.code);
  const os2 = T(96, w => {
    w.u16(4); w.i16(Math.round(glyphs.reduce((s, g) => s + g.adv, 0) / n)); w.u16(400); w.u16(5); w.u16(0);
    for (const v of [500, 500, 0, 100, 500, 500, 0, 400, PX, 300]) w.i16(v);
    w.i16(0); for (let k = 0; k < 10; k++) w.u8(0);
    w.u32(1); w.u32(0); w.u32(0); w.u32(0); for (const c of 'NONE') w.u8(c.charCodeAt(0));
    w.u16(0x40); w.u16(Math.min(...codes)); w.u16(Math.max(...codes));
    w.i16(ASC * PX); w.i16(-DESC * PX); w.i16(0); w.u16(ASC * PX); w.u16(DESC * PX); w.u32(1); w.u32(0);
    w.i16(5 * PX); w.i16(7 * PX); w.u16(0); w.u16(32); w.u16(1);
  });
  // cmap format 4: a segment a run of consecutive codes (their glyphs are consecutive too)
  const segs = [];
  glyphs.slice(1).forEach((g, i) => { const gid = i + 1, s = segs[segs.length - 1]; if (s && g.code === s.end + 1) s.end = g.code; else segs.push({start: g.code, end: g.code, delta: (gid - g.code + 65536) % 65536}); });
  segs.push({start: 0xffff, end: 0xffff, delta: 1});
  const sc = segs.length, sr = 2 * 2 ** Math.floor(Math.log2(sc)), es = Math.floor(Math.log2(sc));
  const sub = T(16 + sc * 8, w => {
    w.u16(4); w.u16(16 + sc * 8); w.u16(0); w.u16(sc * 2); w.u16(sr); w.u16(es); w.u16(sc * 2 - sr);
    segs.forEach(s => w.u16(s.end)); w.u16(0); segs.forEach(s => w.u16(s.start)); segs.forEach(s => w.u16(s.delta)); segs.forEach(() => w.u16(0));
  });
  const cmap = cat([T(12, w => { w.u16(0); w.u16(1); w.u16(3); w.u16(1); w.u32(12); }), sub]);
  const names = [[1, NAME], [2, 'Regular'], [3, NAME], [4, NAME], [6, NAME]], strs = names.map(([, s]) => s);
  const nameT = cat([T(6 + names.length * 12, w => {
    w.u16(0); w.u16(names.length); w.u16(6 + names.length * 12);
    let off = 0; names.forEach(([id, s]) => { w.u16(3); w.u16(1); w.u16(0x409); w.u16(id); w.u16(s.length * 2); w.u16(off); off += s.length * 2; });
  }), ...strs.map(s => T(s.length * 2, w => { for (const ch of s) w.u16(ch.charCodeAt(0)); }))]);
  const post = T(32, w => { w.u32(0x30000); w.u32(0); w.i16(-PX); w.i16(PX); w.u32(0); for (let k = 0; k < 4; k++) w.u32(0); });
  // the file: the table directory (tags in order), each table 4-aligned, checksums, then head's adjustment
  const tables = [['OS/2', os2], ['cmap', cmap], ['glyf', glyf], ['head', head], ['hhea', hhea], ['hmtx', hmtx], ['loca', locaT], ['maxp', maxp], ['name', nameT], ['post', post]];
  const nt = tables.length, dirLen = 12 + nt * 16;
  const sum = u => { const p = new Uint8Array(Math.ceil(u.length / 4) * 4); p.set(u); const d = new DataView(p.buffer); let s = 0; for (let i = 0; i < p.length; i += 4) s = (s + d.getUint32(i)) >>> 0; return s; };
  let off = dirLen; const offs = tables.map(([, u]) => { const o = off; off += Math.ceil(u.length / 4) * 4; return o; });
  const out = new Uint8Array(off), dv = new DataView(out.buffer);
  const er = 2 ** Math.floor(Math.log2(nt));
  dv.setUint32(0, 0x10000); dv.setUint16(4, nt); dv.setUint16(6, er * 16); dv.setUint16(8, Math.log2(er)); dv.setUint16(10, nt * 16 - er * 16);
  tables.forEach(([tag, u], i) => {
    const o = 12 + i * 16; for (let k = 0; k < 4; k++) dv.setUint8(o + k, tag.charCodeAt(k));
    dv.setUint32(o + 4, sum(u)); dv.setUint32(o + 8, offs[i]); dv.setUint32(o + 12, u.length); out.set(u, offs[i]);
  });
  const hi = tables.findIndex(t => t[0] === 'head');
  dv.setUint32(offs[hi] + 8, (0xB1B0AFBA - sum(out)) >>> 0);
  return out.buffer;
}

let made = null;
export function loadPixelFont() {
  return made ??= (async () => {
    try { const f = new FontFace(NAME, build()); await f.load(); document.fonts.add(f); return f; }
    catch (e) { console.warn('pixel font: not made (the fallback font shows)', e); return null; }
  })();
}
