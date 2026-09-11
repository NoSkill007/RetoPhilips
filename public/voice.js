/** @param {string} id */
function el(id) { const value = document.getElementById(id); if (!value) throw new Error(id); return value; }
/** @param {string} text @param {boolean} [error] */
function feedback(text, error = false) { const target = el('voice-feedback'); target.textContent = text; target.className = `hint ${error ? 'unavailable' : ''}`.trim(); }

/** @type {MediaStream | undefined} */
let stream;
/** @type {MediaRecorder | undefined} */
let recorder;
/** @type {BlobPart[]} */
let chunks = [];
/** @type {Blob | undefined} */
let wavBlob;

/** Downmixes to mono and encodes 16-bit PCM WAV — whisper.cpp decodes wav directly, sidestepping any
 * dependency on which container/codec the browser's MediaRecorder happened to produce.
 * @param {AudioBuffer} buffer */
function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const samples = buffer.length;
  /** @type {Float32Array} */
  let mono;
  if (channels === 1) mono = buffer.getChannelData(0);
  else {
    mono = new Float32Array(samples);
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < samples; i += 1) mono[i] += data[i] / channels;
    }
  }
  const bytes = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(bytes);
  /** @param {number} offset @param {string} text */
  const writeString = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  writeString(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); writeString(8, 'WAVE');
  writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeString(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) {
    const clamped = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

/** @param {{recording: boolean, hasRecording: boolean}} state */
function setButtons({ recording, hasRecording }) {
  const record = /** @type {HTMLButtonElement} */ (el('voice-record'));
  const stop = /** @type {HTMLButtonElement} */ (el('voice-stop'));
  const transcribe = /** @type {HTMLButtonElement} */ (el('voice-transcribe'));
  const discard = /** @type {HTMLButtonElement} */ (el('voice-discard'));
  record.disabled = recording || hasRecording;
  stop.disabled = !recording;
  transcribe.disabled = recording || !hasRecording;
  discard.disabled = recording || !hasRecording;
}

el('voice-record').addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = []; wavBlob = undefined;
    recorder = new MediaRecorder(stream);
    recorder.addEventListener('dataavailable', event => { if (event.data.size > 0) chunks.push(event.data); });
    recorder.start();
    setButtons({ recording: true, hasRecording: false });
    feedback('Grabando… nada sale de este equipo hasta que transcribas.');
  } catch {
    feedback('No se pudo acceder al micrófono. Revisa los permisos del navegador.', true);
  }
});

el('voice-stop').addEventListener('click', () => {
  if (!recorder) return;
  recorder.addEventListener('stop', async () => {
    stream?.getTracks().forEach(track => track.stop());
    try {
      const recordedBlob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
      const arrayBuffer = await recordedBlob.arrayBuffer();
      const AudioContextClass = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
      const audioContext = new AudioContextClass();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      wavBlob = encodeWav(decoded);
      await audioContext.close();
      const playback = /** @type {HTMLAudioElement} */ (el('voice-playback'));
      playback.src = URL.createObjectURL(wavBlob); playback.hidden = false;
      setButtons({ recording: false, hasRecording: true });
      feedback('Grabación lista. Revisa la reproducción y transcribe, o descarta e intenta de nuevo.');
    } catch {
      setButtons({ recording: false, hasRecording: false });
      feedback('No se pudo procesar la grabación. Intenta de nuevo.', true);
    }
  }, { once: true });
  recorder.stop();
});

el('voice-discard').addEventListener('click', () => {
  wavBlob = undefined; chunks = [];
  const playback = /** @type {HTMLAudioElement} */ (el('voice-playback'));
  playback.hidden = true; playback.removeAttribute('src');
  setButtons({ recording: false, hasRecording: false });
  feedback('Grabación descartada.');
});

el('voice-transcribe').addEventListener('click', async () => {
  if (!wavBlob) return;
  const button = /** @type {HTMLButtonElement} */ (el('voice-transcribe'));
  button.disabled = true;
  feedback('QVAC está transcribiendo tu dictado en esta computadora…');
  try {
    const language = /** @type {HTMLSelectElement} */ (el('voice-language')).value;
    const response = await fetch(`/api/transcriptions?language=${language}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wavBlob });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'No se pudo transcribir el audio.');
    const observation = /** @type {HTMLTextAreaElement} */ (el('observation'));
    observation.value = result.transcript;
    // Marks the capture channel as "voice" for as long as the text stays exactly what QVAC transcribed;
    // capture.js resets it back to "text" the moment the collaborator actually edits the box by hand.
    observation.dataset.source = 'voice';
    observation.dispatchEvent(new Event('input', { bubbles: true }));
    // Switches the wizard back to the "Escribir" tab so the collaborator lands directly on the
    // transcript to correct it, instead of staying on "Dictar" and having to find it themselves.
    window.dispatchEvent(new CustomEvent('sitesignal:capture-tab', { detail: 'write' }));
    observation.scrollIntoView({ behavior: 'smooth', block: 'center' });
    feedback(`Transcripción lista (${result.metadata.engine} · ${result.metadata.model} · ${(result.metadata.durationMs / 1000).toFixed(1)} s). Corrígela en el cuadro de texto antes de extraer.`);
  } catch (error) {
    feedback(error instanceof Error ? error.message : 'No se pudo transcribir. La grabación se conserva; puedes reintentar o escribir el relato manualmente.', true);
  } finally {
    button.disabled = false;
  }
});
