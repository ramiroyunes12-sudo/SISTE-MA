import { obtenerDb } from "@/lib/db";
import { ErrorConfigDb } from "@/lib/db-config";

// GET /api/salud: dice si el sistema se puede conectar a la base de datos.
export async function GET() {
  const inicio = performance.now();
  try {
    await obtenerDb().$queryRaw`SELECT 1`;
    return Response.json({
      estado: "ok",
      baseDeDatos: "conectada",
      ms: Math.round(performance.now() - inicio),
    });
  } catch (error) {
    // El detalle va solo al log del servidor: puede incluir datos de la conexión.
    console.error("[salud] No se pudo conectar a la base de datos:", error);
    const motivo = error instanceof ErrorConfigDb ? error.motivo : "sin_conexion";
    return Response.json(
      { estado: "error", baseDeDatos: "sin conexión", motivo },
      { status: 503 },
    );
  }
}
