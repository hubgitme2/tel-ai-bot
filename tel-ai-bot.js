
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// 📋 لیست مدل‌های قابل انتخاب — دقیقاً همان مدل‌هایی که در تستر مرورگر شما تأیید شده کار می‌کنند
const MODELS = {
  llama33:  { label: "🦙 Llama 3.3 70B",            id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", type: "chat" },
  qwen:     { label: "🐉 Qwen3.8 27B",               id: "@cf/qwen/qwen3.8-27b", type: "chat" },
  glm:      { label: "✨ GLM-4.7 Flash",             id: "@cf/zai-org/glm-4.7-flash", type: "chat" },
  seaLion:  { label: "🌊 Gemma SEA-LION v4 27B",     id: "@cf/aisingapore/gemma-sea-lion-v4-27b-it", type: "chat" },
  gemma4:   { label: "💎 Gemma 4 26B",               id: "@cf/google/gemma-4-26b-a4b-it", type: "chat" },
  gptoss:   { label: "🧠 GPT-OSS 120B",              id: "@cf/openai/gpt-oss-120b", type: "chat" },
  image:    { label: "🎨 ساخت تصویر (FLUX)",         id: "@cf/black-forest-labs/flux-1-schnell", type: "image" }
};
const DEFAULT_MODEL_KEY = "llama33";
// مدل متنی که همیشه برای ترجمهٔ پرامپت فارسی به انگلیسی (قبل از ساخت تصویر) استفاده می‌شود
const TRANSLATE_MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const MAX_HISTORY = 6;

// تابع ارسال درخواست به تلگرام (برای هر متد: sendMessage, answerCallbackQuery, editMessageText و ...)
async function sendTelegram(token, method, payload) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
__name(sendTelegram, "sendTelegram");

// بررسی اینکه آیا کاربر در لیست سفید مجاز (ALLOWED_USER_IDS) هست یا نه.
// اگر این متغیر محیطی اصلاً تنظیم نشده باشد، ربات برای همه باز می‌ماند (سازگاری با نسخه قبلی).
function isAuthorized(env, userId) {
  if (!env.ALLOWED_USER_IDS) return true;
  const allowed = env.ALLOWED_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(String(userId));
}
__name(isAuthorized, "isAuthorized");

// اسکیپ کاراکترهای خاص HTML (ضروری برای parse_mode: "HTML" در تلگرام)
function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
__name(escapeHtml, "escapeHtml");

// تبدیل متن (فارسی + مارک‌داون سبک مدل‌ها) به HTML امن تلگرام
// بلاک‌های ```کد``` و اینلاین `کد` تبدیل به <pre>/<code> می‌شن تا با یک لمس قابل کپی باشن
function formatForTelegram(rawText) {
  const text = String(rawText);
  const blockParts = text.split(/```([\s\S]*?)```/g);
  let html = "";
  for (let i = 0; i < blockParts.length; i++) {
    if (i % 2 === 1) {
      // این بخش یک بلاک کد است؛ اگر خط اول فقط اسم زبان باشد حذفش می‌کنیم
      const code = blockParts[i].replace(/^[ \t]*[a-zA-Z0-9_+-]*\n/, "");
      html += `<pre><code>${escapeHtml(code)}</code></pre>`;
    } else {
      // داخل این بخش، تک‌بک‌تیک‌ها (اینلاین کد) را هم پردازش می‌کنیم
      const inlineParts = blockParts[i].split(/`([^`\n]+)`/g);
      for (let j = 0; j < inlineParts.length; j++) {
        html += j % 2 === 1 ? `<code>${escapeHtml(inlineParts[j])}</code>` : escapeHtml(inlineParts[j]);
      }
    }
  }
  return html;
}
__name(formatForTelegram, "formatForTelegram");

// تابع جستجوی زنده در وب با Tavily API
async function searchWeb(query, apiKey) {
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        search_depth: "basic",
        include_answer: false,
        max_results: 3
      })
    });
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      return data.results.map(r => `عنوان: ${r.title}\nمنبع: ${r.url}\nخلاصه: ${r.content}`).join("\n\n");
    }
    return "نتیجه‌ای در وب یافت نشد.";
  } catch (err) {
    return `خطا در جستجوی وب: ${err.message}`;
  }
}
__name(searchWeb, "searchWeb");

// خواندن مدل انتخابی کاربر از KV (اگر ذخیره نشده بود، مدل پیش‌فرض برگردانده می‌شود)
async function getUserModelKey(env, chatId) {
  if (!env.CHAT_HISTORY) return DEFAULT_MODEL_KEY;
  const saved = await env.CHAT_HISTORY.get(`model_${chatId}`);
  if (saved && MODELS[saved]) return saved;
  return DEFAULT_MODEL_KEY;
}
__name(getUserModelKey, "getUserModelKey");

// 📊 دریافت مجموع نورون مصرف‌شده امروز (به وقت UTC) از GraphQL Analytics کلادفلر
// دیتاست: aiInferenceAdaptiveGroups — فیلد جمع‌شده: sum.totalNeurons
// (این اسم فیلد از خروجی واقعی introspection روی همین حساب تأیید شده، نه حدس)
async function getNeuronUsage(env) {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return null;

  const todayUtc = new Date().toISOString().slice(0, 10); // YYYY-MM-DD به وقت UTC

  const query = `
    query GetTodayNeurons($accountTag: string!, $today: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          aiInferenceAdaptiveGroups(filter: { date: $today }, limit: 1000) {
            sum { totalNeurons }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.CF_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        variables: { accountTag: env.CF_ACCOUNT_ID, today: todayUtc }
      })
    });
    const data = await res.json();
    if (!res.ok || data?.errors) {
      return { ok: false, raw: data };
    }
    const groups = data?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups || [];
    const consumed = groups.reduce((sum, g) => sum + (g?.sum?.totalNeurons || 0), 0);
    return { ok: true, consumed, date: todayUtc };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
__name(getNeuronUsage, "getNeuronUsage");

// ساخت متن قابل‌نمایش وضعیت نورون برای پیام /start
// نکته: سقف ۱۰هزارتایی، مقداریه که خود کلادفلر برای پلن Free اعمال می‌کنه؛ از هیچ API قابل استعلام نیست،
// برای همین به‌عنوان یه عدد ثابت شناخته‌شده نگه‌داشته شده، نه چیزی که از این کوئری اومده باشه.
function formatNeuronUsage(usage) {
  if (!usage) {
    return "⚠️ برای نمایش اعتبار نورون، متغیرهای <code>CF_ACCOUNT_ID</code> و <code>CF_API_TOKEN</code> رو در تنظیمات ورکر ست کن.";
  }
  if (!usage.ok) {
    const errText = usage.error || JSON.stringify(usage.raw).slice(0, 400);
    return `⚠️ گرفتن وضعیت نورون ناموفق بود:\n<pre><code>${escapeHtml(errText)}</code></pre>`;
  }

  const FREE_DAILY_LIMIT = 10000;
  const consumed = usage.consumed;
  const remaining = Math.max(FREE_DAILY_LIMIT - consumed, 0);

  return [
    "📊 <b>وضعیت مصرف Neuron کلادفلر (امروز، به وقت UTC)</b>",
    `🔸 مصرف‌شده: <b>${consumed.toFixed(0)}</b>`,
    `🔸 سقف رایگان روزانه: <b>${FREE_DAILY_LIMIT}</b>`,
    `🔸 باقیمانده (اگه پلن Free داری): <b>${remaining.toFixed(0)}</b>`,
    "🔸 ریست: هر روز ساعت ۰۰:۰۰ به وقت UTC",
    "",
    "ℹ️ اگه پلن Workers Paid داری، بعد از این سقف هم مصرفت ادامه پیدا می‌کنه ولی جداگانه هزینه‌اش حساب می‌شه."
  ].join("\n");
}
__name(formatNeuronUsage, "formatNeuronUsage");

// تبدیل ArrayBuffer به Base64 به‌صورت تکه‌تکه (برای جلوگیری از خطای call stack روی فایل‌های بزرگ)
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000; // 32KB
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
__name(arrayBufferToBase64, "arrayBufferToBase64");

// دانلود پیام صوتی تلگرام (voice/audio) و تشخیص گفتار با مدل Whisper کلادفلر
async function transcribeVoice(env, fileId) {
  // ۱. گرفتن مسیر فایل از تلگرام
  const fileInfoRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`);
  const fileInfo = await fileInfoRes.json();
  if (!fileInfo.ok) {
    throw new Error(fileInfo.description || "دریافت اطلاعات فایل صوتی از تلگرام ناموفق بود");
  }

  // ۲. دانلود بایت‌های فایل صوتی
  const audioRes = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fileInfo.result.file_path}`);
  if (!audioRes.ok) {
    throw new Error(`دانلود فایل صوتی از تلگرام ناموفق بود (${audioRes.status})`);
  }
  const audioBuffer = await audioRes.arrayBuffer();
  const base64Audio = arrayBufferToBase64(audioBuffer);

  // ۳. اجرای مدل Whisper (ورودی باید base64 باشد، طبق مستندات کلادفلر)
  const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
    audio: base64Audio
  });

  return (result?.text || "").trim() || null;
}
__name(transcribeVoice, "transcribeVoice");

