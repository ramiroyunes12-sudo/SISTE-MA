import { requerirUsuario } from "@/lib/auth/actual";

import { GeneradorDeClave } from "./generador";

// Solo el dueño de la plataforma: generar las claves secretas que van en
// Vercel (CLAVE_CODIGOS, CLAVE_CIFRADO). Se arman en el navegador: no pasan
// por el servidor, no se guardan y no tienen que pasar por ningún chat.
export default async function PaginaClaves() {
  await requerirUsuario(["ADMIN"]);
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-extrabold">Claves</h1>
        <p className="text-tenue">
          Para las claves secretas del sistema, que se cargan en Vercel. No las pegues en ningún chat ni las mandes por
          mensaje.
        </p>
      </div>
      <GeneradorDeClave />
      <section className="flex flex-col gap-2 rounded-2xl border border-borde bg-superficie p-5 text-[15px]">
        <h2 className="text-lg font-bold">Cómo cargarla en Vercel</h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>Vercel → el proyecto → Settings → Environment Variables.</li>
          <li>
            Nueva: <strong>Add</strong>, con el nombre (por ejemplo <code className="font-mono">CLAVE_CODIGOS</code>), la
            clave pegada, solo <strong>Production</strong> y marcada como <strong>Sensitive</strong>. Para cambiar una que
            ya existe: los tres puntitos → <strong>Edit</strong>.
          </li>
          <li>Deployments → el último → los tres puntitos → <strong>Redeploy</strong> (sin eso no se usa la clave nueva).</li>
        </ol>
        <p className="text-tenue">
          Cada clave es para un solo uso: generá una distinta para cada variable. Si cambiás{" "}
          <code className="font-mono">CLAVE_CIFRADO</code>, después hay que volver a conectar las cuentas de Mercado Pago
          (Productoras → Cobros). Si cambiás <code className="font-mono">CLAVE_CODIGOS</code>, los códigos (y QR) ya
          emitidos dejan de servir.
        </p>
      </section>
    </>
  );
}
