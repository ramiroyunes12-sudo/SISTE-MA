"use client";

// El escáner de la puerta. La cámara trasera lee el QR y el código va al
// servidor (/api/puerta/escanear), que decide: PASA (y la entrada queda
// usada), YA INGRESÓ o NO VÁLIDA. Acá no se decide nada: ante cualquier error
// (sin señal, respuesta rara) se muestra NO VÁLIDA, nunca PASA.
//
// Leer el QR: en Android (Chrome) con el lector del navegador
// (BarcodeDetector); en iPhone no existe, así que con jsQR, que mira la imagen
// de la cámara cuadro por cuadro (se descarga solo si hace falta).
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import type { ErrorPuerta, PersonaPuerta, RespuestaPuerta } from "@/lib/entradas/puerta";

type Resultado = RespuestaPuerta | ErrorPuerta;
type Fase =
  | { tipo: "inicio"; aviso?: string }
  | { tipo: "abriendo" }
  | { tipo: "escaneando" }
  | { tipo: "sin_camara"; motivo: string }
  | { tipo: "verificando" }
  | { tipo: "resultado"; resultado: Resultado };
type Lector = (video: HTMLVideoElement) => Promise<string | null>;

const ESPERA_MS = 8_000; // sin respuesta en este tiempo: NO VÁLIDA (escanear de nuevo)
const ENTRE_CUADROS_MS = 100;
const MISMA_ENTRADA_MS = 10_000; // la entrada de recién, todavía delante de la cámara: no se vuelve a mandar
const LADO_JSQR = 640; // jsQR mira el centro de la imagen, achicado a esto (más rápido)

const MOTIVOS: Record<Extract<RespuestaPuerta, { resultado: "no_valida" }>["motivo"], string> = {
  formato: "Este QR no es una entrada.",
  firma: "El código fue modificado: es trucho.",
  no_existe: "No encontramos esta entrada.",
  otro_evento: "Es una entrada de otro evento.",
  sin_pagar: "La compra no está paga.",
  anulada: "La entrada se anuló o la compra se devolvió.",
};

const ERRORES: Record<ErrorPuerta["error"], string> = {
  conexion: "No se pudo verificar: falló la conexión. Escaneala de nuevo.",
  sesion: "Se cerró tu sesión. Volvé a ingresar para seguir escaneando.",
  evento: "Este evento ya no está disponible.",
  pedido: "No se pudo verificar. Recargá la página y probá de nuevo.",
};

