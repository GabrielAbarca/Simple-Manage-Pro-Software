import { describe, it, expect } from "vitest";
import {
  crc32,
  columnName,
  sheetName,
  zipStored,
  toXlsx,
} from "../src/js/xlsx.js";

const text = (s) => new TextEncoder().encode(s);

/** Read the stored entries back out of a zip produced by zipStored. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const entries = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(
      bytes.subarray(at + 30, at + 30 + nameLength),
    );
    const data = bytes.subarray(
      at + 30 + nameLength,
      at + 30 + nameLength + size,
    );
    entries[name] = { crc, data: new TextDecoder().decode(data), raw: data };
    at += 30 + nameLength + size;
  }
  return { entries, centralAt: at };
}

describe("xlsx", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("names columns the way spreadsheets do", () => {
    expect([0, 25, 26, 51, 701, 702].map(columnName)).toEqual([
      "A",
      "Z",
      "AA",
      "AZ",
      "ZZ",
      "AAA",
    ]);
  });

  it("zips entries with matching CRCs and a closing directory", () => {
    const files = { "a.txt": text("hello"), "b/c.txt": text("ñ") };
    const zip = zipStored(files);
    const { entries, centralAt } = unzip(zip);
    expect(entries["a.txt"].data).toBe("hello");
    expect(entries["b/c.txt"].data).toBe("ñ");
    expect(entries["a.txt"].crc).toBe(crc32(text("hello")));

    // Excel reads the central directory, so walk it the way a reader does:
    // from the end record, entry by entry, back to each local header.
    const view = new DataView(zip.buffer);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 8, true)).toBe(2);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const size = view.getUint32(end + 12, true);
    const start = view.getUint32(end + 16, true);
    expect(start).toBe(centralAt);
    expect(start + size).toBe(end);

    let at = start;
    for (const [path, data] of Object.entries(files)) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      expect(view.getUint16(at + 8, true)).toBe(0x0800);
      expect(view.getUint16(at + 10, true)).toBe(0);
      expect(view.getUint16(at + 14, true)).toBe(0x0021);
      expect(view.getUint32(at + 16, true)).toBe(crc32(data));
      expect(view.getUint32(at + 20, true)).toBe(data.length);
      expect(view.getUint32(at + 24, true)).toBe(data.length);
      const nameLength = view.getUint16(at + 28, true);
      const name = new TextDecoder().decode(
        zip.subarray(at + 46, at + 46 + nameLength),
      );
      expect(name).toBe(path);

      const local = view.getUint32(at + 42, true);
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      expect(view.getUint16(local + 6, true)).toBe(0x0800);
      expect(view.getUint16(local + 8, true)).toBe(0);
      expect(view.getUint16(local + 12, true)).toBe(0x0021);
      expect(view.getUint32(local + 14, true)).toBe(crc32(data));
      expect(view.getUint32(local + 18, true)).toBe(data.length);
      expect(view.getUint32(local + 22, true)).toBe(data.length);
      expect(view.getUint16(local + 26, true)).toBe(nameLength);
      expect(entries[name].raw).toEqual(data);

      at += 46 + nameLength;
    }
    expect(at).toBe(end);
  });

  it("declares every part with its content type and relationship", () => {
    const { entries } = unzip(toXlsx([["a"]]));
    const types = entries["[Content_Types].xml"].data;
    const ooxml = "application/vnd.openxmlformats";
    expect(types).toContain(
      `<Default Extension="rels" ContentType="${ooxml}-package.relationships+xml"/>`,
    );
    expect(types).toContain(
      `<Override PartName="/xl/workbook.xml" ContentType="${ooxml}-officedocument.spreadsheetml.sheet.main+xml"/>`,
    );
    expect(types).toContain(
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${ooxml}-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
    expect(types).toContain(
      `<Override PartName="/xl/styles.xml" ContentType="${ooxml}-officedocument.spreadsheetml.styles+xml"/>`,
    );
    const rel =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    expect(entries["_rels/.rels"].data).toContain(
      `Type="${rel}/officeDocument" Target="xl/workbook.xml"`,
    );
    const workbookRels = entries["xl/_rels/workbook.xml.rels"].data;
    expect(workbookRels).toContain(
      `Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"`,
    );
    expect(workbookRels).toContain(
      `Id="rId2" Type="${rel}/styles" Target="styles.xml"`,
    );
    expect(entries["xl/workbook.xml"].data).toContain('r:id="rId1"');
  });

  it("writes text as inline strings and numbers as numbers", () => {
    const { entries } = unzip(
      toXlsx(
        [
          ["Nombre", "Nota"],
          ["María <Rojas> & Co", 87.5],
          [null, 0],
        ],
        { sheetName: "Notas" },
      ),
    );
    const sheet = entries["xl/worksheets/sheet1.xml"].data;
    expect(sheet).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">María &lt;Rojas&gt; &amp; Co</t></is></c>',
    );
    expect(sheet).toContain('<c r="B2"><v>87.5</v></c>');
    expect(sheet).toContain('<c r="B3"><v>0</v></c>');
    expect(sheet).not.toContain('r="A3"');
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(entries["xl/workbook.xml"].data).toContain('name="Notas"');
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/styles.xml",
        "xl/worksheets/sheet1.xml",
      ]),
    );
  });

  it("drops characters XML cannot carry", () => {
    const { entries } = unzip(toXlsx([["a\u0001b\tc\uFFFEd\uFFFF"]]));
    expect(entries["xl/worksheets/sheet1.xml"].data).toContain(">ab\tcd<");
  });

  it("keeps a literal _xHHHH_ from being read as an escape", () => {
    const { entries } = unzip(toXlsx([["code_x0041_end"]]));
    expect(entries["xl/worksheets/sheet1.xml"].data).toContain(
      ">code_x005F_x0041_end<",
    );
  });

  it("cuts text to the most a cell can hold", () => {
    const { entries } = unzip(toXlsx([["a".repeat(40000)]]));
    const sheet = entries["xl/worksheets/sheet1.xml"].data;
    expect(sheet).toContain(`>${"a".repeat(32767)}<`);
    expect(sheet).not.toContain("a".repeat(32768));
  });

  it("leaves a cell empty for a non-finite number", () => {
    const { entries } = unzip(toXlsx([["h"], [NaN, Infinity, 1]]));
    const sheet = entries["xl/worksheets/sheet1.xml"].data;
    expect(sheet).not.toContain('r="A2"');
    expect(sheet).not.toContain('r="B2"');
    expect(sheet).toContain('<c r="C2"><v>1</v></c>');
  });

  it("writes a Date as a serial day in the short date format", () => {
    const { entries } = unzip(
      toXlsx([
        ["Nacimiento"],
        [new Date(Date.UTC(2012, 4, 3))],
        [new Date(NaN)],
      ]),
    );
    const sheet = entries["xl/worksheets/sheet1.xml"].data;
    expect(sheet).toContain('<c r="A2" s="2"><v>41032</v></c>');
    expect(sheet).not.toContain('r="A3"');
    expect(entries["xl/styles.xml"].data).toContain(
      '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>',
    );
  });

  it("sizes each column to its longest value", () => {
    const { entries } = unzip(
      toXlsx([
        ["Nombre", "N"],
        ["María José Rojas", 7],
        [new Date(Date.UTC(2012, 4, 3)), "x".repeat(100)],
      ]),
    );
    expect(entries["xl/worksheets/sheet1.xml"].data).toContain(
      '<cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="60" customWidth="1"/></cols><sheetData>',
    );
  });

  it("cleans a sheet name into one Excel accepts", () => {
    expect(sheetName("Notas: 7-1 / I Periodo [2026]?")).toBe(
      "Notas 7-1 I Periodo 2026",
    );
    expect(sheetName("'Asistencia'")).toBe("Asistencia");
    expect(sheetName(" ' Asistencia ' ")).toBe("Asistencia");
    expect(sheetName(`${"a".repeat(30)}'b`)).toBe("a".repeat(30));
    expect(sheetName("07/10/2026")).toBe("07 10 2026");
    expect(sheetName("")).toBe("Sheet1");
    expect(sheetName("*?")).toBe("Sheet1");
    expect(sheetName("a".repeat(40))).toBe("a".repeat(31));
    expect(sheetName(`${"a".repeat(30)}😀`)).toBe("a".repeat(30));
    const { entries } = unzip(toXlsx([["a"]], { sheetName: "A/B" }));
    expect(entries["xl/workbook.xml"].data).toContain('name="A B"');
  });
});
