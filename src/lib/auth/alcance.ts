// Qué eventos puede ver y tocar cada uno. El ADMIN (dueño de la plataforma),
// todos; los organizadores y validadores, solo los de su productora.
//
// Toda consulta de eventos del panel tiene que pasar por filtroDeEventos():
// así un organizador no ve ni toca lo de otra productora aunque escriba a
// mano la dirección de un evento ajeno.
import type { Prisma, Rol } from "@/generated/prisma/client";

export type Alcance = { todo: true } | { todo: false; productoraId: string };

export function alcanceDe(usuario: { rol: Rol; productora: { id: string } | null }): Alcance {
  if (usuario.rol === "ADMIN") return { todo: true };
  // No debería pasar (lo impide la base), pero si pasa, mejor fallar que mostrar todo.
  if (!usuario.productora) throw new Error("Usuario sin productora");
  return { todo: false, productoraId: usuario.productora.id };
}

export function filtroDeEventos(alcance: Alcance): Prisma.EventoWhereInput {
  return alcance.todo ? {} : { productoraId: alcance.productoraId };
}
