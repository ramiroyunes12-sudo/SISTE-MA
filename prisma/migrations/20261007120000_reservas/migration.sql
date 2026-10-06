-- Paso 10: reserva de 10 minutos.
-- La orden guarda la huella de la llave de su link (/compra/<llave>) y de
-- dónde salió la reserva (navegador y conexión), para limitar cuántas
-- reservas abiertas puede tener cada uno.

-- AlterTable
ALTER TABLE "entradas"."ordenes" ADD COLUMN     "acceso_hash" TEXT,
ADD COLUMN     "comprador_hash" TEXT,
ADD COLUMN     "ip_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_acceso_hash_key" ON "entradas"."ordenes"("acceso_hash");

-- CreateIndex
CREATE INDEX "ordenes_comprador_hash_estado_idx" ON "entradas"."ordenes"("comprador_hash", "estado");

-- CreateIndex
CREATE INDEX "ordenes_ip_hash_estado_idx" ON "entradas"."ordenes"("ip_hash", "estado");

-- Las huellas son SHA-256 en hexadecimal (nunca la llave, la cookie ni la IP).
ALTER TABLE "entradas"."ordenes" ADD CONSTRAINT "ordenes_huellas_validas" CHECK (
  ("acceso_hash" IS NULL OR "acceso_hash" ~ '^[0-9a-f]{64}$')
  AND ("comprador_hash" IS NULL OR "comprador_hash" ~ '^[0-9a-f]{64}$')
  AND ("ip_hash" IS NULL OR "ip_hash" ~ '^[0-9a-f]{64}$')
);
