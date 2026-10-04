export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16 font-sans">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-borde bg-superficie p-8">
        <span className="font-display text-lg font-extrabold">[TU MARCA]</span>
        <h1 className="font-display text-3xl font-extrabold leading-tight">
          ¡Hola! El sistema de entradas está andando.
        </h1>
        <p className="text-base leading-relaxed text-tenue">
          Esta es la base del proyecto. Acá va a aparecer la página del evento.
        </p>
      </div>
    </main>
  );
}