export function Escaner({ eventoId }: { eventoId: string }) {
  const [fase, setFase] = useState<Fase>({ tipo: "inicio" });
  const [repetida, setRepetida] = useState(false);
  const [linterna, setLinterna] = useState<boolean | null>(null); // null: el celu no tiene
  const videoRef = useRef<HTMLVideoElement>(null);
  const flujo = useRef<MediaStream | null>(null);
  const lector = useRef<Lector | null>(null);
  const sonido = useRef<AudioContext | null>(null);
  const pantalla = useRef<{ release(): Promise<void> } | null>(null);
  const quiereCamara = useRef(false);
  const ultimo = useRef<string | null>(null);
  const reciente = useRef<{ texto: string; hasta: number } | null>(null);

  const detenerCamara = useCallback(() => {
    flujo.current?.getTracks().forEach((pista) => pista.stop());
    flujo.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    pantalla.current?.release().catch(() => {});
    pantalla.current = null;
    setLinterna(null);
  }, []);

  const verificar = useCallback(
    async (codigo: string) => {
      ultimo.current = codigo.trim();
      setFase({ tipo: "verificando" });
      const resultado = await pedir(eventoId, codigo);
      avisar(sonido.current, resultado);
      setFase({ tipo: "resultado", resultado });
    },
    [eventoId],
  );

  async function abrirCamara() {
    quiereCamara.current = true;
    sonido.current ??= crearSonido(); // en el toque: si no, el iPhone no lo deja sonar
    sonido.current?.resume().catch(() => {});
    if (!navigator.mediaDevices?.getUserMedia) {
      setFase({ tipo: "sin_camara", motivo: "Este navegador no deja usar la cámara. Abrí la página en Chrome o en Safari." });
      return;
    }
    setFase({ tipo: "abriendo" });
    try {
      detenerCamara();
      const nuevo = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      flujo.current = nuevo;
      const video = videoRef.current!;
      video.srcObject = nuevo;
      await video.play();
      lector.current ??= await crearLector();
      const pista = nuevo.getVideoTracks()[0];
      setLinterna("torch" in (pista?.getCapabilities?.() ?? {}) ? false : null);
      pista?.addEventListener("ended", () => {
        detenerCamara();
        setFase((actual) => (actual.tipo === "escaneando" ? { tipo: "inicio", aviso: "Se cortó la cámara." } : actual));
      });
      pantalla.current = await pedirPantallaPrendida();
      setFase({ tipo: "escaneando" });
    } catch (error) {
      detenerCamara();
      setFase({ tipo: "sin_camara", motivo: motivoSinCamara(error) });
    }
  }

  async function otraEntrada() {
    if (ultimo.current) reciente.current = { texto: ultimo.current, hasta: Date.now() + MISMA_ENTRADA_MS };
    setRepetida(false);
    if (flujo.current?.getVideoTracks()[0]?.readyState === "live") setFase({ tipo: "escaneando" });
    else if (quiereCamara.current) await abrirCamara();
    else setFase({ tipo: "inicio" });
  }

  async function cambiarLinterna() {
    const pista = flujo.current?.getVideoTracks()[0];
    if (!pista || linterna === null) return;
    try {
      await pista.applyConstraints({ advanced: [{ torch: !linterna } as MediaTrackConstraintSet] });
      setLinterna(!linterna);
    } catch {
      setLinterna(null);
    }
  }

  function escribirCodigo(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const campo = evento.currentTarget.elements.namedItem("codigo") as HTMLInputElement;
    const codigo = campo.value.trim();
    if (!codigo) return;
    campo.value = "";
    sonido.current ??= crearSonido();
    sonido.current?.resume().catch(() => {});
    verificar(codigo);
  }

  // Leer cuadros mientras se está escaneando.
  useEffect(() => {
    if (fase.tipo !== "escaneando") return;
    let cancelado = false;
    let espera: ReturnType<typeof setTimeout> | undefined;
    let sinAviso: ReturnType<typeof setTimeout> | undefined;
    async function cuadro() {
      const video = videoRef.current;
      const leer = lector.current;
      if (cancelado) return;
      if (video && leer && video.readyState >= 2) {
        const texto = await leer(video).catch(() => null);
        if (cancelado) return;
        if (texto) {
          const antes = reciente.current;
          if (antes && antes.texto === texto.trim() && Date.now() < antes.hasta) {
            setRepetida(true);
            clearTimeout(sinAviso);
            sinAviso = setTimeout(() => setRepetida(false), 1_500);
          } else {
            reciente.current = null;
            setRepetida(false);
            verificar(texto);
            return;
          }
        }
      }
      espera = setTimeout(cuadro, ENTRE_CUADROS_MS);
    }
    cuadro();
    return () => {
      cancelado = true;
      clearTimeout(espera);
      clearTimeout(sinAviso);
    };
  }, [fase.tipo, verificar]);

  // Con el celu bloqueado o en otra app, la cámara se apaga (batería); al
  // volver, un toque la prende de nuevo.
  useEffect(() => {
    function alCambiar() {
      if (document.visibilityState !== "hidden" || !flujo.current) return;
      detenerCamara();
      setFase((actual) =>
        actual.tipo === "escaneando" || actual.tipo === "abriendo" ? { tipo: "inicio", aviso: "La cámara se pausó." } : actual,
      );
    }
    document.addEventListener("visibilitychange", alCambiar);
    return () => {
      document.removeEventListener("visibilitychange", alCambiar);
      detenerCamara();
    };
  }, [detenerCamara]);

  const camaraVisible = fase.tipo === "escaneando" || fase.tipo === "abriendo" || fase.tipo === "verificando";

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-hidden="true"
          className={`h-full w-full object-cover ${camaraVisible ? "" : "invisible"}`}
        />
        {camaraVisible && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-[12%] rounded-2xl border-4 border-white/80" />
        )}
        {fase.tipo === "inicio" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            {fase.aviso && <p className="text-white/80">{fase.aviso}</p>}
            <button
              type="button"
              onClick={abrirCamara}
              className="min-h-16 w-full max-w-xs rounded-2xl bg-white px-6 text-xl font-bold text-tinta"
            >
              {fase.aviso ? "Seguir escaneando" : "Abrir la cámara"}
            </button>
          </div>
        )}
        {fase.tipo === "sin_camara" && (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="text-lg">{fase.motivo}</p>
            <button type="button" onClick={abrirCamara} className="min-h-12 rounded-xl border-2 border-white px-5 font-bold">
              Probar de nuevo
            </button>
          </div>
        )}
        {fase.tipo === "abriendo" && <Cartel>Abriendo la cámara…</Cartel>}
        {fase.tipo === "verificando" && <Cartel>Verificando…</Cartel>}
      </div>

      <div className="flex min-h-12 items-center justify-between gap-3">
        <p role="status" className="text-lg text-white/90">
          {fase.tipo === "escaneando" && (repetida ? "Es la entrada de recién: mostrá la siguiente." : "Apuntá al QR de la entrada.")}
        </p>
        {linterna !== null && camaraVisible && (
          <button
            type="button"
            onClick={cambiarLinterna}
            aria-pressed={linterna}
            className="min-h-12 shrink-0 rounded-xl border-2 border-white/70 px-4 font-semibold"
          >
            {linterna ? "Apagar linterna" : "Linterna"}
          </button>
        )}
      </div>

      <details className="rounded-2xl border border-white/20 p-4">
        <summary className="cursor-pointer py-2 font-semibold">¿No lee el QR? Escribí el código</summary>
        <form onSubmit={escribirCodigo} className="mt-3 flex flex-col gap-3">
          <label htmlFor="codigo-a-mano" className="text-sm text-white/80">
            El código que está abajo del QR (empieza con E1-). Si la entrada es válida, también queda usada.
          </label>
          <input
            id="codigo-a-mano"
            name="codigo"
            type="text"
            maxLength={120}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="E1-…"
            className="h-12 rounded-xl border border-white/40 bg-white px-4 font-mono text-sm text-tinta"
          />
          <button
            type="submit"
            disabled={fase.tipo === "verificando"}
            className="min-h-12 rounded-xl bg-white px-5 font-bold text-tinta disabled:opacity-60"
          >
            Verificar
          </button>
        </form>
      </details>

      {fase.tipo === "resultado" && <PantallaResultado resultado={fase.resultado} alSeguir={otraEntrada} />}
    </div>
  );
}

