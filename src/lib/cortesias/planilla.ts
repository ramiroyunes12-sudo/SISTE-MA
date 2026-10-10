// La lista para la carga masiva de cortesías: lo que se pega desde Excel o
// Google Sheets (columnas separadas por tabulaciones), un CSV (con "," o ";",
// como lo guarda el Excel en castellano) o una lista escrita a mano ("Juan
// Pérez 40123456 juan@mail.com", una persona por renglón). Un .xlsx se pasa
// antes a texto en el navegador (xlsx.ts). Sin nada del servidor: lo usa
// también la pantalla.
//
// Cada persona es una fila. Si la primera fila tiene títulos (Nombre, DNI,
// Email, Tipo; también Apellido aparte), se usan para saber qué es cada
// columna y las demás columnas no se miran. Si no, cada celda se reconoce
// sola: la que tiene @ es el email, la de 7 u 8 números es el DNI, la que se
// llama como un tipo del evento es el tipo y el resto es el nombre.
import { normalizarDni } from "@/lib/ventas/datos";

// Lo que dice cada fila, todavía sin revisar. `fila` es su número en la
// planilla (con la de títulos), para encontrarla en el Excel.
export type FilaPlanilla = { fila: number; nombre: string; dni: string; email: string; tipo: string; celdas: string[] };

export type Planilla = { titulos: string[] | null; filas: FilaPlanilla[] };

type Columna = "nombre" | "apellido" | "dni" | "email" | "tipo";

// Sin tildes, mayúsculas ni espacios de más: "  Teléfono " → "telefono".
export function comparable(texto: string) {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function columnaDeTitulo(titulo: string): Columna | null {
  const t = comparable(titulo).replace(/[°º.:#]/g, "").trim();
  if (!t) return null;
  if (/^(e-?mail|mail|correo( electronico)?|email)$/.test(t)) return "email";
  if (/\bdni\b|documento|^doc$|^nro doc/.test(t)) return "dni";
  if (/^apellidos?$/.test(t)) return "apellido";
  if (/^(tipo( de entrada)?|entrada|sector)$/.test(t)) return "tipo";
  if (/^(nombres?( y apellidos?| completo)?|apellido y nombres?|invitados?|persona)$/.test(t)) return "nombre";
  return null;
}

const PARECE_EMAIL = /^\S+@\S+$/;

export function pareceDni(texto: string) {
  return /^\d{6,8}$/.test(normalizarDni(texto.trim()));
}

// Corta el texto en filas y celdas. Respeta las comillas del CSV ("Pérez, Juan"
// es una sola celda, y puede tener saltos de línea adentro).
function cortar(texto: string, separador: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const letra = texto[i];
    if (entreComillas) {
      if (letra === '"' && texto[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (letra === '"') entreComillas = false;
      else celda += letra;
    } else if (letra === '"' && celda.trim() === "") {
      entreComillas = true;
      celda = "";
    } else if (letra === separador) {
      fila.push(celda);
      celda = "";
    } else if (letra === "\n") {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else celda += letra;
  }
  fila.push(celda);
  filas.push(fila);
  return filas.map((celdas) => celdas.map((c) => c.replace(/\s+/g, " ").trim()));
}

function elegirSeparador(texto: string) {
  if (texto.includes("\t")) return "\t";
  if (texto.includes(";")) return ";";
  if (texto.includes(",")) return ",";
  return null; // escrita a mano: una persona por renglón, separada por espacios
}

// Reconoce cada celda sola (sin títulos). `tipos`: los nombres de los tipos
// del evento, para reconocer la celda del tipo.
function reconocer(celdas: string[], tipos: string[]) {
  const nombres = new Set(tipos.map(comparable));
  let dni = "";
  let email = "";
  let tipo = "";
  const nombre: string[] = [];
  for (const celda of celdas) {
    if (!celda) continue;
    if (!email && PARECE_EMAIL.test(celda)) email = celda;
    else if (!dni && pareceDni(celda)) dni = celda;
    else if (!tipo && nombres.has(comparable(celda))) tipo = celda;
    else nombre.push(celda);
  }
  return { nombre: nombre.join(" "), dni, email, tipo };
}

// Un renglón escrito a mano: el email y el DNI salen de las palabras; el tipo,
// solo si es la última palabra (así un apellido "General" no se pierde).
function reconocerRenglon(renglon: string, tipos: string[]) {
  const nombres = new Set(tipos.map(comparable));
  const palabras = renglon.split(" ").filter(Boolean);
  let tipo = "";
  if (palabras.length > 1 && nombres.has(comparable(palabras.at(-1)!))) tipo = palabras.pop()!;
  // Un DNI con espacios ("40 123 456") se junta antes de reconocerlo.
  const juntas = palabras.join(" ").replace(/\b(\d{1,3}(?:[ .]\d{3}){2})\b/g, (dni) => dni.replace(/ /g, "."));
  const reconocido = reconocer(juntas.split(" "), []);
  return { ...reconocido, tipo };
}

// Lee la lista. `tipos`: los nombres de los tipos del evento.
export function leerPlanilla(texto: string, tipos: string[]): Planilla {
  const limpio = texto.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const separador = elegirSeparador(limpio);
  const crudas = separador ? cortar(limpio, separador) : limpio.split("\n").map((r) => [r.replace(/\s+/g, " ").trim()]);

  const numeradas = crudas.map((celdas, i) => ({ fila: i + 1, celdas })).filter(({ celdas }) => celdas.some(Boolean));
  if (numeradas.length === 0) return { titulos: null, filas: [] };

  // ¿La primera fila son títulos? Ninguna celda parece un DNI o un email y
  // alguna se reconoce como título.
  const primera = numeradas[0].celdas;
  const columnas = primera.map(columnaDeTitulo);
  const sonTitulos =
    columnas.some(Boolean) && !primera.some((celda) => pareceDni(celda) || PARECE_EMAIL.test(celda));

  if (sonTitulos) {
    const posicion = (columna: Columna) => columnas.indexOf(columna);
    const filas = numeradas.slice(1).map(({ fila, celdas }) => {
      const valor = (columna: Columna) => (posicion(columna) >= 0 ? (celdas[posicion(columna)] ?? "") : "");
      const nombre = [valor("nombre"), valor("apellido")].filter(Boolean).join(" ");
      return { fila, nombre, dni: valor("dni"), email: valor("email"), tipo: valor("tipo"), celdas };
    });
    return { titulos: primera, filas };
  }

  return {
    titulos: null,
    filas: numeradas.map(({ fila, celdas }) => ({
      fila,
      ...(separador ? reconocer(celdas, tipos) : reconocerRenglon(celdas[0], tipos)),
      celdas,
    })),
  };
}

// Las filas pedidas otra vez como texto (separadas por tabulaciones, con los
// títulos si había): lo que queda en el cuadro para corregir.
export function aTexto(planilla: Planilla, filas: FilaPlanilla[]) {
  const renglones = filas.map((fila) => fila.celdas.join("\t"));
  if (planilla.titulos && renglones.length > 0) renglones.unshift(planilla.titulos.join("\t"));
  return renglones.join("\n");
}

// Una planilla (las filas de un .xlsx o un CSV ya leído) como texto con
// tabulaciones, como si se hubiera pegado desde el Excel.
export function celdasATexto(filas: string[][]) {
  return filas
    .map((celdas) => celdas.map((celda) => celda.replace(/[\t\r\n]+/g, " ").trim()).join("\t"))
    .join("\n")
    .replace(/\n+$/, "");
}
