import { z } from "zod";

export const TABLE_COOKIE = "dp_table";

const schema = z.object({ token: z.string().min(1), label: z.string().min(1) });
export type TableCookie = z.infer<typeof schema>;

export function parseTableCookie(raw: string | undefined): TableCookie | null {
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