function Cartel({ children }: { children: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
      <p className="text-2xl font-bold">{children}</p>
    </div>
  );
}

// El resultado, en toda la pantalla: verde si pasa, rojo si no.
function PantallaResultado({ resultado, alSeguir }: { resultado: Resultado; alSeguir: () => void }) {
  const boton = useRef<HTMLButtonElement>(null);
  // Un toque justo cuando aparece (que era para otra cosa) no lo cierra.
  const [listo, setListo] = useState(false);
  useEffect(() => {
    const espera = setTimeout(() => setListo(true), 600);
    return () => clearTimeout(espera);
  }, []);
  useEffect(() => {
    if (listo) boton.current?.focus();
  }, [listo]);

  const pasa = "resultado" in resultado && resultado.resultado === "pasa";
  const titulo = "error" in resultado ? "NO VÁLIDA" : { pasa: "PASA", ya_ingreso: "YA INGRESÓ", no_valida: "NO VÁLIDA" }[resultado.resultado];

  let detalle: string | null = null;
  if ("error" in resultado) detalle = ERRORES[resultado.error];
  else if (resultado.resultado === "no_valida") detalle = MOTIVOS[resultado.motivo];
  else if (resultado.resultado === "ya_ingreso") {
    const quien = resultado.por === "vos" ? "la escaneaste vos" : resultado.por ? `la escaneó ${resultado.por}` : null;
    detalle = ["Entró", resultado.entro].filter(Boolean).join(" ") + (quien ? ` · ${quien}` : "") + ".";
  }
  const persona = "resultado" in resultado ? resultado.persona : undefined;

  return (
    <div
      role="alert"
      className={`fixed inset-0 z-50 flex flex-col overflow-y-auto text-white ${pasa ? "bg-ok" : "bg-error"}`}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 pt-10 pb-4">
        <p className="flex items-center gap-3 font-display text-6xl font-extrabold">
          <span aria-hidden="true">{pasa ? "✓" : "✕"}</span>
          {titulo}
        </p>
        {detalle && <p className="text-2xl font-semibold">{detalle}</p>}
        {persona && <DatosPersona persona={persona} grande={pasa} />}
      </div>
      <div className="sticky bottom-0 mx-auto w-full max-w-md px-5 pt-2 pb-6">
        {"error" in resultado && resultado.error === "sesion" ? (
          <Link href="/ingresar" className="flex min-h-16 items-center justify-center rounded-2xl bg-white text-xl font-bold text-tinta">
            Ingresar
          </Link>
        ) : "error" in resultado && resultado.error === "evento" ? (
          <Link href="/validar" className="flex min-h-16 items-center justify-center rounded-2xl bg-white text-xl font-bold text-tinta">
            Elegir otro evento
          </Link>
        ) : (
          <button
            ref={boton}
            type="button"
            onClick={() => listo && alSeguir()}
            className="min-h-16 w-full rounded-2xl bg-white text-xl font-bold text-tinta"
          >
            Escanear otra entrada
          </button>
        )}
      </div>
    </div>
  );
}

