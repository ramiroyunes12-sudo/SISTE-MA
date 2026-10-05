import { requerirUsuario } from "@/lib/auth/actual";

import { EditorEvento } from "../editor";

export default async function PaginaNuevoEvento() {
  await requerirUsuario(["ADMIN"]);
  return (
    <EditorEvento
      eventoId={null}
      inicial={{
        nombre: "",
        slug: "",
        fecha: "",
        lugar: "",
        direccion: "",
        descripcion: "",
        maxPorCompra: "6",
        cupoCortesias: "0",
        estado: "BORRADOR",
        tipos: [{ nombre: "General", lotes: [{ nombre: "Lote 1", precio: "", cupo: "" }] }],
      }}
      infoLotes={{}}
      cortesiasEmitidas={0}
      guardado={false}
    />
  );
}
