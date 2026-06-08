// US equity market session + earnings awareness.
// Tokenized stocks (e.g. TSLAx) trade 24/7 on-chain, but the underlying equity
// only trades during NYSE/Nasdaq regular hours. Price GAPS over closes, weekends,
// holidays and earnings are the main risk to a concentrated LP range. This module
// surfaces that context so the Guardian acts like a stock-aware LP, not a generic
// 24/7 crypto bot. (This is the project's core differentiator.)

const ET = "America/New_York";

function etParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const o = {};
  for (const p of fmt.formatToParts(date)) o[p.type] = p.value;
  return o;
}

// NYSE full-day holidays 2026 (ET). Early-close days omitted for brevity.
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]);

export function marketSession(now = new Date()) {
  const p = etParts(now);
  const dateStr = `${p.year}-${p.month}-${p.day}`;
  const isWeekend = p.weekday === "Sat" || p.weekday === "Sun";
  const isHoliday = HOLIDAYS.has(dateStr);
  const mins = parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10);
  const OPEN = 9 * 60 + 30; // 09:30 ET
  const CLOSE = 16 * 60;    // 16:00 ET

  let state;
  if (isWeekend) state = "WEEKEND";
  else if (isHoliday) state = "HOLIDAY";
  else if (mins < OPEN) state = "PRE_MARKET";
  else if (mins >= CLOSE) state = "AFTER_HOURS";
  else state = "OPEN";

  const isOpen = state === "OPEN";
  return {
    etTime: `${p.weekday} ${p.hour}:${p.minute} ET`,
    state,
    isOpen,
    isClosed: !isOpen,
    isWeekend,
    isHoliday,
    minsToClose: isOpen ? CLOSE - mins : null,
    minsToOpen: state === "PRE_MARKET" ? OPEN - mins : null,
  };
}

export function earningsContext(nextEarningsISO, windowDays = 3, now = new Date(), confirmed = false) {
  if (!nextEarningsISO) return { known: false, imminent: false, confirmed: false };
  const days = (new Date(nextEarningsISO).getTime() - now.getTime()) / 86400000;
  return {
    known: true,
    date: nextEarningsISO,
    daysUntil: days,
    imminent: days >= 0 && days <= windowDays,
    confirmed,
  };
}
