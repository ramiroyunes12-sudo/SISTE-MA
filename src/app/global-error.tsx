"use client"; // las pantallas de error de Next.js corren en el navegador

// Último recurso: si falla hasta el marco general de la página. No tiene los
// estilos del sitio (reemplaza a todo), por eso los estilos van acá mismo.
export default function ErrorGeneral({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f5f5f2", color: "#15171c" }}>
        <title>Algo salió mal</title>
        <main style={{ maxWidth: 360, margin: "64px auto", padding: "0 16px" }}>
          <h1 style={{ fontSize: 24 }}>Algo salió mal</h1>
          <p style={{ color: "#5b5f69", lineHeight: 1.5 }}>
            No pudimos cargar esta pantalla. Probá de nuevo en unos segundos.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              height: 48,
              padding: "0 20px",
              border: 0,
              borderRadius: 12,
              background: "#3b3be8",
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Probar de nuevo
          </button>
          {error.digest && <p style={{ color: "#5b5f69", fontSize: 12 }}>Código del error: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
