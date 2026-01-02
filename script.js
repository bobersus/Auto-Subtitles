/**
 * Авто-субтитры (браузер).
 * Наложение текста поверх video через CSS overlay.
 * Тайминг: cues синхронизируются по video.currentTime.
 */

const $ = (sel) => document.querySelector(sel);

const els = {
  video: $("#video"),
  file: $("#file"),
  generate: $("#generate"),
  clear: $("#clear"),
  engine: $("#engine"),
  langRu: $("#langRu"),
  langEn: $("#langEn"),
  fontSize: $("#fontSize"),
  fontSizeVal: $("#fontSizeVal"),
  yPos: $("#yPos"),
  yPosVal: $("#yPosVal"),
  fontFamily: $("#fontFamily"),
  anim: $("#anim"),
  status: $("#status"),
  progressBar: $("#progressBar"),
  overlay: $("#subtitleOverlay"),
  subtitleText: $("#subtitleText"),
};

let cues = []; // [{ start:number, end:number, text:string }]
let rafId = null;

// ------------------------------
// Video Module
// ------------------------------
const VideoModule = (() => {
  function loadFile(file) {
    if (!file) return;
    if (file.size > 120 * 1024 * 1024) {
      // формально лимит "1 минута" — но размер зависит от битрейта;
      // здесь только мягкий предохранитель
      setStatus("Файл слишком большой. Рекомендуется до ~1 минуты.", true);
    }

    const url = URL.createObjectURL(file);
    els.video.src = url;
    els.video.load();

    els.subtitleText.textContent = "Нажмите “Сгенерировать субтитры”";
    setProgress(0);
    setStatus("Видео загружено");
  }

  function getCurrentTime() {
    return els.video.currentTime || 0;
  }

  function getDuration() {
    return els.video.duration || 0;
  }

  return { loadFile, getCurrentTime, getDuration };
})();

// ------------------------------
// Animation Controller
// ------------------------------
const AnimationController = (() => {
  function clearAnimationClasses() {
    els.subtitleText.classList.remove("typewriter");
    els.subtitleText.style.animation = "none";
    // форсим рефлоу, чтобы повторно запускать CSS-анимации
    void els.subtitleText.offsetWidth;
  }

  /**
   * Применяем анимацию появление к текущей фразе.
   * Для typewriter используем спец-класс и CSS-переменные.
   */
  function apply(animationName, text) {
    clearAnimationClasses();

    if (animationName === "typewriter") {
      // ширина будет "печатается" за счет width, поэтому ставим single-line
      // если нужна поддержка переносов — можно разбивать на строки/спаны.
      els.subtitleText.textContent = text;

      const steps = Math.max(6, Math.min(60, text.length));
      els.subtitleText.style.setProperty("--twSteps", String(steps));
      // Длительность зависит от длины текста (приятнее визуально)
      const dur = Math.max(0.8, Math.min(2.2, steps * 0.045));
      els.subtitleText.style.setProperty("--twDur", `${dur}s`);
      els.subtitleText.classList.add("typewriter");
      return;
    }

    // обычные анимации: fade/bounce/scale
    els.subtitleText.textContent = text;

    if (animationName === "fade") {
      els.subtitleText.style.animation = "cc-fade .28s ease-out both";
    } else if (animationName === "bounce") {
      els.subtitleText.style.animation = "cc-bounce .42s cubic-bezier(.2,.9,.2,1) both";
    } else if (animationName === "scale") {
      els.subtitleText.style.animation = "cc-scale .28s ease-out both";
    } else {
      // fallback
      els.subtitleText.style.animation = "cc-fade .28s ease-out both";
    }
  }

  return { apply };
})();

