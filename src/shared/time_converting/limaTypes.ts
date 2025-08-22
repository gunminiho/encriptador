// ---------- Utilidad de ventana de día (Lima) ----------
const LIMA_UTC_OFFSET_MIN = 5 * 60; // UTC-5 (sin DST)

export function getLimaDayUTCWindow(targetLimaDate?: string): {
  startUtc: Date;
  endUtcExcl: Date;
  usageDateUtcISO: string;
} {
  // fecha base: ahora en Lima (desde UTC)
  const nowUtc = new Date();
  const nowLimaMs = nowUtc.getTime() - LIMA_UTC_OFFSET_MIN * 60_000;
  const limaNow = new Date(nowLimaMs);

  let y = limaNow.getUTCFullYear();
  let m = limaNow.getUTCMonth();
  let d = limaNow.getUTCDate() - 1; // por defecto: AYER en Lima

  if (targetLimaDate) {
    const [yy, mm, dd] = targetLimaDate.split('-').map(Number);
    y = yy;
    m = mm - 1;
    d = dd;
  }

  // 00:00:00 Lima => 05:00:00 UTC
  const startUtc = new Date(Date.UTC(y, m, d, 5, 0, 0, 0));
  const endUtcExcl = new Date(Date.UTC(y, m, d + 1, 5, 0, 0, 0));
  return { startUtc, endUtcExcl, usageDateUtcISO: startUtc.toISOString() };
}
