// The database keeps a dish name to 80 characters, as the dish editor does (step 3 break-ui #2,
// migration 20261116100500_dish_name_length.sql).
import { describe, expect, test } from "bun:test";
import { inTx } from "./helpers";

async function refusal(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { errno?: string; code?: string; constraint?: string };
    return { code: err.errno ?? err.code, constraint: err.constraint };
  }
}

describe("dish names", () => {
  test("80 characters are kept; 81 are refused on insert and on rename", () =>
    inTx(async (tx) => {
      // 80 characters, accents included: char_length counts characters, not bytes.
      const eighty = "Mukimo ya Mama Dausi é".padEnd(80, "x");
      const [d] = await tx`insert into public.dishes (name, price_kes) values (${eighty}, 500) returning id, name`;
      expect(d.name).toBe(eighty);
      const insert = await refusal(
        tx.savepoint((sp) => sp`insert into public.dishes (name, price_kes) values (${eighty + "y"}, 500)`),
      );
      expect(insert?.code).toBe("23514");
      const rename = await refusal(tx.savepoint((sp) => sp`update public.dishes set name = ${eighty + "y"} where id = ${d.id}`));
      expect(rename?.code).toBe("23514");
    }));
});
