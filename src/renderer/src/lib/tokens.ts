/** 950 -> "950", 45_200 -> "45k", 1_250_000 -> "1.3M" */
export const tokens = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
