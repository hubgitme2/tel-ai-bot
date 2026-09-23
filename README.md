# ربات هوش مصنوعی تلگرام (Cloudflare Workers)

ربات تلگرامی با قابلیت انتخاب مدل چت، تشخیص گفتار (Whisper) و ساخت تصویر (FLUX)، روی Cloudflare Workers.

## دیپلوی با یک کلیک

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hhdoust2/AICloudflareTLGbot)
> 

هنگام کلیک روی دکمه:
- یک namespace جدید از **Workers KV** (برای تاریخچهٔ چت و مدل انتخابی هر کاربر) خودکار ساخته می‌شود.
- اتصال به **Workers AI** خودکار برقرار می‌شود.
- فقط `BOT_TOKEN` از شما پرسیده می‌شود.

> ℹ️ چهار متغیر اختیاری دیگه (`TAVILY_API_KEY`, `ALLOWED_USER_IDS`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`) عمداً توی صفحهٔ دیپلوی نیستن — چون دکمهٔ Deploy کلادفلر فعلاً هر فیلدی که ببینه رو الزامی می‌کنه و راهی برای «اختیاری» نشونش دادن نداره. اگه اونا رو هم توی `wrangler.jsonc` می‌ذاشتیم، مجبور می‌شدی همه رو پر کنی. به‌جاش، بعد از دیپلوی اول، هر کدوم رو خواستی از داشبورد اضافه می‌کنی (مرحلهٔ ۷ پایین).

## مراحل کامل راه‌اندازی
ساخت حساب در cloudflare.com

ساخت حساب github.com 


1. یک ریپوی جدید و **عمومی (public)** در گیت‌هاب بساز.
4. حالا روی دکمهٔ «Deploy to Cloudflare» بالا (یا داخل ریپوی گیت‌هابت) کلیک کن.
5. وارد اکانت Cloudflare‌ت شو، مقدار `BOT_TOKEN` رو وارد کن، و روی Deploy بزن.
6. بعد از اتمام دیپلوی، آدرس Worker رو (چیزی شبیه `https://tel-ai-bot.<account>.workers.dev`) به‌عنوان Webhook تلگرام ثبت کن:

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<آدرس Worker شما>
```

همین! از این به بعد هر آپدیتی که تلگرام بفرسته مستقیم به Worker می‌رسه.

7. **(اختیاری) فعال کردن قابلیت‌های بیشتر:** برو به Cloudflare Dashboard → Workers & Pages → Worker خودت → Settings → Variables and Secrets → Add، و هر کدوم از این‌ها رو خواستی اضافه کن (بعد از هر بار افزودن، دکمهٔ Deploy همون‌جا رو بزن تا اعمال بشه):
   - `TAVILY_API_KEY` — فعال کردن جستجوی زنده در وب
   - `ALLOWED_USER_IDS` — محدود کردن ربات به شناسه‌های تلگرام مشخص (با کاما جدا کن)
   - `CF_ACCOUNT_ID` و `CF_API_TOKEN` (هر دو با هم) — نمایش مصرف روزانهٔ Neuron در `/start`

هیچ‌کدوم از این‌ها اجباری نیست؛ اگه خالی بمونن، ربات فقط همون قابلیت مربوطه رو غیرفعال می‌کنه و بقیه‌اش عادی کار می‌کنه.

## نکتهٔ امنیتی

`BOT_TOKEN` فعلاً به‌صورت متغیر محیطی ساده (`vars`) ذخیره می‌شه تا در صفحهٔ دیپلوی قابل وارد کردن باشه. اگه می‌خوای مخفی‌تر باشه (به‌صورت secret واقعی)، بعد از دیپلوی اول می‌تونی با دستور زیر جایگزینش کنی:

```
wrangler secret put BOT_TOKEN
```
