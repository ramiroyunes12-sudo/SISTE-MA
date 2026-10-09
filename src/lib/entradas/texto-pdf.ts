// Qué texto se puede escribir en el PDF de las entradas. Las fuentes estándar
// del PDF solo tienen las letras de Europa occidental (WinAnsi). Sin pdf-lib:
// lo usa también el formulario de la compra (en el navegador), para no
// aceptar un nombre que después no se puede imprimir.
const EXTRAS_WINANSI = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

export function entraEnWinAnsi(letra: string) {
  const codigo = letra.codePointAt(0)!;
  return (codigo >= 0x20 && codigo <= 0x7e) || (codigo >= 0xa0 && codigo <= 0xff) || EXTRAS_WINANSI.includes(letra);
}

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;

// El texto listo para el PDF. Lo que no entra en la fuente se pasa a la letra
// sin acento si se puede (ő → o); los emojis y lo invisible se sacan; lo
// demás queda "?". Un texto raro nunca rompe el PDF.
export function aTextoPdf(texto: string) {
  let resultado = "";
  // Primero los espacios raros (tab, salto de línea) a espacio; después, fuera
  // lo invisible: caracteres de control y de formato (guion opcional, unión de
  // emojis, marcas de dirección).
  const limpio = texto.normalize("NFC").replace(/\s+/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "");
  for (const letra of limpio) {
    if (entraEnWinAnsi(letra)) {
      resultado += letra;
      continue;
    }
    // Emojis, banderas y marcas sueltas (como el que pide el dibujo del emoji): fuera.
    if (EMOJI.test(letra) || /^\p{M}$/u.test(letra)) continue;
    const sinAcento = letra.normalize("NFD").replace(/\p{M}/gu, "");
    resultado += sinAcento && [...sinAcento].every(entraEnWinAnsi) ? sinAcento : "?";
  }
  return resultado.replace(/ {2,}/g, " ").trim();
}
