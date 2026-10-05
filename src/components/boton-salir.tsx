import { salir } from "@/lib/auth/acciones";

// "Cerrar sesión": un formulario (y no un link) para que nadie pueda cerrarte
// la sesión con solo hacerte abrir una dirección.
export function BotonSalir({ className }: { className?: string }) {
  return (
    <form action={salir}>
      <button type="submit" className={className}>
        Cerrar sesión
      </button>
    </form>
  );
}