// تشخیص اینکه متن حاوی حروف فارسی/عربی هست یا نه
function isPersianText(text) {
  return /[\u0600-\u06FF]/.test(text);
}
__name(isPersianText, "isPersianText");

// ترجمهٔ پرامپت فارسی به یک پرامپت انگلیسی مناسب برای مدل FLUX
async function translatePromptToEnglish(env, text) {
  const translationResponse = await env.AI.run(TRANSLATE_MODEL_ID, {
    messages: [
      { role: "system", content: "Translate the user's Persian prompt into a detailed, high-quality English prompt suitable for FLUX image generation. Return ONLY the translated English prompt, with no explanations, notes, quotes, or extra text." },
      { role: "user", content: text }
    ]
  });
  let out = (translationResponse?.response || translationResponse?.text || text).trim();
  // حذف نقل‌قول یا پیشوندهایی که گاهی مدل اضافه می‌کند
  out = out.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  return out || text;
}
__name(translatePromptToEnglish, "translatePromptToEnglish");

// ساخت تصویر با مدل FLUX و تبدیل خروجی base64 به بایت‌های تصویر
async function generateImage(env, prompt) {
  const response = await env.AI.run(MODELS.image.id, { prompt });
  if (!response?.image) {
    throw new Error("مدل تصویری خروجی معتبری برنگرداند.");
  }
  const binaryString = atob(response.image);
  return Uint8Array.from(binaryString, (m) => m.codePointAt(0));
}
__name(generateImage, "generateImage");

