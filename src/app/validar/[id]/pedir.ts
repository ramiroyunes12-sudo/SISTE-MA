// Los pedidos de la pantalla de la puerta a /api/puerta/...: JSON por POST y,
// sin respuesta en 8 segundos, se corta (sin señal no queda esperando).
// null si no hubo respuesta (sin señal, cortado o una respuesta que no es JSON).
const ESPERA_MS = 8_000;

export async function pedirPuerta(ruta: string, cuerpo: object): Promise<{ ok: boolean; cuerpo: unknown } | null> {
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), ESPERA_MS);
  try {
    const respuesta = await fetch(ruta, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      cache: "no-store",
      signal: control.signal,
    });
    return { ok: respuesta.ok, cuerpo: await respuesta.json() };
  } catch {
    return null;
  } finally {
    clearTimeout(corte);
  }
}
