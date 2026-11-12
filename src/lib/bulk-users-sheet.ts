import * as XLSX from "xlsx";

export type BulkUserRow = {
  row: number;
  userId: string;
  password: string;
  isAdmin: boolean;
  contactEmail: string | null;
  workspaceFlags: Map<string, boolean>;
};

const USER_ID_HEADERS = new Set(["user_id", "userid", "login", "login_id"]);
const CONTACT_HEADERS = new Set(["contact_email", "contactemail"]);
const PASSWORD_HEADERS = new Set(["password", "pwd"]);
const ADMIN_HEADERS = new Set(["is_admin", "isadmin", "admin"]);

function normHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function isTruthyCell(v: unknown): boolean {
  if (typeof v === "number") return v === 1;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "y";
  }
  return false;
}

export function workbookToBytes(book: XLSX.WorkBook): Uint8Array {
  const out = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const copy = new Uint8Array(out.byteLength);
  copy.set(out);
  return copy;
}

export function buildUsersTemplate(workspaceNames: string[]): Uint8Array {
  const headers = ["user_id", "contact_email", "password", "is_admin", ...workspaceNames];
  const sample = ["new.user", "", "Password@123", "0", ...workspaceNames.map(() => "0")];
  const sheet = XLSX.utils.aoa_to_sheet([headers, sample]);
  sheet["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "users");
  return workbookToBytes(book);
}

export function parseUsersSheet(data: ArrayBuffer | Buffer): BulkUserRow[] {
  let wb: XLSX.WorkBook;
  const bytes = data instanceof ArrayBuffer ? Buffer.from(new Uint8Array(data)) : data;
  try {
    wb = XLSX.read(bytes, { type: "buffer" });
  } catch {
    throw new Error("Could not read that Excel file. Download a fresh template, fill it, and upload the .xlsx file.");
  }
  const first = wb.SheetNames[0];
  if (!first) throw new Error("Excel file is empty.");
  const ws = wb.Sheets[first];
  if (!ws) throw new Error("Excel file is empty.");

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  if (matrix.length === 0) throw new Error("No rows found in sheet.");

  let headerIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const row = matrix[i] ?? [];
    if (row.some((cell) => USER_ID_HEADERS.has(normHeader(cell)))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error("Could not find a user_id column. Keep the header row from the template.");
  }

  const headers = (matrix[headerIdx] ?? []).map((cell) => normHeader(cell));
  const userCol = headers.findIndex((h) => USER_ID_HEADERS.has(h));
  const contactCol = headers.findIndex((h) => CONTACT_HEADERS.has(h));
  const passwordCol = headers.findIndex((h) => PASSWORD_HEADERS.has(h));
  const adminCol = headers.findIndex((h) => ADMIN_HEADERS.has(h));
  if (userCol < 0 || passwordCol < 0) {
    throw new Error("The sheet needs user_id and password columns. Download a fresh template.");
  }

  const reserved = new Set<number>([userCol, passwordCol]);
  if (contactCol >= 0) reserved.add(contactCol);
  if (adminCol >= 0) reserved.add(adminCol);

  const rows: BulkUserRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    const userId = String(cells[userCol] ?? "").trim().toLowerCase();
    const password = String(cells[passwordCol] ?? "");
    const contactRaw = contactCol >= 0 ? String(cells[contactCol] ?? "").trim().toLowerCase() : "";
    const isAdmin = adminCol >= 0 ? isTruthyCell(cells[adminCol]) : false;
    const workspaceFlags = new Map<string, boolean>();
    headers.forEach((header, col) => {
      if (!header || reserved.has(col)) return;
      workspaceFlags.set(header, isTruthyCell(cells[col]));
    });
    const blank =
      !userId &&
      !password.trim() &&
      !contactRaw &&
      !isAdmin &&
      ![...workspaceFlags.values()].some(Boolean);
    if (blank) continue;
    rows.push({
      row: i + 1,
      userId,
      password,
      isAdmin,
      contactEmail: contactRaw || null,
      workspaceFlags,
    });
  }

  if (rows.length === 0) throw new Error("No user rows found under the header.");
  return rows;
}
