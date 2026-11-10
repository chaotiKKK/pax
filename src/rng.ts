export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const A = ['Ael', 'Vor', 'Kor', 'Thal', 'Nyx', 'Sar', 'Ith', 'Vel', 'Mor', 'Cae', 'Or', 'Tel', 'Ryn', 'Zar', 'Hel', 'Quen', 'Bel', 'Dra', 'Ily', 'Oss', 'Vant', 'Ur', 'Sev', 'Mal'];
const B = ['an', 'en', 'is', 'or', 'ath', 'une', 'os', 'ara', 'eth', 'ir', 'ael', 'ys', 'oth', 'ion', 'elle', 'ur', 'ae', 'im', 'ux', 'ander'];
const C = ['', '', '', ' Prime', ' Minor', ' Major', ' IX', ' VII', ' IV', ' Gate', ' Reach', ' Deep'];

export function makeName(rnd: () => number, used: Set<string>): string {
  for (let i = 0; i < 400; i++) {
    const a = A[Math.floor(rnd() * A.length)];
    const b = B[Math.floor(rnd() * B.length)];
    let n = a + b;
    if (rnd() > 0.72) n += '-' + String.fromCharCode(65 + Math.floor(rnd() * 26)) + Math.floor(rnd() * 9);
    n += C[Math.floor(rnd() * C.length)];
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  const fallback = 'Sektor ' + (used.size + 101);
  used.add(fallback);
  return fallback;
}