// ------------------------------
// Subtitle Renderer (sync with currentTime)
// ------------------------------
const SubtitleRenderer = (() => {
  let lastCueIndex = -1;

  function start() {
    stop();
    lastCueIndex = -1;

    const tick = () => {
      const t = VideoModule.getCurrentTime();
      const idx = findCueIndexAtTime(t);

      if (idx !== lastCueIndex) {
        lastCueIndex = idx;
        if (idx === -1) {
          els.subtitleText.textContent = "";
        } else {
          const cue = cues[idx];
          AnimationController.apply(els.anim.value, cue.text);
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function findCueIndexAtTime(t) {
    // простая линейная проверка (для 1 минуты и малого числа фраз — ок)
    for (let i = 0; i < cues.length; i++) {
      if (t >= cues[i].start && t < cues[i].end) return i;
    }
    return -1;
  }

  return { start, stop };
})();

// ------------------------------
// Recognition (Whisper / Transformers / Demo)
// ------------------------------
const Recognition = (() => {
  const OPENAI_API_KEY = "PASTE_YOUR_OPENAI_API_KEY_HERE"; // <-- заглушка

  function getSelectedLang() {
    return els.langEn.checked ? "en" : "ru";
  }

  async function generateSubtitles(file, engine) {
    if (!file) throw new Error("Сначала выберите видеофайл.");

    setProgress(8);
    setStatus("Подготовка...");

    // Важно: Whisper API нельзя безопасно вызывать напрямую из фронтенда,
    // иначе ключ будет украден. Нужен бэкенд/прокси.
    if (engine === "whisper") {
      return await whisperStub(file, getSelectedLang());
    }

    if (engine === "transformers") {
      return await transformersStub(file, getSelectedLang());
    }

    // demo
    return demoCues(getSelectedLang());
  }

  // ---- Whisper stub (псевдокод / заглушка) ----
  async function whisperStub(file, lang) {
    setStatus("Whisper: (заглушка) обычно нужен сервер-прокси", true);
    setProgress(18);

    /**
     * Псевдологика:
     * 1) извлечь аудио из видео (ffmpeg.wasm) или отправить видео целиком на сервер,
     * 2) на сервере дернуть OpenAI Audio Transcription (Whisper),
     * 3) получить segments с start/end/text.
     *
     * Здесь оставляем DEMO-результат, чтобы UI и тайминги работали.
     */
    await sleep(450);
    setProgress(55);
    await sleep(350);
    setProgress(100);

    return demoCues(lang);
  }

  // ---- Transformers.js stub (очень тяжело в браузере) ----
  async function transformersStub(file, lang) {
    setStatus("Transformers.js: (заглушка) модели тяжелые", true);
    setProgress(15);

    /**
     * Реальная реализация:
     * - извлечь аудио в PCM/WAV (ffmpeg.wasm),
     * - загрузить Transformers.js + модель ASR,
     * - прогнать распознавание,
     * - восстановить сегменты с таймингами.
     *
     * Для 1 минуты это всё равно может быть медленно и требовать много RAM.
     */
    await sleep(500);
    setProgress(65);
    await sleep(400);
    setProgress(100);

    return demoCues(lang);
  }

  function demoCues(lang) {
    // Небольшой набор сегментов для демонстрации синхронизации
    if (lang === "en") {
      return [
        { start: 0.20, end: 2.20, text: "Hi! This is an auto-subtitles demo." },
        { start: 2.20, end: 4.80, text: "Subtitles are synced with video.currentTime." },
        { start: 4.80, end: 7.20, text: "Try animations, font size, and Y position." },
      ];
    }
    return [
      { start: 0.20, end: 2.40, text: "Привет! Это демо авто-субтитров." },
      { start: 2.40, end: 5.00, text: "Синхронизация идёт по video.currentTime." },
      { start: 5.00, end: 7.60, text: "Проверь анимации, размер и позицию Y." },
    ];
  }

  return { generateSubtitles };
})();

// ------------------------------
// UI Bindings
// ------------------------------
function setStatus(text, warn = false) {
  els.status.textContent = warn ? `⚠ ${text}` : text;
}
function setProgress(percent) {
  els.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function applySubtitleStyle() {
  // Font size
  els.fontSizeVal.textContent = els.fontSize.value;
  els.subtitleText.style.fontSize = `${els.fontSize.value}px`;

  // Y position (%): двигаем padding-bottom через align-items flex-end + translateY
  // Проще: задаём нижний отступ контейнера через CSS переменную
  els.yPosVal.textContent = els.yPos.value;
  const yPercent = Number(els.yPos.value);

  // yPercent — это "где по вертикали текст"
  // 100% = низ, 50% = середина. Мы делаем translateY относительно низа.
  const translate = (100 - yPercent) * -1; // поднимаем вверх при уменьшении %
  els.subtitleText.style.transform = `translateY(${translate}vh)`; // простая модель

  // Font family
  els.subtitleText.style.fontFamily = els.fontFamily.value;
}

function clearAll() {
  cues = [];
  els.subtitleText.textContent = "";
  setProgress(0);
  setStatus("Очищено");
}

// ------------------------------
// Важный блок: расчет времени показа фраз
// ------------------------------
/**
 * Здесь предполагается, что распознавание (Whisper/Transformers) возвращает сегменты:
 *   segments = [{ start, end, text }, ...]
 * Мы кладём их в cues и на каждом кадре сравниваем:
 *   если (currentTime >= cue.start && currentTime < cue.end) => показываем cue.text
 *
 * Это и есть синхронизация субтитров с видео по времени.
 * Для более “умного” поведения можно:
 * - объединять короткие сегменты,
 * - добавлять небольшие буферы (например, end += 0.05),
 * - поддерживать переносы строк.
 */

// ------------------------------
// Events
// ------------------------------
els.file.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  VideoModule.loadFile(file);
});

els.fontSize.addEventListener("input", applySubtitleStyle);
els.yPos.addEventListener("input", applySubtitleStyle);
els.fontFamily.addEventListener("change", applySubtitleStyle);
els.anim.addEventListener("change", () => {
  // если субтитр сейчас отображается — перезапустить анимацию на текущем тексте
  const current = els.subtitleText.textContent || "";
  if (current.trim()) AnimationController.apply(els.anim.value, current);
});

els.generate.addEventListener("click", async () => {
  try {
    const file = els.file.files?.[0];
    if (!file) {
      setStatus("Сначала выберите видеофайл.", true);
      return;
    }

    setStatus("Генерация субтитров...");
    setProgress(2);

    const engine = els.engine.value;
    const result = await Recognition.generateSubtitles(file, engine);

    // применяем сегменты
    cues = result.slice().sort((a,b) => a.start - b.start);

    setStatus(`Готово: ${cues.length} фраз(ы)`);
    setProgress(100);

    // стартуем синхронизацию
    SubtitleRenderer.start();

    // применяем стили (на случай, если пользователь не трогал слайдеры)
    applySubtitleStyle();
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Ошибка генерации", true);
    setProgress(0);
  }
});

els.clear.addEventListener("click", () => {
  SubtitleRenderer.stop();
  clearAll();
});

// стартовые стили
applySubtitleStyle();
