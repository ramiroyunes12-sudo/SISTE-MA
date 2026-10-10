"use client";

// El escáner de la puerta. La cámara trasera lee el QR y el código va al
// servidor (/api/puerta/escanear), que decide: PASA (y la entrada queda
// usada), YA INGRESÓ o NO VÁLIDA. Acá no se decide nada: ante cualquier error
// (sin señal, respuesta rara) se muestra NO VÁLIDA, nunca PASA.
//
// Leer el QR: en Android (Chrome) con el lector del navegador
// (BarcodeDetector); en iPhone no existe, así que con jsQR, que mira la imagen
// de la cámara cuadro por cuadro (se baja al entrar, solo si hace falta). Los
// dos miran solo el cuadrado que se ve en pantalla: nunca se lee un QR que no
// se ve (el de la persona de atrás, la entrada de abajo en la misma pantalla),
// y con dos a la vista no se lee ninguno.
import { type FormEvent, type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { bloqueaRepetir, leerRespuestaPuerta } from "@/lib/entradas/puerta";

import { pedirPuerta } from "./pedir";
import { PantallaResultado, type Resultado } from "./resultado";

type Fase =
  | { tipo: "inicio"; aviso?: string }
  | { tipo: "abriendo" }
  | { tipo: "escaneando" }
  | { tipo: "sin_camara"; motivo: string }
  | { tipo: "verificando" }
  | { tipo: "resultado"; resultado: Resultado };
type Lector = (video: HTMLVideoElement) => Promise<string | null>;

const ENTRE_CUADROS_MS = 100;
const MISMA_ENTRADA_MS = 10_000; // la entrada de recién, todavía delante de la cámara: no se vuelve a mandar
const LADO_JSQR = 640; // jsQR mira el cuadrado del centro achicado a esto (más rápido)
const LADO_NATIVO = 1_080; // el lector de Android, el mismo cuadrado casi sin achicar
const LARGO_ENVIADO = 200; // un QR que no es una entrada puede ser larguísimo: con esto el servidor ya dice que no lo es

// Lo que hacen las pestañas de la puerta al tocarlas: al ir a "Buscar", la
// cámara se apaga (batería); al volver, se prende sola si estaba prendida (el
// permiso ya está dado, y es en el toque: el iPhone deja sonar).
export type ControlEscaner = { pausar(): void; seguir(): void };

// alResultado: después de cada resultado (para poner al día el contador);
// alOcupado: mientras verifica un código (las pestañas no se pueden cambiar).
export function Escaner({
  eventoId,
  alResultado,
  alOcupado,
  ref,
}: {
  eventoId: string;
  alResultado: () => void;
  alOcupado: (ocupado: boolean) => void;
  ref?: Ref<ControlEscaner>;
}) {
  const [fase, setFase] = useState<Fase>({ tipo: "inicio" });
  const [repetida, setRepetida] = useState(false);
  const [linterna, setLinterna] = useState<boolean | null>(null); // null: el celu no tiene
  const videoRef = useRef<HTMLVideoElement>(null);
  const flujo = useRef<MediaStream | null>(null);
  const lector = useRef<Lector | null>(null);
  const sonido = useRef<AudioContext | null>(null);
  const pantalla = useRef<{ release(): Promise<void> } | null>(null);
  const quiereCamara = useRef(false);
  const pausada = useRef(false); // están en "Buscar": la cámara no se prende (leería QR escondida)
  const ultimo = useRef<string | null>(null);
  const reciente = useRef<{ texto: string; hasta: number } | null>(null);
  const apertura = useRef(0); // cuenta las aperturas de la cámara: detenerla deja vieja la que esté en curso

  const detenerCamara = useCallback(() => {
    apertura.current++;
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
      alOcupado(true);
      const resultado = await pedir(eventoId, codigo);
      avisar(sonido.current, resultado);
      setFase({ tipo: "resultado", resultado });
      alOcupado(false);
      alResultado();
    },
    [eventoId, alResultado, alOcupado],
  );

  async function abrirCamara() {
    if (pausada.current) {
      setFase({ tipo: "inicio", aviso: "La cámara se pausó." });
      return;
    }
    quiereCamara.current = true;
    sonido.current ??= crearSonido(); // en el toque: si no, el iPhone no lo deja sonar
    sonido.current?.resume().catch(() => {});
    if (!navigator.mediaDevices?.getUserMedia) {
      setFase({ tipo: "sin_camara", motivo: "Este navegador no deja usar la cámara. Abrí la página en Chrome o en Safari." });
      return;
    }
    detenerCamara();
    // Si mientras se abre la cámara se detiene (celu bloqueado, otra app),
    // esta apertura queda vieja: apaga lo suyo y no toca la pantalla (si no,
    // pisaba "La cámara se pausó" o el resultado de un código escrito a mano).
    const mia = apertura.current;
    const vieja = () => apertura.current !== mia;
    setFase({ tipo: "abriendo" });
    try {
      const nuevo = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (vieja()) {
        nuevo.getTracks().forEach((pista) => pista.stop());
        return;
      }
      flujo.current = nuevo;
      const video = videoRef.current!;
      video.srcObject = nuevo;
      await video.play();
      if (vieja()) return;
      lector.current ??= await crearLector();
      if (vieja()) return;
      const pista = nuevo.getVideoTracks()[0];
      setLinterna("torch" in (pista?.getCapabilities?.() ?? {}) ? false : null);
      pista?.addEventListener("ended", () => {
        if (flujo.current !== nuevo) return;
        detenerCamara();
        setFase((actual) => (actual.tipo === "escaneando" ? { tipo: "inicio", aviso: "Se cortó la cámara." } : actual));
      });
      const bloqueo = await pedirPantallaPrendida();
      if (vieja()) {
        bloqueo?.release().catch(() => {});
        return;
      }
      pantalla.current = bloqueo;
      // Si mientras abría se escribió un código a mano, queda su resultado.
      setFase((actual) => (actual.tipo === "abriendo" ? { tipo: "escaneando" } : actual));
    } catch (error) {
      if (vieja()) return;
      detenerCamara();
      const motivo = motivoSinCamara(error);
      setFase((actual) => (actual.tipo === "abriendo" ? { tipo: "sin_camara", motivo } : actual));
    }
  }

  async function otraEntrada() {
    const anterior = fase.tipo === "resultado" ? fase.resultado : null;
    reciente.current =
      ultimo.current && anterior && bloqueaRepetir(anterior) ? { texto: ultimo.current, hasta: Date.now() + MISMA_ENTRADA_MS } : null;
    setRepetida(false);
    sonido.current?.resume().catch(() => {}); // si el celu lo suspendió (una llamada), vuelve a sonar
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

  useImperativeHandle(ref, () => ({
    pausar() {
      pausada.current = true;
      detenerCamara();
      setFase((actual) =>
        actual.tipo === "escaneando" || actual.tipo === "abriendo" ? { tipo: "inicio", aviso: "La cámara se pausó." } : actual,
      );
    },
    seguir() {
      pausada.current = false;
      if (quiereCamara.current && fase.tipo === "inicio") abrirCamara();
    },
  }));

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

  // En iPhone el lector se baja al entrar, no al tocar "Abrir la cámara": con
  // mala señal tardaba segundos justo ahí.
  useEffect(() => {
    if (!("BarcodeDetector" in window)) import("jsqr").catch(() => {});
  }, []);

  // Con el celu bloqueado o en otra app, la cámara se apaga (batería), también
  // si se estaba abriendo; al volver, un toque la prende de nuevo.
  useEffect(() => {
    function alCambiar() {
      if (document.visibilityState !== "hidden") return;
      detenerCamara();
      setFase((actual) =>
        actual.tipo === "escaneando" || actual.tipo === "abriendo" ? { tipo: "inicio", aviso: "La cámara se pausó." } : actual,
      );
    }
    document.addEventListener("visibilitychange", alCambiar);
    const audio = sonido;
    return () => {
      document.removeEventListener("visibilitychange", alCambiar);
      detenerCamara();
      audio.current?.close().catch(() => {});
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
          {fase.tipo === "escaneando" &&
            (repetida
              ? "Es el mismo QR de recién. Si lo muestra otra persona, es una copia: no pasa."
              : "Apuntá al QR de la entrada.")}
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
        <summary className="cursor-pointer py-3 font-semibold">¿No lee el QR? Escribí el código</summary>
        {/* Por POST: si se manda antes de que cargue la página, el código no queda en la dirección. */}
        <form method="post" onSubmit={escribirCodigo} className="mt-3 flex flex-col gap-3">
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
            className="h-12 rounded-xl border border-white/40 bg-white px-4 font-mono text-base text-tinta"
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

// ─── Servidor, cámara, sonido ────────────────────────────────────────────────

async function pedir(eventoId: string, codigo: string): Promise<Resultado> {
  const respuesta = await pedirPuerta("/api/puerta/escanear", { eventoId, codigo: codigo.slice(0, LARGO_ENVIADO) });
  return respuesta ? leerRespuestaPuerta(respuesta.ok, respuesta.cuerpo) : { error: "conexion" };
}

type Detector = { detect(fuente: HTMLCanvasElement): Promise<{ rawValue: string }[]> };
type ClaseDetector = {
  new (opciones: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};

// No se pudo bajar jsQR (sin señal): es otro problema que el de la cámara.
class SinLector extends Error {}

async function crearLector(): Promise<Lector> {
  const lienzo = document.createElement("canvas");
  const contexto = lienzo.getContext("2d", { willReadFrequently: true });
  // Copia en el lienzo el cuadrado del centro del cuadro de la cámara, que es
  // lo que se ve en pantalla (el video está recortado así, con object-cover),
  // achicado a `maximo`. Devuelve el lado (0 si todavía no hay imagen).
  function recortar(video: HTMLVideoElement, maximo: number) {
    if (!contexto || !video.videoWidth) return 0;
    const lado = Math.min(video.videoWidth, video.videoHeight);
    const destino = Math.min(lado, maximo);
    lienzo.width = destino;
    lienzo.height = destino;
    contexto.drawImage(video, (video.videoWidth - lado) / 2, (video.videoHeight - lado) / 2, lado, lado, 0, 0, destino, destino);
    return destino;
  }

  const Clase = (window as unknown as { BarcodeDetector?: ClaseDetector }).BarcodeDetector;
  if (Clase) {
    try {
      if ((await Clase.getSupportedFormats()).includes("qr_code")) {
        const detector = new Clase({ formats: ["qr_code"] });
        return async (video) => {
          if (!recortar(video, LADO_NATIVO)) return null;
          const codigos = await detector.detect(lienzo);
          return codigos.length === 1 ? codigos[0].rawValue : null;
        };
      }
    } catch {
      // sigue con jsQR
    }
  }
  const { default: jsQR } = await import("jsqr").catch(() => {
    throw new SinLector();
  });
  return async (video) => {
    const destino = recortar(video, LADO_JSQR);
    if (!destino || !contexto) return null;
    const imagen = contexto.getImageData(0, 0, destino, destino);
    return jsQR(imagen.data, destino, destino, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

function motivoSinCamara(error: unknown) {
  if (error instanceof SinLector) {
    return "No se pudo cargar el lector de QR (¿sin señal?). Probá de nuevo o escribí el código abajo.";
  }
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