// ارسال عکس به تلگرام به‌صورت multipart/form-data
async function sendTelegramPhoto(token, chatId, imageBytes, caption) {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  if (caption) formData.append("caption", caption.slice(0, 1000));
  const blob = new Blob([imageBytes], { type: "image/jpeg" });
  formData.append("photo", blob, "image.jpg");
  return fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: formData });
}
__name(sendTelegramPhoto, "sendTelegramPhoto");

// ساخت دکمه‌های شیشه‌ای انتخاب مدل برای تلگرام
function buildModelKeyboard(currentKey) {
  const rows = Object.entries(MODELS).map(([key, m]) => {
    const prefix = key === currentKey ? "✅ " : "";
    return [{ text: `${prefix}${m.label}`, callback_data: `setmodel:${key}` }];
  });
  return { inline_keyboard: rows };
}
__name(buildModelKeyboard, "buildModelKeyboard");

// پردازش فشردن دکمه‌های انتخاب مدل (callback_query)
async function handleCallbackQuery(env, callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data || "";

  if (data.startsWith("setmodel:")) {
    const key = data.split(":")[1];
    if (MODELS[key]) {
      if (env.CHAT_HISTORY) {
        await env.CHAT_HISTORY.put(`model_${chatId}`, key);
      }
      await sendTelegram(env.BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: callbackQuery.id,
        text: `مدل «${MODELS[key].label}» انتخاب شد ✅`
      });
      await sendTelegram(env.BOT_TOKEN, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: `مدل فعلی شما: <b>${escapeHtml(MODELS[key].label)}</b>\nشناسه: <code>${escapeHtml(MODELS[key].id)}</code>\n\nبرای تغییر دوباره، از دستور /model استفاده کن.`,
        parse_mode: "HTML",
        reply_markup: buildModelKeyboard(key)
      });
      return;
    }
  }

  // callback ناشناخته
  await sendTelegram(env.BOT_TOKEN, "answerCallbackQuery", { callback_query_id: callbackQuery.id });
}
__name(handleCallbackQuery, "handleCallbackQuery");

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Telegram Bot AI Server is running!", { status: 200 });
    }

    let chatId = null;
    try {
      const update = await request.json();

      // 🔒 بررسی مجاز بودن کاربر — قبل از هر پردازش دیگری
      const incomingUserId = update?.message?.from?.id ?? update?.callback_query?.from?.id ?? null;
      if (!isAuthorized(env, incomingUserId)) {
        if (update?.callback_query) {
          await sendTelegram(env.BOT_TOKEN, "answerCallbackQuery", {
            callback_query_id: update.callback_query.id,
            text: "⛔ شما اجازه استفاده از این ربات را ندارید.",
            show_alert: true
          });
        } else if (update?.message) {
          await sendTelegram(env.BOT_TOKEN, "sendMessage", {
            chat_id: update.message.chat.id,
            text: "⛔ این ربات خصوصی است و فقط برای کاربران مجاز در دسترس است."
          });
        }
        return new Response("OK", { status: 200 });
      }

      // 🔘 فشردن یکی از دکمه‌های شیشه‌ای (مثلاً انتخاب مدل)
      if (update?.callback_query) {
        await handleCallbackQuery(env, update.callback_query);
        return new Response("OK", { status: 200 });
      }

      if (!update?.message) {
        return new Response("OK", { status: 200 });
      }

      chatId = update.message.chat.id;
      let text = null;

      // 🎙 پیام صوتی یا فایل صوتی: اول تبدیل به متن، بعد مثل یک پیام متنی عادی پردازش می‌شود
      const voiceObj = update.message.voice || update.message.audio;
      if (voiceObj) {
        await sendTelegram(env.BOT_TOKEN, "sendChatAction", { chat_id: chatId, action: "typing" });
        try {
          text = await transcribeVoice(env, voiceObj.file_id);
        } catch (voiceErr) {
          await sendTelegram(env.BOT_TOKEN, "sendMessage", {
            chat_id: chatId,
            text: `🚨 تشخیص گفتار ناموفق بود:\n<pre><code>${escapeHtml(voiceErr.message)}</code></pre>`,
            parse_mode: "HTML"
          });
          return new Response("OK", { status: 200 });
        }

        if (!text) {
          await sendTelegram(env.BOT_TOKEN, "sendMessage", {
            chat_id: chatId,
            text: "🎙 متوجه نشدم چی گفتی؛ صدا واضح نبود یا حرفی توش شناسایی نشد."
          });
          return new Response("OK", { status: 200 });
        }

        // نمایش متن شناسایی‌شده به کاربر برای شفافیت (و قابل کپی بودن)
        await sendTelegram(env.BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `🎙 متن شناسایی‌شده:\n<blockquote>${escapeHtml(text)}</blockquote>`,
          parse_mode: "HTML"
        });
      } else if (update.message.text) {
        text = update.message.text.trim();
      } else {
        // نوع پیام پشتیبانی‌نشده (عکس، استیکر و ...)
        return new Response("OK", { status: 200 });
      }

      // 🧭 دستور نمایش/تغییر مدل
      if (text === "/model" || text === "/models") {
        const currentKey = await getUserModelKey(env, chatId);
        await sendTelegram(env.BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `مدل فعلی شما: <b>${escapeHtml(MODELS[currentKey].label)}</b>\nشناسه: <code>${escapeHtml(MODELS[currentKey].id)}</code>\n\nیکی از مدل‌های زیر رو انتخاب کن:`,
          parse_mode: "HTML",
          reply_markup: buildModelKeyboard(currentKey)
        });
        return new Response("OK", { status: 200 });
      }

      // 🧭 دستور شروع
      if (text === "/start") {
        const currentKey = await getUserModelKey(env, chatId);
        const neuronUsage = await getNeuronUsage(env);
        const neuronText = formatNeuronUsage(neuronUsage);
        await sendTelegram(env.BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `سلام! من دستیار هوشمند شما هستم 🤖\n\n${neuronText}\n\nمدل فعلی: <b>${escapeHtml(MODELS[currentKey].label)}</b>\n\nهر سوالی داری بپرس. برای تغییر مدل هوش مصنوعی، دستور /model رو بفرست.`,
          parse_mode: "HTML"
        });
        return new Response("OK", { status: 200 });
      }

      // ارسال وضعیت typing به تلگرام
      await sendTelegram(env.BOT_TOKEN, "sendChatAction", { chat_id: chatId, action: "typing" });

      // مدل انتخابی همین کاربر
      const modelKey = await getUserModelKey(env, chatId);
      const MODEL_ID = MODELS[modelKey].id;

      // 🎨 اگر کاربر گزینهٔ «ساخت تصویر» رو انتخاب کرده، مسیر کاملاً جدا از چت متنی طی می‌شود
      if (MODELS[modelKey].type === "image") {
        await sendTelegram(env.BOT_TOKEN, "sendChatAction", { chat_id: chatId, action: "upload_photo" });
        try {
          const persian = isPersianText(text);
          const englishPrompt = persian ? await translatePromptToEnglish(env, text) : text;
          const imgBytes = await generateImage(env, englishPrompt);

          const captionLines = [`🎨 پرامپت: ${text}`];
          if (persian) captionLines.push(`🔤 ترجمه: ${englishPrompt}`);

          await sendTelegramPhoto(env.BOT_TOKEN, chatId, imgBytes, captionLines.join("\n"));
        } catch (imgErr) {
          await sendTelegram(env.BOT_TOKEN, "sendMessage", {
            chat_id: chatId,
            text: `🚨 ساخت تصویر ناموفق بود:\n<pre><code>${escapeHtml(imgErr.message)}</code></pre>`,
            parse_mode: "HTML"
          });
        }
        return new Response("OK", { status: 200 });
      }

      // 🕒 محاسبه دقیق‌ترین ساعت و تاریخ زنده به وقت تهران (برای حل مشکل قفل زمانی کلاودفلر)
      const now = new Date();
      const timeOptions = { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false };
      const dateOptions = { timeZone: 'Asia/Tehran', calendar: 'persian', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

      const currentTimeIran = now.toLocaleTimeString('fa-IR', timeOptions);
      const currentDateIran = now.toLocaleDateString('fa-IR', dateOptions);

      // انجام سرچ زنده در اینترنت
      let webResults = "کاربر سوالی نپرسیده که نیاز به سرچ داشته باشد.";
      if (env.TAVILY_API_KEY) {
        webResults = await searchWeb(text, env.TAVILY_API_KEY);
      }

      // ساخت پرامپت سیستم پویا و تزریق ساعت زنده ایران + اطلاعات وب
      const dynamicSystemPrompt = `تو یک دستیار هوشمند بسیار صمیمی، دانا و متصل به اینترنت زنده هستی.
پاسخ کاربران را کاملاً به زبان فارسی روان، جذاب و شیک بده.

[اطلاعات زمانی دقیق و زنده سیستم]:
- امروز: ${currentDateIran}
- ساعت دقیق هم‌اکنون در ایران (تهران): ساعت ${currentTimeIran}

تو به زمان زنده کاملاً دسترسی داری. مبنای ساعت تو دقیقاً ساعت ${currentTimeIran} است. اگر کاربر ساعت را پرسید، دقیقاً همین ساعت را اعلام کن. نیازی به محاسبات ذهنی یا تبدیل UTC نداری.

[اطلاعات زنده دریافت شده از اینترنت درباره سوال کاربر]:
\"\"\"
${webResults}
\"\"\"

وظیفه تو: با استفاده از اطلاعات زنده بالا و زمان دقیق ایران، پاسخ کاربر را بنویس.`;

      // بازیابی تاریخچه چت از حافظه KV
      let history = [];
      if (env.CHAT_HISTORY) {
        const savedHistory = await env.CHAT_HISTORY.get(`chat_${chatId}`);
        if (savedHistory) {
          history = JSON.parse(savedHistory);
        }
      }

      // اضافه کردن پیام جدید کاربر به تاریخچه
      history.push({ role: "user", content: text });

      // ترکیب پرامپت سیستم با کل تاریخچه چت
      const messages = [
        { role: "system", content: dynamicSystemPrompt },
        ...history
      ];

      // اجرای هوش مصنوعی کلادفلر با مدل انتخابی کاربر
      let aiResponse;
      try {
        aiResponse = await env.AI.run(MODEL_ID, {
          messages: messages,
          max_tokens: 1024,
          stream: false
        });
      } catch (aiErr) {
        // خطای مربوط به خود مدل (مثلاً مدل موجود نیست) را همراه با شناسه مدل گزارش می‌کنیم
        await sendTelegram(env.BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `🚨 مدل «${escapeHtml(MODELS[modelKey].label)}» (<code>${escapeHtml(MODEL_ID)}</code>) در دسترس نیست یا خطا داد:\n<pre><code>${escapeHtml(aiErr.message)}</code></pre>\n\nبا /model یه مدل دیگه انتخاب کن.`,
          parse_mode: "HTML"
        });
        return new Response("OK", { status: 200 });
      }

      // پشتیبانی از فرمت‌های مختلف خروجی مدل‌ها (دقیقاً مطابق منطق تستر مرورگر)
      let aiText = aiResponse?.response || aiResponse?.text || null;

      // برخی مدل‌های جدیدتر (مثل gemma-sea-lion، gpt-oss) فرمت OpenAI-compatible برمی‌گردونن
      if (!aiText && aiResponse?.choices && aiResponse.choices[0]) {
        aiText = aiResponse.choices[0].message?.content || aiResponse.choices[0].text || null;
      }

      // مدل‌های reasoning ممکنه خروجی رو در reasoning_content بدن
      if (!aiText && aiResponse?.reasoning_content) {
        aiText = aiResponse.reasoning_content;
      }

      if (!aiText) {
        aiText = aiResponse?.result?.response || aiResponse?.output_text || null;
      }

      // ارسال پاسخ به تلگرام و ذخیره در حافظه KV
      if (aiText) {
        history.push({ role: "assistant", content: aiText.trim() });

        if (history.length > MAX_HISTORY * 2) {
          history = history.slice(-MAX_HISTORY * 2);
        }

        if (env.CHAT_HISTORY) {
          await env.CHAT_HISTORY.put(`chat_${chatId}`, JSON.stringify(history));
        }

        await sendTelegram(env.BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: formatForTelegram(aiText.trim()),
          parse_mode: "HTML"
        });
      } else {
        // برای عیب‌یابی، بخشی از خروجی خام مدل رو هم نشون می‌دیم تا بشه فرمت واقعی رو دید
        const rawPreview = JSON.stringify(aiResponse).slice(0, 500);
        await sendTelegram(env.BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `🤖 پاسخ خالی از مدل «${escapeHtml(MODELS[modelKey].label)}» دریافت شد.\n\nخروجی خام (برای عیب‌یابی):\n<pre><code>${escapeHtml(rawPreview)}</code></pre>`,
          parse_mode: "HTML"
        });
      }

      return new Response("OK", { status: 200 });

    } catch (error) {
      if (chatId) {
        await sendTelegram(env.BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `🚨 خطای سرور کلاودفلر:\n<pre><code>${escapeHtml(error.message)}</code></pre>`,
          parse_mode: "HTML"
        });
      }
      return new Response("OK", { status: 200 });
    }
  }
};
