/**
 * Важное:
 * - Распознавание делаем НЕ “заготовками”, а через /api/transcribe (твой прокси).
 * - Из видео извлекаем аудио ffmpeg.wasm -> WAV 16kHz mono.
 * - Получаем сегменты (start/end/text) -> строим SRT.
 * - Burn-in: ffmpeg.wasm + subtitles filter -> output.mp4
 *
 * OpenAI Audio Transcriptions API поддерживает форматы и response_format, включая verbose_json/srt. :contentReference[oaicite:2]{index=2}
 */

const $ = (s) => document.querySelector(s);

const els = {
  video: $("#video"),
  file: $("#file"),
  generate: $("#generate"),
  clear: $("#clear"),
  langRu: $("#langRu"),
  langEn: $("#langEn"),
  model: $("#model"),
  fontSize: $("#fontSize"),
  fontSizeVal: $("#fontSizeVal"),
  yPos: $("#yPos"),
  yPosVal: $("#yPosVal"),
  fontFamily: $("#fontFamily"),
  status: $("#status"),
  progressBar: $("#progressBar"),
  downloadLink: $("#downloadLink"),
  previewSrt: $("#previewSrt"),
};

let ffmpeg = null;
let lastSrtText = "";

function setStatus(t, warn=false){ els.status.textContent = (warn ? "⚠ " : "") + t; }
function setProgress(p){ els.progressBar.style.width = `${Math.max(0,Math.min(100,p))}%`; }

function getLang(){ return els.langEn.checked ? "en" : "ru"; }

function resetDownload(){
  els.downloadLink.classList.add("disabled");
  els.downloadLink.href = "#";
}

els.file.addEventListener("change", () => {
  const f = els.file.files?.[0];
  if (!f) return;
  resetDownload();
  lastSrtText = "";
  els.video.src = URL.createObjectURL(f);
  els.video.load();
  setStatus("Видео загружено");
  setProgress(0);
});

els.clear.addEventListener("click", () => {
  resetDownload();
  lastSrtText = "";
  els.file.value = "";
  els.video.removeAttribute("src");
  els.video.load();
  setStatus("Очищено");
  setProgress(0);
});

els.fontSize.addEventListener("input", () => els.fontSizeVal.textContent = els.fontSize.value);
els.yPos.addEventListener("input", () => els.yPosVal.textContent = els.yPos.value);
els.fontSizeVal.textContent = els.fontSize.value;
els.yPosVal.textContent = els.yPos.value;

els.previewSrt.addEventListener("click", () => {
  if (!lastSrtText) return alert("SRT ещё не создан. Нажми генерацию.");
  const w = window.open("", "_blank");
  w.document.write(`<pre style="white-space:pre-wrap;font:14px/1.4 monospace;padding:16px">${escapeHtml(lastSrtText)}</pre>`);
  w.document.close();
});

