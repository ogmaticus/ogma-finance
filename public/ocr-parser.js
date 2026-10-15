export const FinanceOCR = (() => {
  const months = [
    "январ",
    "феврал",
    "март",
    "апрел",
    "ма",
    "июн",
    "июл",
    "август",
    "сентябр",
    "октябр",
    "ноябр",
    "декабр",
  ];
  function dateIn(text) {
    let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    let y, mo, d;
    if (m) {
      [, y, mo, d] = m;
    } else {
      m = text.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
      if (m) {
        [, d, mo, y] = m;
      } else {
        m = text.toLowerCase().match(/\b(\d{1,2})\s+([а-яё]+)\s+(\d{4})\b/);
        if (m) {
          d = m[1];
          mo = months.findIndex((p) => m[2].startsWith(p)) + 1;
          y = m[3];
        }
      }
    }
    if (!y || !mo) return "";
    const v = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dt = new Date(v + "T12:00:00Z");
    return !isNaN(dt) && dt.toISOString().slice(0, 10) === v ? v : "";
  }
  function monthNumber(value) {
    const cleaned = value.toLowerCase().replace(
      /[oapecxktmyh]/g,
      (c) =>
        ({
          o: "о",
          a: "а",
          p: "р",
          e: "е",
          c: "с",
          x: "х",
          k: "к",
          t: "т",
          m: "м",
          y: "у",
          h: "н",
        })[c],
    );
    return months.findIndex((p) => cleaned.startsWith(p.slice(0, Math.min(3, p.length)))) + 1;
  }
  function partialDateIn(text) {
    const pieces = text.split("|");
    for (const piece of pieces) {
      const clean = piece.trim().replace(/^[|•©@\s]+/, "");
      const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})(?=$|[\s|,])/);
      if (iso) return { day: +iso[3], month: +iso[2], label: iso[0].trim() };
      let m = clean.match(/^(\d{1,2})\s*([а-яёa-z]+)/i),
        day,
        month;
      if (m) {
        day = +m[1];
        month = monthNumber(m[2]);
      } else {
        m = clean.match(/^(\d{1,2})[./](\d{1,2})(?:[./]\d{4})?(?=$|[\s|,])/);
        if (m) {
          day = +m[1];
          month = +m[2];
        }
      }
      if (day && month && day <= 31 && month <= 12)
        return {
          day,
          month,
          label: clean.replace(/\s+[+\-]?\d[\d ,.]*(?:₽|Р|P|руб).*$/i, "").trim(),
        };
    }
    return null;
  }
  function uncertainDateHeader(text) {
    return (
      /^\s*(?:[|©@]\s*)?\d{1,2}\s*[а-яёa-z]{3,}\s*,\s*(?:пн|вт|ср|чт|пт|сб|вс)(?=$|[ ,|])/i.test(
        text,
      ) ||
      /(?:янв|фев|мар|апр|мая|июн|июл|авг|сен|окт|ноя|дек)[а-яa-zё0-9]*[, ]+(?:пн|вт|ср|чт|пт|сб|вс)(?=$|[ ,|])/i.test(
        text,
      ) ||
      /^\s*[\d|\s]*?(?:сегодня|вчера)(?=$|[ ,|])/i.test(text)
    );
  }
  function resolvePartial(parts, year) {
    if (!parts || !/^\d{4}$/.test(String(year))) return "";
    return dateIn(`${parts.day}.${parts.month}.${year}`);
  }
  function linesFromData(data) {
    const raw = (data.lines || [])
      .map((l) => ({ text: l.text.trim(), bbox: l.bbox, confidence: l.confidence }))
      .filter((l) => l.text);
    if (!raw.length)
      return data.text
        .split("\n")
        .map((text) => ({ text: text.trim(), confidence: data.confidence || 0 }))
        .filter((l) => l.text);
    raw.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    const rows = [];
    for (const l of raw) {
      const cy = (l.bbox.y0 + l.bbox.y1) / 2;
      const prev = rows.at(-1);
      if (prev && Math.abs(cy - prev.cy) < Math.min(l.bbox.y1 - l.bbox.y0, prev.height) * 0.65) {
        prev.parts.push(l);
        prev.text = prev.parts
          .sort((a, b) => a.bbox.x0 - b.bbox.x0)
          .map((x, i, parts) => (i && x.bbox.x0 - parts[i - 1].bbox.x1 > 40 ? " | " : " ") + x.text)
          .join("")
          .trim();
        prev.confidence = Math.min(prev.confidence, l.confidence);
      } else
        rows.push({
          text: l.text,
          cy,
          height: l.bbox.y1 - l.bbox.y0,
          confidence: l.confidence,
          parts: [l],
        });
    }
    return rows;
  }
  function category(name) {
    if (/пят[её]роч|pyaterochka|магнит|перекр[её]ст|продукт|ашан|вкусвилл/i.test(name))
      return "Продукты";
    if (/стрелка|тройка|такси|метро|проезд|транспорт/i.test(name)) return "Транспорт";
    if (/маркет|ozon|озон|wildberries|вайлдбер/i.test(name)) return "Покупки";
    if (/кафе|кофе|ресторан|coffee/i.test(name)) return "Кафе";
    if (/аптек|клиник|медицин/i.test(name)) return "Здоровье";
    return "Другое";
  }
  function bankCategory(context) {
    const patterns = [
      [/супермаркет|продукты/i, "Продукты"],
      [/фастфуд|кафе|рестораны/i, "Кафе"],
      [/дом и ремонт|жиль[её]|коммуналь/i, "Жильё"],
      [/транспорт|такси/i, "Транспорт"],
      [/здоровье|аптеки/i, "Здоровье"],
    ];
    const hits = patterns
      .map(([re, category]) => ({ index: context.search(re), category }))
      .filter((x) => x.index >= 0)
      .sort((a, b) => a.index - b.index);
    return hits[0]?.category;
  }
  function accountRefs(context) {
    const refs = [],
      re = /(?:[*•·+>«-]\s*){2,}(\d{4})/g;
    for (const match of context.matchAll(re)) {
      if (refs.some((r) => r.hint === match[1])) continue;
      const prefix = context.slice(Math.max(0, match.index - 65), match.index),
        name = /кредитн|сберк/i.test(prefix)
          ? "Кредитная карта"
          : /совместн/i.test(prefix)
            ? "Совместный счёт"
            : "Счёт";
      refs.push({ hint: match[1], label: name + " •" + match[1] });
    }
    return refs;
  }
  function bankCategoryLabel(context) {
    const labels = [
      "Супермаркеты",
      "Фастфуд",
      "Дом и ремонт",
      "Продукты",
      "Кафе и рестораны",
      "Кафе",
      "Рестораны",
      "Транспорт",
      "Такси",
      "Аптеки",
      "Здоровье",
      "Медицинские услуги",
      "Путешествия",
      "Развлечения",
      "Красота",
      "Образование",
      "Одежда и обувь",
      "Электроника",
      "Топливо",
      "Автоуслуги",
      "Связь и интернет",
      "Мобильная связь",
      "Коммунальные платежи",
      "Подарки",
      "Страхование",
      "Налоги и штрафы",
      "Комиссии",
      "Благотворительность",
      "Спорт",
      "Питомцы",
      "Подписки",
      "Другие расходы",
    ];
    const lower = context.toLowerCase();
    return (
      labels
        .map((label) => ({ label, index: lower.indexOf(label.toLowerCase()) }))
        .filter((x) => x.index >= 0)
        .sort((a, b) => a.index - b.index || b.label.length - a.label.length)[0]?.label || ""
    );
  }
  const amountRE =
    /([+\-]?\s*\d[\d ]*(?:[,.]\d{1,2})?)\s*(₽|руб(?:лей|ля|ль)?\.?|rub|р\.?|p|₺|try|usd|eur|gbp|[$€£])(?=$|[\s|])/gi;
  function amountHits(text) {
    return [...text.matchAll(amountRE)].map((hit) => {
      if (/[*•·+>«-]{2,}\s*$/.test(text.slice(0, hit.index))) {
        const prefix = hit[1].match(/^(\s*\d(?:\s*\d){3})\s+(?=\d)/);
        if (prefix) {
          hit.index += prefix[0].length;
          hit[0] = hit[0].slice(prefix[0].length);
          hit[1] = hit[1].slice(prefix[0].length);
        }
      }
      return hit;
    });
  }
  function withoutLeadingDate(text) {
    return text.replace(
      /^\s*(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}(?:[./]\d{4})?|\d{1,2}\s+[а-яёa-z]+\.?(?:\s+\d{4})?)\s*/i,
      "",
    );
  }
  function dateHeaderOnly(text) {
    return (
      withoutLeadingDate(text)
        .replace(
          /^\s*,?\s*(?:понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|пн|вт|ср|чт|пт|сб|вс)(?=$|[\s|,])/i,
          "",
        )
        .replace(amountRE, "")
        .replace(/[\s|,.\-]/g, "") === ""
    );
  }
  function parse(data, year = "") {
    const lines = linesFromData(data),
      result = [];
    let currentDate = "",
      previous = "",
      pendingDate = "",
      currentParts = null,
      skipDayTotal = false;
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].text.replace(/[−–—]/g, "-").replace(/[\u00a0\u202f\u2009]/g, " ");
      if (/^\d{1,2}\s*[а-яa-zё.]+\s*-\s*\d{1,2}\s*[а-яa-zё.]+/i.test(text)) continue;
      const dt = dateIn(text),
        parts = partialDateIn(text),
        header = parts && dateHeaderOnly(text);
      if (header) {
        currentParts = parts;
        currentDate = dt || resolvePartial(parts, year);
        pendingDate = parts.label;
        previous = "";
        skipDayTotal = true;
        continue;
      }
      if (dt) {
        currentDate = dt;
        currentParts = null;
        pendingDate = "";
      } else if (parts) {
        currentParts = parts;
        currentDate = resolvePartial(parts, year);
        pendingDate = parts.label;
      } else if (uncertainDateHeader(text)) {
        currentDate = "";
        currentParts = null;
        pendingDate = text;
        previous = "";
        skipDayTotal = true;
        continue;
      }
      if (
        /(?:остаток|баланс|доступно|лимит|кредитная\s+сберкарта|сберкарта\s*:|сч[её]т\s*:|всего|итого|кэшб[еэ]к)/i.test(
          text,
        )
      ) {
        previous = "";
        continue;
      }
      const hits = amountHits(text);
      if (skipDayTotal && hits.length && !/[а-яa-zё]{2}/i.test(text.replace(hits.at(-1)[0], ""))) {
        skipDayTotal = false;
        previous = "";
        continue;
      }
      if (!hits.length) {
        if (
          !dt &&
          /[а-яёa-z]{2}/i.test(text) &&
          !/^(?:оплата товаров|между своими|перевод на|поиск|что показывать|период|карты|сч[её]т|\d{1,2}:\d{2})/i.test(
            text,
          )
        ) {
          previous = text;
          skipDayTotal = false;
        }
        continue;
      }
      const h = hits.at(-1),
        amount = Number(h[1].replace(/[ +\-]/g, "").replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      let name = text
        .slice(0, h.index)
        .trim()
        .replace(/\d{1,2}:\d{2}/g, "")
        .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g, "")
        .trim();
      if (!name) name = previous || "Уточните название";
      name =
        name
          .split("|")
          .map((x) => x.trim())
          .filter(Boolean)
          .at(-1) || "Уточните название";
      name = name.replace(/^[©@|•:>\s]+/, "").replace(/\s+-$/, "");
      if (parts && !header) name = withoutLeadingDate(name).replace(/^[|,\s]+/, "");
      if (partialDateIn(name) || uncertainDateHeader(name)) {
        previous = "";
        continue;
      }
      const following = [];
      for (const l of lines.slice(i + 1, i + 5)) {
        if (amountHits(l.text).length) {
          if (/сберкарта\s*:|сч[её]т\s*:|карта\s*:/i.test(l.text))
            following.push(l.text.split(":")[0]);
          break;
        }
        if (partialDateIn(l.text) || uncertainDateHeader(l.text)) break;
        following.push(l.text);
      }
      const context = [text, ...following].join(" ");
      const isTransfer =
        /между своими|между\s+счетами|на свой сч[её]т|(?:со|с) своего сч[её]та/i.test(context);
      const plus = h[1].includes("+"),
        negative = h[1].includes("-"),
        isRefund = !negative && /возврат|отмена операций|refund/i.test(context),
        incoming =
          !negative &&
          (plus ||
            /(?:^|\s)(?:зачислени[ея]|поступлени[ея]|зарплат[аы]|получение перевода)(?=$|[\s,])/i.test(
              context,
            )),
        needsType = false;
      const time = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/),
        symbol = h[2].toLowerCase(),
        currency = /^(?:₽|р\.?|p|руб|rub)/i.test(symbol)
          ? "RUB"
          : symbol === "₺" || symbol === "try"
            ? "TRY"
            : ["usd", "eur", "gbp"].includes(symbol)
              ? symbol.toUpperCase()
              : "OTHER",
        accountHint =
          context.match(/(?:сч[её]т|(?:сбер)?карт[аы])\s*[*•·xX…\s]+(\d{4})(?!\d)/i)?.[1] ||
          (accountRefs(context).length === 1 ? accountRefs(context)[0].hint : "");
      const note = [
        !currentDate
          ? pendingDate
            ? "Дата: " + pendingDate + " — уточните год / дату"
            : "Дата не найдена"
          : "",
        isTransfer ? "Выберите счета перевода" : "",
        isRefund ? "Возврат: проверьте категорию покупки" : incoming ? "Поступление" : "Расход",
        lines[i].confidence < 75 ? "Текст распознан неуверенно" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const refs = accountRefs(context);
      result.push({
        name,
        amount,
        currency,
        currencyHint: h[2],
        type: isTransfer ? "transfer" : isRefund ? "refund" : incoming ? "income" : "expense",
        needsType,
        date: dt || currentDate,
        partialDate: currentParts ? { ...currentParts } : null,
        dateLabel: pendingDate,
        time: time ? `${time[1].padStart(2, "0")}:${time[2]}` : "",
        category: isTransfer ? "Перевод" : bankCategory(context) || category(name),
        bankCategory: bankCategoryLabel(context),
        note,
        selected: currency === "RUB",
        autoExcluded: currency !== "RUB",
        accountHint,
        accountRefs: refs,
        fromHint: isTransfer ? refs[0]?.hint || "" : "",
        toHint: isTransfer ? refs[1]?.hint || "" : "",
        operationLabel:
          !isTransfer && !incoming && !isRefund && /сбп|перевод/i.test(context)
            ? "Перевод человеку"
            : isTransfer
              ? "Между своими счетами"
              : isRefund
                ? "Возврат"
                : incoming
                  ? "Поступление"
                  : "Покупка",
        raw: context,
      });
      previous = "";
    }
    return result;
  }
  function currencyGlyphCandidates(data, width, height) {
    if (!width || !height) return [];
    const result = [];
    for (const line of data.lines || []) {
      const text = line.text.trim(),
        b = line.bbox;
      if (
        !b ||
        b.x0 < width * 0.55 ||
        b.y0 < height * 0.08 ||
        b.y1 > height * 0.95 ||
        !/^\s*[+\-−]?\s*\d[\d\s.,]*$/.test(text) ||
        text.replace(/\D/g, "").length < 4
      )
        continue;
      const symbols = (line.words || [])
          .flatMap((w) => w.symbols || [])
          .filter((s) => s.text.trim() && s.bbox)
          .sort((a, b) => a.bbox.x0 - b.bbox.x0),
        glyph = symbols.at(-1),
        previous = symbols.at(-2);
      if (!glyph || !previous || !/^\d$/.test(glyph.text)) continue;
      const gaps = symbols
          .slice(1, -1)
          .map((s, i) => s.bbox.x0 - symbols[i].bbox.x1)
          .filter((n) => n >= 0)
          .sort((a, b) => a - b),
        typical = gaps[Math.floor(gaps.length / 2)] || 0;
      if (glyph.bbox.x0 - previous.bbox.x1 < Math.max(6, typical * 2)) continue;
      const number = symbols
        .slice(0, -1)
        .map((s) => s.text)
        .join("");
      if (!/^[+\-−]?\d[\d.,]*$/.test(number)) continue;
      result.push({ line, glyph, number });
    }
    return result;
  }
  function mergePasses(primary, secondary) {
    const normalize = (s) =>
      s
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[^а-яa-z0-9]/g, "");
    const out = primary.slice(),
      used = new Set();
    let anchor = -1;
    for (const o of secondary) {
      const matches = (p, i) =>
        !used.has(i) &&
        p.amount === o.amount &&
        p.type === o.type &&
        p.date === o.date &&
        JSON.stringify(p.partialDate && [p.partialDate.day, p.partialDate.month]) ===
          JSON.stringify(o.partialDate && [o.partialDate.day, o.partialDate.month]) &&
        (normalize(p.name).includes(normalize(o.name)) ||
          normalize(o.name).includes(normalize(p.name)));
      let i = primary.findIndex(
        (p, i) => matches(p, i) && (p.currency || "RUB") === (o.currency || "RUB"),
      );
      if (i < 0) i = primary.findIndex(matches);
      if (i >= 0) {
        used.add(i);
        anchor = out.indexOf(primary[i]);
        if ((primary[i].currency || "RUB") !== (o.currency || "RUB")) {
          primary[i].currency = "OTHER";
          primary[i].selected = false;
          primary[i].autoExcluded = true;
        }
      } else {
        out.splice(anchor + 1, 0, o);
        anchor++;
      }
    }
    return out;
  }
  return {
    parse,
    dateIn,
    linesFromData,
    mergePasses,
    partialDateIn,
    resolvePartial,
    uncertainDateHeader,
    accountRefs,
    currencyGlyphCandidates,
  };
})();
