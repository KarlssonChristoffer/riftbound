// SPATIAL GRID: a uniform grid over the world (2 m cells) that answers "what may be near here" without a scan over
// every entity. An entity sits in every cell its padded extent touches (its rect, or its circle r, or its point, plus
// PAD); a query walks the cells under its box and collects each entity once (a stamp, no Set). It returns CANDIDATES:
// the caller still does its exact test. PAD lets an entity move up to PAD metres between re-buckets (world/entities.js
// sync, once per sim step) and still be found.
// OWNS: the cells and each record's cell range.  No allocation per query (the caller passes `out`).
//   const g = createGrid({x0, y0, x1, y1, cell})
//   g.insert(rec) / g.remove(rec) / g.fits(rec) (still inside its padded box?) / g.query(x0, y0, x1, y1, out) -> out
//   rec: {p (the entity), id, stamp, c0, c1, r0, r1 (its cell range), bx0, by0, bx1, by1 (its padded box)}
export const PAD = 1;

export function createGrid({x0, y0, x1, y1, cell = 2}) {
  const NX = Math.max(1, Math.ceil((x1 - x0) / cell)), NY = Math.max(1, Math.ceil((y1 - y0) / cell));
  const cells = Array.from({length: NX * NY}, () => []);
  const cx = x => Math.min(NX - 1, Math.max(0, Math.floor((x - x0) / cell)));   // outside the world: the edge cells
  const cy = y => Math.min(NY - 1, Math.max(0, Math.floor((y - y0) / cell)));
  let stamp = 0;
  // the entity's own box (no pad): rect [x0, y0, x1, y1], or a circle of radius r, or its point
  function boxOf(p, b) {
    const R = p.rect;
    if (R) { b[0] = R[0]; b[1] = R[1]; b[2] = R[2]; b[3] = R[3]; }
    else { const r = p.r > 0 ? p.r : 0; b[0] = p.x - r; b[1] = p.y - r; b[2] = p.x + r; b[3] = p.y + r; }
    return b;
  }
  const B = [0, 0, 0, 0];
  function insert(rec) {
    boxOf(rec.p, B);
    rec.bx0 = B[0] - PAD; rec.by0 = B[1] - PAD; rec.bx1 = B[2] + PAD; rec.by1 = B[3] + PAD;
    rec.c0 = cx(rec.bx0); rec.c1 = cx(rec.bx1); rec.r0 = cy(rec.by0); rec.r1 = cy(rec.by1);
    for (let j = rec.r0; j <= rec.r1; j++) for (let i = rec.c0; i <= rec.c1; i++) cells[j * NX + i].push(rec);
  }
  function remove(rec) {
    for (let j = rec.r0; j <= rec.r1; j++) for (let i = rec.c0; i <= rec.c1; i++) {
      const c = cells[j * NX + i], k = c.indexOf(rec); if (k >= 0) c.splice(k, 1);
    }
  }
  // still inside its padded box? (moved less than PAD, didn't grow past it)
  function fits(rec) {
    boxOf(rec.p, B);
    return B[0] >= rec.bx0 && B[1] >= rec.by0 && B[2] <= rec.bx1 && B[3] <= rec.by1;
  }
  // the records whose padded box may overlap the box (x0, y0)-(x1, y1), each once, in cell order (the caller sorts)
  function query(qx0, qy0, qx1, qy1, out) {
    const s = ++stamp, i0 = cx(qx0), i1 = cx(qx1), j0 = cy(qy0), j1 = cy(qy1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = cells[j * NX + i];
      for (let k = 0; k < c.length; k++) {
        const rec = c[k];
        if (rec.stamp === s || rec.bx1 < qx0 || rec.bx0 > qx1 || rec.by1 < qy0 || rec.by0 > qy1) continue;
        rec.stamp = s; out.push(rec);
      }
    }
    return out;
  }
  return {insert, remove, fits, query, NX, NY, cell};
}
