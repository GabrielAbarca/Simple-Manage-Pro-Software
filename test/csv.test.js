import { describe, it, expect } from "vitest";
import {
  parseCsv,
  parseRows,
  detectDelimiter,
  autoMap,
  toCsv,
} from "../src/js/csv.js";

describe("csv parser", () => {
  it("parses a header + rows into keyed objects", () => {
    const { headers, rows } = parseCsv(
      "first_name,last_name,enrollment\nAna,García,S-101\nLuis,Martínez,S-102\n",
    );
    expect(headers).toEqual(["first_name", "last_name", "enrollment"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      first_name: "Ana",
      last_name: "García",
      enrollment: "S-101",
    });
  });

  it("honors quoted fields with embedded commas and escaped quotes", () => {
    const rows = parseRows('a,"García, M.","He said ""hi"""');
    expect(rows[0]).toEqual(["a", "García, M.", 'He said "hi"']);
  });

  it("handles quoted newlines and CRLF line endings", () => {
    const { rows } = parseCsv('name,note\r\nAna,"line1\nline2"\r\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("line1\nline2");
  });

  it("drops fully blank lines", () => {
    const { rows } = parseCsv("a,b\n1,2\n\n3,4\n");
    expect(rows).toHaveLength(2);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter("a,b,c")).toBe(",");
  });

  it("parses semicolon-delimited exports", () => {
    const { headers, rows } = parseCsv("a;b\n1;2\n");
    expect(headers).toEqual(["a", "b"]);
    expect(rows[0]).toEqual({ a: "1", b: "2" });
  });

  it("auto-maps headers case/accent/space-insensitively", () => {
    const map = autoMap(["First Name", "Apellidos", "Cédula", "extra"], {
      first_name: ["first name", "nombre"],
      last_name: ["apellidos", "last name"],
      national_id: ["cedula", "national id"],
      gender: ["gender", "sexo"],
    });
    expect(map).toEqual({
      first_name: "First Name",
      last_name: "Apellidos",
      national_id: "Cédula",
      gender: "",
    });
  });

  it("returns empty results for blank input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});

describe("toCsv", () => {
  it("writes a BOM, CRLF lines and leaves numbers alone", () => {
    expect(
      toCsv([
        ["Name", "Score"],
        ["Ana", 87.5],
      ]),
    ).toBe("﻿Name,Score\r\nAna,87.5\r\n");
  });

  it("quotes cells holding the delimiter, quotes or line breaks", () => {
    expect(
      toCsv([["Rojas, María", 'say "hi"', "two\nlines"]], { bom: false }),
    ).toBe('"Rojas, María","say ""hi""","two\nlines"\r\n');
  });

  it("neutralises text a spreadsheet would run as a formula", () => {
    expect(toCsv([["=SUM(A1)", "+1", "-x", "@cmd", -5]], { bom: false })).toBe(
      "'=SUM(A1),'+1,'-x,'@cmd,-5\r\n",
    );
  });

  it("neutralises a formula that starts after a tab or a carriage return", () => {
    expect(toCsv([["\t=1", "\r=1"]], { bom: false })).toBe(
      "'\t=1,\"'\r'=1\"\r\n",
    );
  });

  it("neutralises a formula that follows a separator inside the text", () => {
    // Excel in Spanish splits on semicolons, so `=1+1` would get a cell of
    // its own.
    expect(toCsv([["a;=1+1;b", "x, -y", "a\n@cmd"]], { bom: false })).toBe(
      'a;\'=1+1;b,"x, \'-y","a\n\'@cmd"\r\n',
    );
    expect(toCsv([['x;"=1+1;y']], { bom: false })).toBe('"x;""\'=1+1;y"\r\n');
    expect(toCsv([["8888-1111", "a-b", "x;y"]], { bom: false })).toBe(
      "8888-1111,a-b,x;y\r\n",
    );
  });

  it("writes dates as YYYY-MM-DD", () => {
    expect(
      toCsv([[new Date(Date.UTC(2012, 4, 3)), new Date(NaN)]], { bom: false }),
    ).toBe("2012-05-03,\r\n");
  });

  it("imports its own neutralised cells back unchanged", () => {
    const rows = [
      ["Nombre", "Teléfono"],
      ["=SUM(A1)", "+506 8888-1111"],
      ["'quoted", "@home"],
      ["a;=1+1;b", "x, -y"],
    ];
    const { rows: parsed } = parseCsv(toCsv(rows));
    expect(parsed).toEqual([
      { Nombre: "=SUM(A1)", Teléfono: "+506 8888-1111" },
      { Nombre: "'quoted", Teléfono: "@home" },
      { Nombre: "a;=1+1;b", Teléfono: "x, -y" },
    ]);
  });

  it("writes empty cells for null, undefined and non-finite numbers", () => {
    expect(toCsv([[null, undefined, NaN, ""]], { bom: false })).toBe(",,,\r\n");
  });

  it("round-trips through the parser", () => {
    const rows = [
      ["Apellidos", "Nombre", "Nota"],
      ["Rojas, Pérez", 'Ana "Anita"', "90"],
    ];
    const { headers, rows: parsed } = parseCsv(
      toCsv(rows, { bom: false }).trim(),
    );
    expect(headers).toEqual(rows[0]);
    expect(parsed[0]).toEqual({
      Apellidos: "Rojas, Pérez",
      Nombre: 'Ana "Anita"',
      Nota: "90",
    });
  });
});
