// Шаблоны писем Мультикнопки. HTML — табличная вёрстка с инлайн-стилями
// (так письма одинаково выглядят в Яндекс Почте, Mail.ru, Gmail и Outlook),
// без внешних картинок и шрифтов. У каждого письма есть текстовая версия.

const BRAND = {
  name: "Мультикнопка",
  site: "https://multiknopka.ru",
  app: "https://app.multiknopka.ru",
  ink: "#17152B",
  paper: "#F7F6FB",
  accent: "#6C4CE0",
  accentSoft: "#EEE9FC",
  muted: "#6B6880",
  line: "#E4E1EE",
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Логотип — стопка из трёх слоёв-модулей (как знак Мультикнопки), собрана из ячеек таблицы:
// виден даже там, где картинки отключены.
function logo() {
  const bar = (color, w) =>
    `<tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:${w}px;height:5px;background:${color};border-radius:3px;font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>`;
  const gap = `<tr><td style="height:2px;font-size:0;line-height:0">&nbsp;</td></tr>`;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;vertical-align:middle;width:22px">` +
    bar("#F7F6FB", 10) + gap + bar("#9D83FF", 22) + gap + bar("#6C4CE0", 22) + gap + bar("#7BE0B9", 22) +
    `</table>`
  );
}

function layout({ preheader, title, body }) {
  const font = "'Rubik','IBM Plex Sans','Segoe UI',Roboto,Arial,sans-serif";
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.paper};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.paper}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;font-family:${font}">
<tr><td style="background:${BRAND.ink};border-radius:20px 20px 0 0;padding:22px 32px">
${logo()}<span style="font-family:${font};font-size:19px;font-weight:600;color:#FFFFFF;vertical-align:middle;padding-left:10px;letter-spacing:-0.2px">мультикнопка<span style="color:#9D83FF">.</span></span>
</td></tr>
<tr><td style="background:#FFFFFF;border-radius:0 0 20px 20px;padding:36px 32px 32px;border:1px solid ${BRAND.line};border-top:0">
${body}
</td></tr>
<tr><td style="padding:24px 8px 0;font-family:${font};font-size:12px;line-height:18px;color:${BRAND.muted};text-align:center">
Письмо отправлено автоматически, отвечать на него не нужно.<br>
${esc(BRAND.name)} — продукт <a href="${BRAND.site}" style="color:${BRAND.muted}">ogma</a> · <a href="${BRAND.app}/privacy" style="color:${BRAND.muted}">Политика конфиденциальности</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

export function loginCodeEmail({ code, ttlMinutes }) {
  const subject = `Код входа в Мультикнопку: ${code}`;
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const text =
    `Ваш код для входа в Мультикнопку: ${code}\n\n` +
    `Введите его на странице входа. Код действует ${ttlMinutes} минут.\n\n` +
    `Если вы не запрашивали вход — просто проигнорируйте это письмо: без кода в ваш аккаунт никто не войдёт.\n\n` +
    `— Мультикнопка\n${BRAND.app}`;
  const font = "'Rubik','IBM Plex Sans','Segoe UI',Roboto,Arial,sans-serif";
  const body = `
<h1 style="margin:0 0 12px;font-family:${font};font-size:24px;line-height:30px;font-weight:600;color:${BRAND.ink};letter-spacing:-0.3px">Ваш код для входа</h1>
<p style="margin:0 0 24px;font-family:${font};font-size:15px;line-height:22px;color:${BRAND.muted}">Введите его на странице входа в Мультикнопку.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" style="background:${BRAND.accentSoft};border-radius:16px;padding:22px 12px">
<span style="font-family:'IBM Plex Mono','SFMono-Regular',Consolas,'Courier New',monospace;font-size:36px;line-height:40px;font-weight:700;letter-spacing:8px;color:${BRAND.accent}">${esc(spaced)}</span>
</td></tr></table>
<p style="margin:20px 0 0;font-family:${font};font-size:14px;line-height:21px;color:${BRAND.ink}">Код действует <b>${ttlMinutes} минут</b>.</p>
<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid ${BRAND.line};font-family:${font};font-size:13px;line-height:20px;color:${BRAND.muted}">Если вы не запрашивали вход — просто проигнорируйте это письмо. Без кода в ваш аккаунт никто не войдёт. Мы никогда не просим сообщать код по телефону или в переписке.</p>`;
  return {
    subject,
    text,
    html: layout({ preheader: `Код ${code} действует ${ttlMinutes} минут`, title: subject, body }),
  };
}
