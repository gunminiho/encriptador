/**
 * Convierte bytes a megabytes (base binaria, 1 MB = 1 048 576 bytes).
 * @param bytes  Número de bytes.
 * @param decimals  Decimales a mostrar (default 2).
 * @returns  Megabytes como número con la cantidad de decimales indicada.
 */
export function bytesToMB(bytes: number, decimals = 4): number {
  const BYTES_IN_MB = 1024 ** 2;
  return Number((bytes / BYTES_IN_MB).toFixed(decimals));
}