// Shared CLMM tick<->price math (single source of truth).
// price = 1.0001^tick * 10^(decA - decB)   for a tokenA/tokenB pool.
export const shiftFor = (decA, decB) => 10 ** (decA - decB);
export const tickToPrice = (tick, decA, decB) => Math.pow(1.0001, tick) * shiftFor(decA, decB);
export const priceToTick = (price, decA, decB) => Math.log(price / shiftFor(decA, decB)) / Math.log(1.0001);
