export interface AliasEntry {
  probability: number;
  alias: number;
  mass: number;
}

export interface EnvironmentAliasTable {
  width: number;
  height: number;
  entries: AliasEntry[];
  totalWeight: number;
}

export interface Reservoir<T> {
  sample: T | null;
  weightSum: number;
  target: number;
  m: number;
}

export function luminance(rgb: readonly [number, number, number]): number {
  return Math.max(0, rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722);
}

export function powerHeuristic(pdfA: number, pdfB: number): number {
  const a = Math.max(0, pdfA);
  const b = Math.max(0, pdfB);
  const aa = a * a;
  const bb = b * b;
  const denominator = aa + bb;
  return denominator > 1e-12 ? aa / denominator : 0;
}

export function balanceHeuristic(pdfA: number, pdfB: number): number {
  const a = Math.max(0, pdfA);
  const b = Math.max(0, pdfB);
  const denominator = a + b;
  return denominator > 1e-12 ? a / denominator : 0;
}

export function buildAliasTable(weights: readonly number[]): AliasEntry[] {
  if (!weights.length) return [];
  const safe = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    const mass = 1 / safe.length;
    return safe.map((_, index) => ({ probability: 1, alias: index, mass }));
  }

  const count = safe.length;
  const scaled = safe.map((value) => (value * count) / total);
  const small: number[] = [];
  const large: number[] = [];
  const probability = new Array<number>(count).fill(1);
  const alias = Array.from({ length: count }, (_, index) => index);
  for (let index = 0; index < count; index += 1) {
    (scaled[index] < 1 ? small : large).push(index);
  }

  while (small.length && large.length) {
    const low = small.pop()!;
    const high = large.pop()!;
    probability[low] = scaled[low];
    alias[low] = high;
    scaled[high] = scaled[high] - (1 - scaled[low]);
    (scaled[high] < 1 ? small : large).push(high);
  }

  for (const index of [...small, ...large]) probability[index] = 1;
  return probability.map((value, index) => ({
    probability: Math.max(0, Math.min(1, value)),
    alias: alias[index],
    mass: safe[index] / total,
  }));
}

export function sampleAlias(entries: readonly AliasEntry[], randomBucket: number, randomCoin: number): number {
  if (!entries.length) return -1;
  const bucket = Math.min(entries.length - 1, Math.max(0, Math.floor(randomBucket * entries.length)));
  const entry = entries[bucket];
  return randomCoin <= entry.probability ? bucket : entry.alias;
}

export function buildEnvironmentAliasTable(
  width: number,
  height: number,
  texel: (x: number, y: number) => readonly [number, number, number],
): EnvironmentAliasTable {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const weights: number[] = [];
  for (let y = 0; y < h; y += 1) {
    const theta0 = (Math.PI * y) / h;
    const theta1 = (Math.PI * (y + 1)) / h;
    const rowSolidAngle = (2 * Math.PI * (Math.cos(theta0) - Math.cos(theta1))) / w;
    for (let x = 0; x < w; x += 1) {
      weights.push(luminance(texel(x, y)) * Math.max(rowSolidAngle, 0));
    }
  }
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return { width: w, height: h, entries: buildAliasTable(weights), totalWeight };
}

export function environmentSolidAnglePdf(table: EnvironmentAliasTable, x: number, y: number): number {
  if (!table.entries.length) return 1 / (4 * Math.PI);
  const ix = Math.max(0, Math.min(table.width - 1, Math.floor(x)));
  const iy = Math.max(0, Math.min(table.height - 1, Math.floor(y)));
  const entry = table.entries[iy * table.width + ix];
  const theta0 = (Math.PI * iy) / table.height;
  const theta1 = (Math.PI * (iy + 1)) / table.height;
  const solidAngle = (2 * Math.PI * (Math.cos(theta0) - Math.cos(theta1))) / table.width;
  return solidAngle > 1e-12 ? entry.mass / solidAngle : 0;
}

export function emptyReservoir<T>(): Reservoir<T> {
  return { sample: null, weightSum: 0, target: 0, m: 0 };
}

export function reservoirUpdate<T>(
  reservoir: Reservoir<T>,
  sample: T,
  target: number,
  proposalPdf: number,
  random: number,
  representedSamples = 1,
): Reservoir<T> {
  const safeTarget = Math.max(0, Number.isFinite(target) ? target : 0);
  const safeProposal = Math.max(1e-12, Number.isFinite(proposalPdf) ? proposalPdf : 0);
  const weight = (safeTarget / safeProposal) * Math.max(1, representedSamples);
  const nextM = reservoir.m + Math.max(1, representedSamples);
  const nextWeightSum = reservoir.weightSum + weight;
  const select = weight > 0 && random * nextWeightSum <= weight;
  return {
    sample: select ? sample : reservoir.sample,
    target: select ? safeTarget : reservoir.target,
    weightSum: nextWeightSum,
    m: nextM,
  };
}

export function reservoirFinalWeight<T>(reservoir: Reservoir<T>): number {
  if (!reservoir.sample || reservoir.target <= 1e-12 || reservoir.m <= 0) return 0;
  return reservoir.weightSum / (reservoir.target * reservoir.m);
}

export function mergeReservoir<T>(
  destination: Reservoir<T>,
  source: Reservoir<T>,
  targetAtDestination: number,
  random: number,
): Reservoir<T> {
  if (!source.sample || source.m <= 0 || source.weightSum <= 0) return destination;
  const sourceFinal = reservoirFinalWeight(source);
  const equivalentProposal = sourceFinal > 1e-12
    ? Math.max(1e-12, targetAtDestination / sourceFinal)
    : Number.POSITIVE_INFINITY;
  return reservoirUpdate(
    destination,
    source.sample,
    targetAtDestination,
    equivalentProposal,
    random,
    source.m,
  );
}
