import { requerirUsuario } from "@/lib/auth/actual";
import { obtenerDb } from "@/lib/db";

import { EditorEvento } from "../editor";

export default async function PaginaNuevoEvento() {
  const usuario = await requerirUsuario(["ADMIN", "ORGANIZADOR"]);
  // El dueño elige para qué productora es; un organizador, siempre la suya.
  const productoras =
    usuario.rol === "ADMIN"
      ? await obtenerDb().productora.findMany({
          where: { activa: true },
          orderBy: { nombre: "asc" },
          select: { id: true, nombre: true },
        })
      : undefined;
  return (
    <EditorEvento
      eventoId={null}
      inicial={{
        productoraId: "",
        nombre: "",
        slug: "",
        fecha: "",
        lugar: "",
        direccion: "",
        descripcion: "",
        maxPorCompra: "4",
        cupoCortesias: "0",
        estado: "BORRADOR",
        tipos: [{ nombre: "General", lotes: [{ nombre: "Lote 1", precio: "", cupo: "" }] }],
      }}
      infoLotes={{}}
      cortesiasEmitidas={0}
      guardado={false}
      productoras={productoras}
    />
  );
}
