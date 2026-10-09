// "Mails con las entradas" del evento: cuántos salieron y cuáles no (con el
// motivo), y "Reintentar ahora". Al abrir el panel, los que faltan se vuelven
// a intentar solos (después de responder).
import { obtenerDb } from "@/lib/db";
import { formatearFecha } from "@/lib/fechas";
import { configuracionSmtp } from "@/lib/mails/cartero";
import { mandarMailsDespues } from "@/lib/mails/despues";
import { estadoDeLosMails } from "@/lib/mails/pendientes";

import { reintentarMailsAccion } from "../acciones";
import { BotonReintentarMails } from "../pagos";

export async function MailsDelEvento({ eventoId }: { eventoId: string }) {
  const { enviados, sinEnviar } = await estadoDeLosMails(obtenerDb(), eventoId);
  const configurado = configuracionSmtp() !== null;
  if (configurado && sinEnviar.some((mail) => mail.reintentaSolo)) mandarMailsDespues({ eventoId });
  if (enviados === 0 && sinEnviar.length === 0 && configurado) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-borde pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-bold">Mails con las entradas</h3>
          <p className="text-sm text-tenue">
            {enviados === 1 ? "1 enviado" : `${enviados} enviados`}
            {sinEnviar.length > 0 && ` · ${sinEnviar.length} sin enviar`}
          </p>
        </div>
        {sinEnviar.length > 0 && <BotonReintentarMails accion={reintentarMailsAccion.bind(null, eventoId)} />}
      </div>
      {!configurado && (
        <p role="alert" className="rounded-xl bg-alerta/10 px-4 py-3 text-sm">
          <strong>Los mails no salen:</strong> falta configurar el servidor de mail (en Vercel: SMTP_HOST, SMTP_PUERTO,
          SMTP_USUARIO y SMTP_CLAVE). Las entradas igual están en el link de cada compra. Cuando se configure, los que
          faltan salen solos.
        </p>
      )}
      {sinEnviar.length > 0 && (
        <ul className="flex flex-col">
          {sinEnviar.map((mail) => (
            <li key={mail.id} className="flex flex-col gap-0.5 border-t border-[#EDEDE8] py-2 text-sm [overflow-wrap:anywhere]">
              <span>
                <strong>Compra N° {mail.numero}</strong> · {mail.email ?? "sin email"}
              </span>
              <span className="text-tenue">
                {mail.error ?? (mail.intentos > 0 ? "Se está mandando." : "Todavía no se intentó.")}
                {mail.ultimoIntento && ` · último intento ${formatearFecha(mail.ultimoIntento)}`}
                {mail.intentos > 0 && (mail.reintentaSolo ? " · se reintenta solo" : " · ya no se reintenta solo")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
