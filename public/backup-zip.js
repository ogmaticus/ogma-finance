// A small ZIP profile: stored entries, UTF-8 names, CRC32, no encryption/ZIP64.
export const FinanceZip = (() => {
  const encoder = new TextEncoder(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  const table = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  async function crc32(blob) {
    let crc = 0xffffffff;
    for (let start = 0; start < blob.size; start += 1048576) {
      const bytes = new Uint8Array(await blob.slice(start, start + 1048576).arrayBuffer());
      for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function pathValid(name) {
    return (
      typeof name === "string" &&
      name.length <= 220 &&
      /^(?:manifest\.json|budget\.json|screenshots\/[a-f0-9]{64}\.(?:png|jpg|webp))$/.test(name)
    );
  }
  function view(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  async function build(entries, onProgress = () => {}) {
    if (entries.length > 10002) throw Error("В архиве слишком много файлов");
    const parts = [],
      central = [],
      names = new Set();
    let offset = 0;
    const now = new Date(),
      year = Math.max(1980, now.getFullYear()),
      date = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
      time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >>> 1);
    for (let i = 0; i < entries.length; i++) {
      const { name, blob } = entries[i];
      if (!pathValid(name) || names.has(name) || !(blob instanceof Blob) || blob.size > 0xffffffff)
        throw Error("Некорректный файл архива");
      names.add(name);
      const encoded = encoder.encode(name),
        crc = await crc32(blob),
        head = new Uint8Array(30 + encoded.length),
        h = view(head);
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x800, true);
      h.setUint16(10, time, true);
      h.setUint16(12, date, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, blob.size, true);
      h.setUint32(22, blob.size, true);
      h.setUint16(26, encoded.length, true);
      head.set(encoded, 30);
      const record = new Uint8Array(46 + encoded.length),
        c = view(record);
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x800, true);
      c.setUint16(12, time, true);
      c.setUint16(14, date, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, blob.size, true);
      c.setUint32(24, blob.size, true);
      c.setUint16(28, encoded.length, true);
      c.setUint32(42, offset, true);
      record.set(encoded, 46);
      parts.push(head, blob);
      central.push(record);
      offset += head.length + blob.size;
      if (offset > 0xffff0000) throw Error("Архив превышает поддерживаемый размер 4 ГБ");
      onProgress(i + 1, entries.length);
    }
    const centralSize = central.reduce((s, c) => s + c.length, 0);
    if (offset + centralSize + 22 > 0xffffffff) throw Error("Архив превышает 4 ГБ");
    const end = new Uint8Array(22),
      e = view(end);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, entries.length, true);
    e.setUint16(10, entries.length, true);
    e.setUint32(12, centralSize, true);
    e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }
  async function open(file) {
    if (!(file instanceof Blob) || file.size < 22 || file.size > 0xffffffff)
      throw Error("Некорректный размер архива");
    const tailStart = Math.max(0, file.size - 65557),
      tail = new Uint8Array(await file.slice(tailStart).arrayBuffer()),
      tv = view(tail);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--)
      if (
        tv.getUint32(i, true) === 0x06054b50 &&
        i + 22 + tv.getUint16(i + 20, true) === tail.length
      ) {
        end = i;
        break;
      }
    if (end < 0) throw Error("Повреждённый ZIP-архив");
    const count = tv.getUint16(end + 10, true),
      size = tv.getUint32(end + 12, true),
      offset = tv.getUint32(end + 16, true);
    if (
      tv.getUint16(end + 4, true) ||
      tv.getUint16(end + 6, true) ||
      tv.getUint16(end + 8, true) !== count ||
      count > 10002 ||
      size > 4000000 ||
      offset + size !== tailStart + end
    )
      throw Error("Этот ZIP-формат не поддерживается");
    const directory = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()),
      d = view(directory),
      entries = new Map();
    let pos = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > directory.length || d.getUint32(pos, true) !== 0x02014b50)
        throw Error("Повреждённый список файлов");
      const flags = d.getUint16(pos + 8, true),
        method = d.getUint16(pos + 10, true),
        crc = d.getUint32(pos + 16, true),
        packed = d.getUint32(pos + 20, true),
        length = d.getUint32(pos + 24, true),
        nameSize = d.getUint16(pos + 28, true),
        extra = d.getUint16(pos + 30, true),
        comment = d.getUint16(pos + 32, true),
        local = d.getUint32(pos + 42, true),
        next = pos + 46 + nameSize + extra + comment;
      if (
        next > directory.length ||
        flags !== 0x800 ||
        method !== 0 ||
        packed !== length ||
        d.getUint16(pos + 34, true) !== 0
      )
        throw Error("Используйте исходный архив, скачанный из приложения");
      const name = decoder.decode(directory.slice(pos + 46, pos + 46 + nameSize));
      if (
        !pathValid(name) ||
        entries.has(name) ||
        length >
          (name.startsWith("screenshots/")
            ? 10485760
            : name === "manifest.json"
              ? 16777216
              : 4194304) ||
        local + 30 > offset
      )
        throw Error("Недопустимый файл в архиве");
      const header = new Uint8Array(await file.slice(local, local + 30).arrayBuffer()),
        h = view(header);
      if (
        h.getUint32(0, true) !== 0x04034b50 ||
        h.getUint16(6, true) !== flags ||
        h.getUint16(8, true) !== method ||
        h.getUint32(14, true) !== crc ||
        h.getUint32(18, true) !== packed ||
        h.getUint32(22, true) !== length ||
        h.getUint16(26, true) !== nameSize
      )
        throw Error("Повреждённый заголовок файла");
      const localName = decoder.decode(
        new Uint8Array(await file.slice(local + 30, local + 30 + nameSize).arrayBuffer()),
      );
      if (localName !== name) throw Error("Имена файлов в архиве не совпадают");
      const start = local + 30 + nameSize + h.getUint16(28, true),
        finish = start + length;
      if (finish > offset) throw Error("Повреждённые границы файла");
      entries.set(name, { name, blob: file.slice(start, finish), crc, local, start, finish });
      pos = next;
    }
    if (pos !== directory.length) throw Error("Некорректный список файлов");
    const ordered = [...entries.values()].sort((a, b) => a.local - b.local);
    let finish = 0;
    for (const item of ordered) {
      if (item.local !== finish) throw Error("Перекрывающиеся файлы архива");
      finish = item.finish;
    }
    if (finish !== offset) throw Error("Лишние данные в архиве");
    return {
      entries,
      async read(name) {
        const item = entries.get(name);
        if (!item) throw Error("В архиве не найден " + name);
        if ((await crc32(item.blob)) !== item.crc) throw Error("Файл повреждён: " + name);
        return item.blob;
      },
    };
  }
  return { build, open, crc32 };
})();
