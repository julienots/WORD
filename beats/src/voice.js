// .BEATS — Voix IA : clonage (ElevenLabs, clé perso) + transformateur de voix hors-ligne.
import { audioCtx } from './engine.js';
import { mono, pitchShift, medianPitch, makeBuffer } from './dsp.js';

const API = 'https://api.elevenlabs.io/v1';
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
export const getKey = () => LS('beats.xi.key') || '';
export const setKey = (k) => LS('beats.xi.key', k.trim());
export const myVoices = () => { try { return JSON.parse(LS('beats.voices') || '[]'); } catch { return []; } };
const saveVoices = (v) => LS('beats.voices', JSON.stringify(v));

async function call(path, init = {}) {
  const key = getKey();
  if (!key) throw new Error('Ajoute ta clé API ElevenLabs (onglet Voix IA › Réglages).');
  let r;
  try {
    r = await fetch(API + path, { ...init, headers: { 'xi-api-key': key, ...(init.headers || {}) } });
  } catch {
    throw new Error('Connexion impossible : vérifie Internet.');
  }
  if (!r.ok) {
    let msg = `Erreur ${r.status}`;
    try { const j = await r.json(); msg = j.detail?.message || j.detail?.status || (typeof j.detail === 'string' ? j.detail : msg); } catch {}
    if (r.status === 401) msg = 'Clé API invalide.';
    throw new Error(msg);
  }
  return r;
}

/** Clone a voice from one or several audio samples. */
export async function cloneVoice(name, files, { removeNoise = true, description = '' } = {}) {
  const fd = new FormData();
  fd.append('name', name);
  if (description) fd.append('description', description);
  fd.append('remove_background_noise', String(removeNoise));
  files.forEach((f, i) => fd.append('files', f, f.name || `sample-${i}.mp3`));
  const r = await call('/voices/add', { method: 'POST', body: fd });
  const { voice_id } = await r.json();
  const list = myVoices().filter((v) => v.id !== voice_id);
  list.unshift({ id: voice_id, name, created: Date.now() });
  saveVoices(list);
  return voice_id;
}
export async function syncVoices() {
  const r = await call('/voices');
  const j = await r.json();
  const list = (j.voices || []).filter((v) => v.category === 'cloned' || v.category === 'generated' || v.category === 'professional')
    .map((v) => ({ id: v.voice_id, name: v.name, created: 0 }));
  saveVoices(list);
  return list;
}
export async function deleteVoice(id) {
  await call(`/voices/${id}`, { method: 'DELETE' }).catch(() => {});
  saveVoices(myVoices().filter((v) => v.id !== id));
}

/** Text → speech in the cloned voice. Returns an mp3 Blob. */
export async function speak(voiceId, text, { model = 'eleven_multilingual_v2', stability = 0.45, similarity = 0.85, style = 0.2 } = {}) {
  const r = await call(`/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, voice_settings: { stability, similarity_boost: similarity, style, use_speaker_boost: true } }),
  });
  return r.blob();
}
/** Speech → speech: say / sing anything with your own voice, output in the cloned voice. */
export async function convert(voiceId, audioBlob, { stability = 0.5, similarity = 0.9, removeNoise = false } = {}) {
  const fd = new FormData();
  fd.append('audio', audioBlob, audioBlob.name || 'input.wav');
  fd.append('model_id', 'eleven_multilingual_sts_v2');
  fd.append('voice_settings', JSON.stringify({ stability, similarity_boost: similarity }));
  fd.append('remove_background_noise', String(removeNoise));
  const r = await call(`/speech-to-speech/${voiceId}?output_format=mp3_44100_128`, { method: 'POST', body: fd });
  return r.blob();
}

/* ---------- offline voice lab ---------- */
export const VOICE_FX = {
  match: 'Imiter la hauteur de la voix modèle',
  deep: 'Voix grave',
  high: 'Voix aiguë',
  chipmunk: 'Chipmunk',
  monster: 'Monstre',
  robot: 'Robot',
  radio: 'Radio / téléphone',
  hall: 'Grande salle (réverb)',
  double: 'Doublage chorale (x3 voix)',
};
export async function voiceFx(buffer, fx, { semis = 0, refPitch = 0 } = {}) {
  const c = audioCtx(), rate = buffer.sampleRate;
  const x = mono(buffer);
  let s = semis;
  if (fx === 'match') {
    const mine = medianPitch(x, rate);
    if (!mine || !refPitch) throw new Error('Impossible de détecter la hauteur de voix (fichier trop court ou silencieux).');
    s = 12 * Math.log2(refPitch / mine);
  }
  if (fx === 'deep') s = -5; if (fx === 'high') s = 5; if (fx === 'chipmunk') s = 9; if (fx === 'monster') s = -10;
  let y = Math.abs(s) > 0.05 ? pitchShift(x, Math.max(-14, Math.min(14, s)), rate) : x.slice();
  const len = y.length + (fx === 'hall' ? rate * 3 : 0);
  const oc = new OfflineAudioContext(2, len, rate);
  const src = oc.createBufferSource(); src.buffer = makeBuffer(oc, [y], rate);
  let node = src;
  if (fx === 'robot') {
    const ring = oc.createOscillator(); ring.frequency.value = 55; const g = oc.createGain(); g.gain.value = 0;
    ring.connect(g.gain); ring.start(); node.connect(g); node = g;
  }
  if (fx === 'radio') {
    const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 450;
    const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const ws = oc.createWaveShaper(); const cv = new Float32Array(512); for (let i = 0; i < 512; i++) cv[i] = Math.tanh(3 * (i / 256 - 1)); ws.curve = cv;
    node.connect(hp).connect(lp).connect(ws); node = ws;
  }
  const out = oc.createGain(); out.gain.value = fx === 'robot' ? 1.6 : 1;
  node.connect(out).connect(oc.destination);
  if (fx === 'hall') {
    const ir = oc.createBuffer(2, rate * 3, rate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5); }
    const cv = oc.createConvolver(); cv.buffer = ir; const g = oc.createGain(); g.gain.value = 0.4;
    out.connect(cv).connect(g).connect(oc.destination);
  }
  if (fx === 'double') {
    for (const [semi, delay, pan] of [[-0.12, 0.018, -0.7], [0.12, 0.027, 0.7]]) {
      const d = pitchShift(x, semi, rate);
      const s2 = oc.createBufferSource(); s2.buffer = makeBuffer(oc, [d], rate);
      const p = oc.createStereoPanner(); p.pan.value = pan; const g = oc.createGain(); g.gain.value = 0.55;
      s2.connect(g).connect(p).connect(oc.destination); s2.start(delay);
    }
  }
  src.start();
  return oc.startRendering();
}
export function pitchOf(buffer) { return medianPitch(mono(buffer), buffer.sampleRate); }
