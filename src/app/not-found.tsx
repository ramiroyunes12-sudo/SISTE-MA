import Link from "next/link";

// Página que no existe (link mal copiado, evento borrado…).
export default function NoEncontrada() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16 font-sans">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-borde bg-superficie p-8">
        <h1 className="font-display text-2xl font-extrabold leading-tight">No encontramos esta página</h1>
        <p className="text-tenue">Puede que el link esté mal copiado o que la página ya no exista.</p>
        <Link href="/" className="font-semibold text-acento hover:text-acento-hover">
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
