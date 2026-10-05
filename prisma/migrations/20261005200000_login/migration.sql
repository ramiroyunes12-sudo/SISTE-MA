-- Paso 5: login del panel (sesiones y bloqueo por intentos fallidos).

-- AlterTable
ALTER TABLE "entradas"."usuarios" ADD COLUMN     "bloqueado_hasta" TIMESTAMPTZ(3),
ADD COLUMN     "debe_cambiar_contrasena" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ultimo_ingreso_en" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "entradas"."sesiones" (
    "id" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sesiones_usuario_id_idx" ON "entradas"."sesiones"("usuario_id");

-- AddForeignKey
ALTER TABLE "entradas"."sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "entradas"."usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Reglas que la base hace cumplir sola (escritas a mano) ─────────────────

-- Email en minúsculas y sin espacios (así "Ana@Gmail.com" y "ana@gmail.com"
-- no pueden ser dos usuarios distintos), nombre no vacío.
ALTER TABLE "entradas"."usuarios" ADD CONSTRAINT "usuarios_datos_validos" CHECK (
  "email" = lower(btrim("email"))
  AND position('@' in "email") > 1
  AND length(btrim("nombre")) > 0
  AND "intentos_fallidos" >= 0
);

-- La huella del código es SHA-256 en hexadecimal (64 caracteres).
ALTER TABLE "entradas"."sesiones" ADD CONSTRAINT "sesiones_datos_validos" CHECK (
  "id" ~ '^[0-9a-f]{64}$'
  AND "expira_en" > "creada_en"
);
