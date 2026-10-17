import { FinanceOCR } from "./ocr-parser.js?v=34";
export async function refineCurrencyGlyphs(
  worker,
  image,
  data,
  width,
  height,
  isCancelled = () => false,
) {
  const candidates = FinanceOCR.currencyGlyphCandidates(data, width, height);
  if (!candidates.length) return data;
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: "10",
      tessedit_char_whitelist: "₽РPрp₺$€£¥",
    });
    for (const candidate of candidates.slice(0, 12)) {
      if (isCancelled()) break;
      const b = candidate.glyph.bbox,
        left = Math.max(0, b.x0 - 3),
        top = Math.max(0, b.y0 - 3),
        rectangle = {
          left,
          top,
          width: Math.min(width, b.x1 + 3) - left,
          height: Math.min(height, b.y1 + 3) - top,
        };
      const { data: read } = await worker.recognize(
        image,
        { rectangle },
        { text: true, blocks: false, hocr: false, tsv: false },
      );
      const glyph = read.text?.trim();
      if (read.confidence >= 65 && /^[₽РPрp₺$€£¥]$/.test(glyph)) {
        candidate.line.text = candidate.number + " " + glyph;
        candidate.line.confidence = Math.min(candidate.line.confidence, read.confidence);
      }
    }
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" });
  }
  return data;
}
