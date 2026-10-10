// Qué eventos puede ver y tocar cada uno. El ADMIN (dueño de la plataforma),
// todos; los organizadores y validadores, solo los de su productora.
//
// Toda consulta de eventos del panel tiene que pasar por filtroDeEventos():
// así un organizador no ve ni toca lo de otra productora aunque escriba a
// mano la dirección de un evento ajeno.
import type { Prisma, Rol } from "@/generated/prisma/client";

// empiezaEntre: solo los eventos que empiezan en ese rango (la puerta de un
// validador, ver alcanceDeLaPuerta).
export type Alcance = { todo: true } | { todo: false; productoraId: string; empiezaEntre?: { desde: Date; hasta: Date } };

export function alcanceDe(usuario: { rol: Rol; productora: { id: string } | null }): Alcance {
  if (usuario.rol === "ADMIN") return { todo: true };
  // No debería pasar (lo impide la base), pero si pasa, mejor fallar que mostrar todo.
  if (!usuario.productora) throw new Error("Usuario sin productora");
  return { todo: false, productoraId: usuario.productora.id };
}

export function filtroDeEventos(alcance: Alcance): Prisma.EventoWhereInput {
  if (alcance.todo) return {};
  const { productoraId, empiezaEntre } = alcance;
  return empiezaEntre ? { productoraId, fecha: { gte: empiezaEntre.desde, lte: empiezaEntre.hasta } } : { productoraId };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Para las acciones que reciben la productora desde la pantalla (por ejemplo,
// "Validadores"): el ADMIN puede tocar cualquiera; los demás, solo la suya.
export function puedeTocarProductora(alcance: Alcance, productoraId: unknown): productoraId is string {
  if (typeof productoraId !== "string" || !UUID.test(productoraId)) return false;
  return alcance.todo || alcance.productoraId === productoraId;
}

const HORA = 60 * 60 * 1000;
// Un evento sigue en la puerta hasta 24 horas después de empezar (las fiestas
// terminan de madrugada); un validador puede entrar desde 12 horas antes.
export const HORAS_EN_LA_PUERTA = 24;
const HORAS_ANTES_VALIDADOR = 12;

// La puerta (escanear, buscar y el contador): el organizador y el ADMIN, en
// cualquier evento suyo (para probar antes). Un validador, solo en los de su
// productora que empiezan dentro de 12 horas o empezaron hace menos de 24
// (decidido por Ramiro, 10/10/2026): fuera de eso, aunque mande el pedido a
// mano, el evento es como si no existiera (no escanea ni ve nombres ni DNI).
export function alcanceDeLaPuerta(usuario: { rol: Rol; productora: { id: string } | null }, ahora = new Date()): Alcance {
  const alcance = alcanceDe(usuario);
  if (alcance.todo || usuario.rol !== "VALIDADOR") return alcance;
  return {
    ...alcance,
    empiezaEntre: {
      desde: new Date(ahora.getTime() - HORAS_EN_LA_PUERTA * HORA),
      hasta: new Date(ahora.getTime() + HORAS_ANTES_VALIDADOR * HORA),
    },
  };
}