function escapeHtml(s){
  return s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

async function ensureFfmpeg(){
  if (ffmpeg) return ffmpeg;

  // UMD сборка @ffmpeg/ffmpeg на window.FFmpeg
  const { createFFmpeg, fetchFile } = window.FFmpeg || {};
  if (!createFFmpeg || !fetchFile) {
    throw new Error("ffmpeg.wasm не загрузился. Проверь CDN/блокировщик.");
  }

  ffmpeg = createFFmpeg({
    log: false,
    corePath: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js",
  });

  setStatus("Загрузка ffmpeg.wasm...");
  setProgress(5);
  await ffmpeg.load();
  setStatus("ffmpeg.wasm готов");
  setProgress(10);

  // сохраним fetchFile для удобства
  ffmpeg._fetchFile = fetchFile;
  return ffmpeg;
}

/**
 * 1) Извлекаем WAV из видео
 */
async function extractWavFromVideo(videoFile){
  const ff = await ensureFfmpeg();
  setStatus("Извлекаю аудио из видео...");
  setProgress(15);

  const inName = "input" + getExt(videoFile.name);
  ff.FS("writeFile", inName, await ff._fetchFile(videoFile));

  // WAV 16kHz mono (хороший формат для STT)
  // -vn = без видео
  await ff.run(
    "-i", inName,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-f", "wav",
    "audio.wav"
  );

  const wavData = ff.FS("readFile", "audio.wav");
  setProgress(28);
  return new Blob([wavData.buffer], { type: "audio/wav" });
}

function getExt(name){
  const i = name.lastIndexOf(".");
  return i === -1 ? ".mp4" : name.slice(i).toLowerCase();
}

/**
 * 2) Отправляем WAV на твой прокси /api/transcribe
 * Ожидаемый ответ:
 * {
 *   segments: [{ start: number, end: number, text: string }, ...]
 * }
 */
async function transcribeViaProxy(wavBlob){
  setStatus("Распознаю речь (через /api/transcribe)...");
  setProgress(35);

  const form = new FormData();
  form.append("file", wavBlob, "audio.wav");
  form.append("language", getLang());          // "ru" | "en"
  form.append("model", els.model.value);       // whisper-1 / gpt-4o-mini-transcribe etc.
  form.append("response_format", "verbose_json");

  const res = await fetch("/api/transcribe", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Ошибка /api/transcribe: ${res.status} ${msg}`);
  }

  const data = await res.json();
  if (!data?.segments?.length) {
    throw new Error("Прокси не вернул segments. Проверь бэкенд.");
  }

  setProgress(55);
  return data.segments;
}

/**
 * 3) Сегменты -> SRT
 *
 * ---- ВАЖНЫЙ БЛОК: расчет таймингов показа фраз ----
 * start/end приходят от модели (Whisper/Transcribe) в секундах.
 * В SRT переводим в формат HH:MM:SS,mmm.
 * Каждая фраза показывается в интервале [start, end).
 */
function segmentsToSrt(segments){
  const lines = [];
  segments.forEach((seg, idx) => {
    const start = toSrtTime(seg.start);
    const end = toSrtTime(seg.end);
    const text = (seg.text || "").trim();
    if (!text) return;
    lines.push(String(idx + 1));
    lines.push(`${start} --> ${end}`);
    lines.push(text);
    lines.push("");
  });
  return lines.join("\n");
}

function toSrtTime(sec){
  const msTotal = Math.max(0, Math.round(sec * 1000));
  const ms = msTotal % 1000;
  const sTotal = (msTotal - ms) / 1000;
  const s = sTotal % 60;
  const mTotal = (sTotal - s) / 60;
  const m = mTotal % 60;
  const h = (mTotal - m) / 60;

  const pad = (n, w=2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms,3)}`;
}

/**
 * 4) Burn-in SRT в видео (вшиваем текст внутрь кадра)
 */
async function burnInSubtitles(videoFile, srtText){
  const ff = await ensureFfmpeg();

  setStatus("Готовлю SRT и вшиваю субтитры в видео...");
  setProgress(60);

  // заново пишем input, если очищали FS
  // (проще: очистим старые файлы и запишем заново)
  safeUnlink(ff, "input.mp4");
  safeUnlink(ff, "input.webm");
  safeUnlink(ff, "subs.srt");
  safeUnlink(ff, "out.mp4");

  const inName = "input" + getExt(videoFile.name);
  ff.FS("writeFile", inName, await ff._fetchFile(videoFile));
  ff.FS("writeFile", "subs.srt", new TextEncoder().encode(srtText));

  // Styling для ASS/SSA через force_style (libass).
  // FontName зависит от того, что есть внутри ffmpeg сборки; часто “Arial”.
  // Мы делаем универсально + размер/позицию:
  const fontSize = Number(els.fontSize.value);
  const yPct = Number(els.yPos.value);

  // Alignment: 2 = bottom-center. MarginV управляет отступом снизу.
  // Примерно переводим y% в MarginV (пиксели) от низа:
  // Чем меньше y%, тем выше текст -> меньше MarginV? (наоборот).
  // Для простоты: marginV = (100 - y%) * 6 (подстройка)
  const marginV = Math.round((100 - yPct) * 6);

  const fontName = els.fontFamily.value; // "Montserrat" / "Roboto" / "Open Sans"
  // libass внутри wasm может не иметь этих шрифтов; тогда будет fallback.
  const forceStyle =
    `FontName=${fontName},FontSize=${fontSize},` +
    `PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,` +
    `BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=${marginV}`;

  // Пробуем H.264 (если есть), иначе fallback на mpeg4.
  const commonArgs = [
    "-i", inName,
    "-vf", `subtitles=subs.srt:force_style='${forceStyle}'`,
    "-movflags", "+faststart",
    "out.mp4"
  ];

  // 1) Try libx264+aac (если сборка поддерживает)
  try {
    await ff.run(
      "-i", inName,
      "-vf", `subtitles=subs.srt:force_style='${forceStyle}'`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "out.mp4"
    );
  } catch (e) {
    // 2) fallback (почти всегда есть): mpeg4 + aac/pcm
    // да, качество хуже, но это всё равно MP4 контейнер и “вшитые” субтитры.
    console.warn("libx264 не доступен, fallback на mpeg4:", e);
    await ff.run(
      "-i", inName,
      "-vf", `subtitles=subs.srt:force_style='${forceStyle}'`,
      "-c:v", "mpeg4",
      "-q:v", "4",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "out.mp4"
    );
  }

  setProgress(92);

  const out = ff.FS("readFile", "out.mp4");
  const outBlob = new Blob([out.buffer], { type: "video/mp4" });

  setProgress(100);
  setStatus("Готово: MP4 с вшитыми субтитрами готов к скачиванию ✅");
  return outBlob;
}

function safeUnlink(ff, name){
  try { ff.FS("unlink", name); } catch {}
}

els.generate.addEventListener("click", async () => {
  try {
    resetDownload();
    const videoFile = els.file.files?.[0];
    if (!videoFile) {
      setStatus("Сначала выбери видео.", true);
      return;
    }

    // 0) (опционально) ограничение “до 1 минуты”
    if (els.video.duration && els.video.duration > 60.5) {
      setStatus("Видео длиннее 1 минуты — может быть медленно/дорого.", true);
    }

    // 1) audio from video
    const wav = await extractWavFromVideo(videoFile);

    // 2) transcribe via proxy
    const segments = await transcribeViaProxy(wav);

    // 3) segments -> SRT
    const srtText = segmentsToSrt(segments);
    lastSrtText = srtText;

    setStatus("Субтитры распознаны. Вшиваю в видео...");
    setProgress(58);

    // 4) burn-in -> mp4
    const outBlob = await burnInSubtitles(videoFile, srtText);

    // 5) download
    const url = URL.createObjectURL(outBlob);
    els.downloadLink.href = url;
    els.downloadLink.classList.remove("disabled");
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Ошибка", true);
    setProgress(0);
  }
});
