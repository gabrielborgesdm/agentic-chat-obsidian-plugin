/**
 * Read-aloud via speechSynthesis (on-device system voices, works offline).
 * Voice input was removed: iOS does not grant speech recognition to Obsidian;
 * the keyboard's dictation key works instead.
 */

export const canSpeak = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window;

/** Removes Markdown/wikilink syntax so the voice does not read symbols aloud. */
export function plainForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " (code block) ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/[`*_#>~]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "auto"/"" → device language; otherwise the given BCP-47 tag. */
export function deviceLang(): string {
  return (typeof navigator !== "undefined" && navigator.language) || "en-US";
}

const PT = /\b(n[aã]o|voc[eê]|est[aá]|s[aã]o|para|uma|com|que|isso|nota|tamb[eé]m|mais|quando|onde|tem)\b|[ãõç]/gi;
const ES = /\b(est[aá]|usted|para|una|con|que|pero|tambi[eé]n|cuando|donde|tiene|nota|el|los|las)\b|[ñ¿¡]/gi;
const EN = /\b(the|and|you|is|are|this|that|with|for|have|what|your|note|it)\b/gi;

/** Picks a voice language from the text itself (pt / es / en), falling back to the device language. */
export function detectLang(text: string, preferred: string): string {
  if (preferred && preferred !== "auto") return preferred;
  const dev = deviceLang();
  const score = (re: RegExp) => (text.match(re) ?? []).length;
  const s = { pt: score(PT), es: score(ES), en: score(EN) };
  const best = (Object.keys(s) as (keyof typeof s)[]).sort((a, b) => s[b] - s[a])[0];
  if (s[best] < 2) return dev;
  if (dev.toLowerCase().startsWith(best)) return dev; // keep the device's regional variant
  return { pt: "pt-BR", es: "es-ES", en: "en-US" }[best];
}

let speakingListeners = new Set<() => void>();
export const onSpeakingChange = (cb: () => void) => {
  speakingListeners.add(cb);
  return () => speakingListeners.delete(cb);
};
const notify = () => speakingListeners.forEach((l) => l());

export const isSpeaking = (): boolean => canSpeak() && (window.speechSynthesis.speaking || window.speechSynthesis.pending);

export function stopSpeaking(): void {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  notify();
}

export function speak(markdown: string, preferredLang: string): void {
  if (!canSpeak()) return;
  const text = plainForSpeech(markdown);
  if (!text) return;
  const lang = detectLang(text, preferredLang);
  const synth = window.speechSynthesis;
  synth.cancel();
  // Long utterances can be cut off on iOS; speak in sentence-sized chunks.
  const chunks = text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text];
  const voices = synth.getVoices();
  const voice =
    voices.find((v) => v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase()) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)));
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c.trim());
    u.lang = lang;
    if (voice) u.voice = voice;
    if (i === chunks.length - 1) u.onend = notify;
    u.onerror = notify;
    synth.speak(u);
  });
  notify();
}

