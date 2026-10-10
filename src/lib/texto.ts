// "7, 12 y 30": una lista de números para un texto (N° de compras).
export function enumerar(numeros: readonly number[]) {
  if (numeros.length <= 1) return numeros.join("");
  return `${numeros.slice(0, -1).join(", ")} y ${numeros.at(-1)}`;
}
