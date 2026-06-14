export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

/**
 * Parse RFC 4180-style CSV: quoted fields may hold commas, newlines, and
 * doubled quotes (`""`); CRLF and LF both end a record. The first non-empty
 * record is the header. A trailing newline does not yield a blank row.
 */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let sawContent = false;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
    sawContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      field += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      sawContent = true;
      continue;
    }
    if (char === ",") {
      sawContent = true;
      pushField();
      continue;
    }
    if (char === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRecord();
      continue;
    }
    if (char === "\n") {
      pushRecord();
      continue;
    }
    sawContent = true;
    field += char;
  }
  if (sawContent || field.length > 0 || record.length > 0) pushRecord();

  const nonEmpty = records.filter((row) => row.length > 1 || row[0] !== "");
  const [header, ...rows] = nonEmpty;
  if (!header) return { header: [], rows: [] };
  return { header, rows };
}

/**
 * Serialize back to RFC 4180 CSV. A field is quoted iff it holds a comma,
 * quote, CR, or LF; inner quotes are doubled. Records join with `\n` and the
 * output ends with a single trailing newline. `parseCsv` round-trips the
 * result, and `serializeCsv(parseCsv(text))` is a normalized, idempotent form.
 */
function escapeCsvField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

export function serializeCsv({ header, rows }: ParsedCsv): string {
  if (header.length === 0 && rows.length === 0) return "";
  const records = [header, ...rows];
  return `${records.map((record) => record.map(escapeCsvField).join(",")).join("\n")}\n`;
}
