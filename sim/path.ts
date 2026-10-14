// Grid A* with octile movement and no corner cutting. Deterministic tie-breaking.

export type CostFn = (i: number) => number; // <0 = blocked, otherwise extra cost

export class PathFinder {
  w: number;
  h: number;
  g: Int32Array;
  parent: Int32Array;
  stamp: Uint32Array;
  closed: Uint32Array;
  gen = 0;
  heap: Int32Array;
  heapF: Int32Array;
  heapN = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.g = new Int32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n * 8 + 16);
    this.heapF = new Int32Array(n * 8 + 16);
  }

  private push(node: number, f: number) {
    let i = this.heapN++;
    const H = this.heap,
      F = this.heapF;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] < f || (F[p] === f && H[p] < node)) break;
      H[i] = H[p];
      F[i] = F[p];
      i = p;
    }
    H[i] = node;
    F[i] = f;
  }

  private pop(): number {
    const H = this.heap,
      F = this.heapF;
    const top = H[0];
    const n = --this.heapN;
    if (n > 0) {
      const node = H[n],
        f = F[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && (F[c + 1] < F[c] || (F[c + 1] === F[c] && H[c + 1] < H[c]))) c++;
        if (F[c] > f || (F[c] === f && H[c] > node)) break;
        H[i] = H[c];
        F[i] = F[c];
        i = c;
      }
      H[i] = node;
      F[i] = f;
    }
    return top;
  }

  /**
   * Find a path from start to goal. Returns list of cells (excluding start).
   * If goal unreachable, returns path to the closest reached cell. Returns [] if already there / nothing better.
   */
  find(start: number, goal: number, cost: CostFn, maxNodes = 6000): number[] {
    const W = this.w,
      Hh = this.h;
    if (start === goal) return [];
    this.gen++;
    if (this.gen === 0xffffffff) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const gx = goal % W,
      gy = (goal / W) | 0;
    const hfn = (i: number) => {
      const dx = Math.abs((i % W) - gx),
        dy = Math.abs(((i / W) | 0) - gy);
      return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx;
    };
    this.heapN = 0;
    this.g[start] = 0;
    this.parent[start] = -1;
    this.stamp[start] = gen;
    this.push(start, hfn(start));
    let best = start,
      bestH = hfn(start);
    let expanded = 0;
    const G = this.g,
      P = this.parent,
      S = this.stamp,
      C = this.closed;
    while (this.heapN > 0) {
      const cur = this.pop();
      if (C[cur] === gen) continue;
      C[cur] = gen;
      if (cur === goal) {
        best = cur;
        break;
      }
      const hc = hfn(cur);
      if (hc < bestH || (hc === bestH && G[cur] < G[best])) {
        best = cur;
        bestH = hc;
      }
      if (++expanded > maxNodes) break;
      const cx = cur % W,
        cy = (cur / W) | 0;
      const gcur = G[cur];
      // orthogonal passability cache for corner-cutting rule
      const okL = cx > 0 && cost(cur - 1) >= 0;
      const okR = cx < W - 1 && cost(cur + 1) >= 0;
      const okU = cy > 0 && cost(cur - W) >= 0;
      const okD = cy < Hh - 1 && cost(cur + W) >= 0;
      for (let k = 0; k < 8; k++) {
        let n: number, step: number;
        switch (k) {
          case 0: if (!okL) continue; n = cur - 1; step = 10; break;
          case 1: if (!okR) continue; n = cur + 1; step = 10; break;
          case 2: if (!okU) continue; n = cur - W; step = 10; break;
          case 3: if (!okD) continue; n = cur + W; step = 10; break;
          case 4: if (!okL || !okU) continue; n = cur - W - 1; step = 14; break;
          case 5: if (!okR || !okU) continue; n = cur - W + 1; step = 14; break;
          case 6: if (!okL || !okD) continue; n = cur + W - 1; step = 14; break;
          default: if (!okR || !okD) continue; n = cur + W + 1; step = 14; break;
        }
        if (C[n] === gen) continue;
        const extra = k < 4 ? 0 : cost(n);
        if (extra < 0) continue;
        const ng = gcur + step + (k < 4 ? cost(n) : extra);
        if (S[n] === gen && G[n] <= ng) continue;
        S[n] = gen;
        G[n] = ng;
        P[n] = cur;
        this.push(n, ng + hfn(n));
      }
    }
    if (best === start) return [];
    const out: number[] = [];
    let c = best;
    while (c !== start && c >= 0) {
      out.push(c);
      c = P[c];
    }
    out.reverse();
    return out;
  }
}
