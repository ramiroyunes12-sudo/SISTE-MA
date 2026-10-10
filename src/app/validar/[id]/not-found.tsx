import Link from "next/link";

// Un evento que no existe o que no es de la productora de quien escanea: en
// vez de la página de error general (que no tiene salida), volver a la lista.
export default function EventoNoDisponible() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-tinta px-4 py-16 font-sans text-white">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="font-display text-3xl font-extrabold leading-tight">Este evento no está disponible</h1>
        <p className="text-white/80">Puede que el link esté mal copiado, que el evento se haya borrado o que no sea de tu productora.</p>
        <Link
          href="/validar"
          className="flex min-h-16 items-center justify-center rounded-2xl bg-white text-xl font-bold text-tinta"
        >
          Elegir otro evento
        </Link>
      </div>
    </main>
  );
}