function DatosPersona({ persona, grande }: { persona: PersonaPuerta; grande: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-black/20 p-4">
      <p className={`font-bold [overflow-wrap:anywhere] ${grande ? "text-3xl" : "text-2xl"}`}>
        {persona.titular ?? "Sin nombre todavía"}
      </p>
      {persona.dni && <p className={grande ? "text-3xl" : "text-2xl"}>DNI {persona.dni}</p>}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl">
        <span className="rounded-lg bg-white px-3 py-0.5 font-extrabold text-tinta uppercase">{persona.tipo}</span>
        <span className="text-white/90">Compra N° {persona.compra}</span>
      </p>
    </div>
  );
}

// ─── Servidor, cámara, sonido ────────────────────────────────────────────────

async function pedir(eventoId: string, codigo: string): Promise<Resultado> {
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), ESPERA_MS);
  try {
    const respuesta = await fetch("/api/puerta/escanear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventoId, codigo }),
      cache: "no-store",
      signal: control.signal,
    });
    const cuerpo: unknown = await respuesta.json();
    return comoResultado(respuesta.ok, cuerpo);
  } catch {
    return { error: "conexion" };
  } finally {
    clearTimeout(corte);
  }
}

// Solo se cree lo que tiene la forma esperada: cualquier otra cosa es NO VÁLIDA.
function comoResultado(ok: boolean, cuerpo: unknown): Resultado {
  if (typeof cuerpo !== "object" || cuerpo === null) return { error: "conexion" };
  if (ok && "resultado" in cuerpo && ["pasa", "ya_ingreso", "no_valida"].includes(String(cuerpo.resultado))) {
    return cuerpo as RespuestaPuerta;
  }
  if (!ok && "error" in cuerpo && String(cuerpo.error) in ERRORES) return cuerpo as ErrorPuerta;
  return { error: "conexion" };
}

type Detector = { detect(fuente: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type ClaseDetector = {
  new (opciones: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};

async function crearLector(): Promise<Lector> {
  const Clase = (window as unknown as { BarcodeDetector?: ClaseDetector }).BarcodeDetector;
  if (Clase) {
    try {
      if ((await Clase.getSupportedFormats()).includes("qr_code")) {
        const detector = new Clase({ formats: ["qr_code"] });
        return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
      }
    } catch {
      // sigue con jsQR
    }
  }
  const { default: jsQR } = await import("jsqr");
  const lienzo = document.createElement("canvas");
  const contexto = lienzo.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    if (!contexto || !video.videoWidth) return null;
    // El cuadrado del centro (donde está el recuadro), achicado.
    const lado = Math.min(video.videoWidth, video.videoHeight);
    const destino = Math.min(lado, LADO_JSQR);
    lienzo.width = destino;
    lienzo.height = destino;
    contexto.drawImage(video, (video.videoWidth - lado) / 2, (video.videoHeight - lado) / 2, lado, lado, 0, 0, destino, destino);
    const imagen = contexto.getImageData(0, 0, destino, destino);
    return jsQR(imagen.data, destino, destino, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

function motivoSinCamara(error: unknown) {
  const nombre = error instanceof DOMException ? error.name : "";
  if (nombre === "NotAllowedError") {
    return "No hay permiso para usar la cámara. Tocá el candado (o «aA») al lado de la dirección, permití la cámara y probá de nuevo.";
  }
  if (nombre === "NotFoundError" || nombre === "OverconstrainedError") return "No encontramos una cámara en este dispositivo.";
  return "No se pudo abrir la cámara. Cerrá otras apps que la estén usando y probá de nuevo.";
}

// Que la pantalla no se apague mientras se escanea (si el celu lo permite).
async function pedirPantallaPrendida() {
  try {
    const wakeLock = (navigator as unknown as { wakeLock?: { request(tipo: "screen"): Promise<{ release(): Promise<void> }> } })
      .wakeLock;
    return (await wakeLock?.request("screen")) ?? null;
  } catch {
    return null;
  }
}

function crearSonido() {
  try {
    return new AudioContext();
  } catch {
    return null;
  }
}

// Un pitido corto y agudo si pasa; uno largo y grave si no. Y vibra (en Android).
function avisar(contexto: AudioContext | null, resultado: Resultado) {
  const pasa = "resultado" in resultado && resultado.resultado === "pasa";
  try {
    navigator.vibrate?.(pasa ? 80 : [250, 100, 250]);
  } catch {
    // sin vibración
  }
  if (!contexto) return;
  try {
    const oscilador = contexto.createOscillator();
    const volumen = contexto.createGain();
    oscilador.type = pasa ? "sine" : "square";
    oscilador.frequency.value = pasa ? 1_200 : 220;
    volumen.gain.value = 0.2;
    oscilador.connect(volumen).connect(contexto.destination);
    oscilador.start();
    oscilador.stop(contexto.currentTime + (pasa ? 0.15 : 0.5));
  } catch {
    // sin sonido
  }
}
