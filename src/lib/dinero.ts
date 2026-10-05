// Plata: en la base siempre en centavos (números enteros, sin errores de
// redondeo). Acá se pasa de y a como lo escribe la gente: "$ 6.000", "6000",
// "6.000,50".

// "6.000" → 600000. Devuelve null si no se entiende.
export function parsearPesos(texto: string): number | null {
  const limpio = texto.replace(/\$/g, "").replace(/\s/g, "");
  let entero: string;
  let decimales = "";
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(limpio)) {
    // con puntos de miles: 6.000 / 1.250.000,50
    [entero, decimales = ""] = limpio.replace(/\./g, "").split(",");
  } else if (/^\d+([,.]\d{1,2})?$/.test(limpio)) {
    // sin miles: 6000 / 6000,5 / 6000.50
    [entero, decimales = ""] = limpio.split(/[,.]/);
  } else {
    return null;
  }
  const centavos = Number(entero) * 100 + Number(decimales.padEnd(2, "0"));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

// 600000 → "6.000"; 600050 → "6.000,50". Sin el "$" (para los campos).
export function pesosParaEditar(centavos: number) {
  const pesos = Math.trunc(centavos / 100);
  const resto = centavos % 100;
  const conMiles = pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return resto ? `${conMiles},${resto.toString().padStart(2, "0")}` : conMiles;
}

// 600000 → "$ 6.000".
export function formatearPesos(centavos: number) {
  return `$ ${pesosParaEditar(centavos)}`;
}
