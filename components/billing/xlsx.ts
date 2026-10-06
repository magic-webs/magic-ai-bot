/**
 * The first sheet of an .xlsx file as rows of cell text — enough to read
 * Meta's rate cards, which download as workbooks despite their .csv name.
 * Unzips with the browser's own DecompressionStream rather than a library.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

async function unzip(buffer: ArrayBuffer): Promise<Map<string, () => Promise<string>>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let end = buffer.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== EOCD) end--;
  if (end < 0) throw new Error("This is not an .xlsx file.");

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, () => Promise<string>>();
  for (let i = 0; i < count && view.getUint32(at, true) === CENTRAL; i++) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    files.set(name, () =>
      method === 0 ? Promise.resolve(new TextDecoder().decode(data)) : inflate(data)
    );
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const columnIndex = (ref: string) =>
  [...(ref.match(/^[A-Z]+/)?.[0] ?? "A")].reduce(
    (sum, letter) => sum * 26 + letter.charCodeAt(0) - 64,
    0
  ) - 1;

export async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buffer);
  const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
  const textOf = (node: Element) =>
    [...node.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("");

  const strings = files.get("xl/sharedStrings.xml");
  const shared = strings
    ? [...parse(await strings()).getElementsByTagName("si")].map(textOf)
    : [];
  const sheet = files.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("The workbook has no first sheet.");

  return [...parse(await sheet()).getElementsByTagName("row")].map((row) => {
    const cells: string[] = [];
    for (const cell of row.getElementsByTagName("c")) {
      const type = cell.getAttribute("t");
      const value = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      cells[columnIndex(cell.getAttribute("r") ?? "")] =
        type === "s" ? (shared[Number(value)] ?? "") : type === "inlineStr" ? textOf(cell) : value;
    }
    return Array.from(cells, (cell) => (cell ?? "").trim());
  });
}
