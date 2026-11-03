// Sonido de avisos. Los navegadores solo dejan reproducir audio después de que
// el usuario hizo clic o tocó la pantalla al menos una vez, por eso el
// contexto de audio se "desbloquea" con el primer gesto.

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  return ctx;
}

/** Llamar dentro de un clic/toque. Devuelve true si el audio quedó activo. */
export async function unlockAudio(): Promise<boolean> {
  const audio = getContext();
  if (!audio) return false;
  if (audio.state === "suspended") {
    try {
      await audio.resume();
    } catch {
      return false;
    }
  }
  return audio.state === "running";
}

export function isAudioUnlocked(): boolean {
  return ctx?.state === "running";
}

function tone(audio: AudioContext, frequency: number, start: number, duration: number) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** Aviso de pedido nuevo: dos campanadas de tres notas. */
export function playOrderSound() {
  const audio = getContext();
  if (!audio || audio.state !== "running") return;
  const now = audio.currentTime;
  for (let round = 0; round < 2; round++) {
    const base = now + round * 0.9;
    tone(audio, 880, base, 0.25);
    tone(audio, 1109, base + 0.18, 0.25);
    tone(audio, 1319, base + 0.36, 0.4);
  }
}

/** Aviso corto (items nuevos en cocina). */
export function playBeep() {
  const audio = getContext();
  if (!audio || audio.state !== "running") return;
  tone(audio, 988, audio.currentTime, 0.25);
}