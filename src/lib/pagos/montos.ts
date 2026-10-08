// Cuentas de los cobros (sin base de datos: se prueban solas).

// Cargo por servicio al pagar con Mercado Pago: un porcentaje del total,
// redondeado para arriba a pesos enteros. bps = centésimos de por ciento
// (440 = 4,40%).
export function recargoMercadoPago(totalCentavos: number, bps: number) {
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos <= 0 || !Number.isSafeInteger(bps) || bps <= 0) return 0;
  return Math.ceil((totalCentavos * bps) / 10_000 / 100) * 100;
}

// Transferencia: al total se le suman de 1 a 9.999 centavos ($0,01 a $99,99;
// primero los más chicos) para que el monto sea único. Nunca el total
// redondo: una transferencia sin centavos no se confunde con ninguna orden.
export const EXTRA_MAXIMO_CENTAVOS = 9_999;

// "4,4" o "4.40" → 440. null si no es un porcentaje de 0 a 20 con hasta 2 decimales.
export function porcentajeABps(texto: unknown): number | null {
  if (typeof texto !== "string") return null;
  const limpio = texto.trim().replace(/\s|%/g, "").replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(limpio)) return null;
  const bps = Math.round(Number(limpio) * 100);
  return bps >= 0 && bps <= 2000 ? bps : null;
}

// 440 → "4,4"
export function bpsAPorcentaje(bps: number) {
  return (bps / 100).toString().replace(".", ",");
}
