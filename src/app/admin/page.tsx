import { requerirUsuario } from "@/lib/auth/actual";

export default async function PaginaResumen({ searchParams }: PageProps<"/admin">) {
  const usuario = await requerirUsuario(["ADMIN"]);
  const { contrasena } = await searchParams;

  return (
    <>
      {contrasena === "cambiada" && (
        <p role="status" className="rounded-xl bg-ok/10 px-4 py-3 font-semibold text-ok">
          Listo, tu contraseña quedó cambiada.
        </p>
      )}
      <h1 className="font-display text-3xl font-extrabold">Resumen</h1>
      <section className="flex flex-col gap-2 rounded-2xl border border-borde bg-superficie p-6">
        <h2 className="text-lg font-bold">Hola, {usuario.nombre}</h2>
        <p className="text-tenue">
          Ya estás adentro del panel. Acá van a aparecer la recaudación, las ventas por lote y cuánta gente
          ingresó. Las otras secciones del menú se van habilitando a medida que avanzamos.
        </p>
      </section>
    </>
  );
}
