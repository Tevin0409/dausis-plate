import { NextResponse, type NextRequest } from "next/server";
import { nairobiToday } from "@/lib/format";
import { fileName, toCsv, zip, type Cell } from "@/lib/reports/csv";
import { netOf } from "@/lib/reports/money";
import { parseReportPeriod } from "@/lib/reports/period";
import { CANCEL_LABEL, MODE_LABEL, PAY_CHOICE_LABEL, hourLabel, minutesLabel, type DishesReport, type SalesReport, type TimesReport, type DeliveryReport } from "@/lib/reports/types";
import { createClient, getStaff } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };
const fail = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers: HEADERS });
const WITH: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", card: "Card", "": "" };
const STATUS: Record<string, string> = { new: "New", preparing: "Preparing", ready: "Ready", on_the_way: "On the way", completed: "Completed", cancelled: "Cancelled" };

/** Owner-only downloads: ?section=orders|credit-notes|sales|dishes|times|delivery, plus the period. */
export async function GET(req: NextRequest) {
  let staff;
  try {
    staff = await getStaff();
  } catch {
    return fail(500, "Couldn’t check you’re signed in.");
  }
  if (!staff) return fail(401, "Sign in again.");
  if (staff.role !== "owner") return fail(403, "Only the owner can do this.");

  const today = nairobiToday();
  const q = req.nextUrl.searchParams;
  const p = parseReportPeriod(q, today);
  const section = q.get("section") ?? "";
  const supabase = await createClient();
  const range = { p_from: p.from, p_to: p.to };

  const send = (name: string, body: BodyInit, type: string) =>
    new NextResponse(body, { headers: { ...HEADERS, "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"` } });
  const csv = (name: string, header: string[], rows: Cell[][]) => send(name, toCsv(header, rows), "text/csv; charset=utf-8");

  try {
    if (section === "orders") {
      const { data, error } = await supabase.rpc("report_orders_csv", range);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Record<string, Cell>[];
      return csv(fileName("orders", p.from, p.to), [
        "Order", "Date", "Time", "Type", "Table or area", "Items", "Subtotal (KSh)", "Delivery fee (KSh)", "Total (KSh)", "Customer chose", "Payment status",
        "Paid with", "Paid on", "Paid at", "Status", "Cancel reason", "Cancel note", "Customer name", "Credit note", "Credit note amount (KSh)",
      ], rows.map((r) => [
        r.code, r.day, r.at_time, MODE_LABEL[String(r.mode)] ?? r.mode, r.place, r.items, r.subtotal_kes, r.fee_kes, r.total_kes,
        PAY_CHOICE_LABEL[String(r.payment_method)] ?? r.payment_method, r.payment_status === "paid" ? "Paid" : "Not paid", WITH[String(r.paid_with)] ?? r.paid_with,
        r.paid_day, r.paid_time, STATUS[String(r.status)] ?? r.status, r.cancel_reason ? (CANCEL_LABEL[String(r.cancel_reason)] ?? r.cancel_reason) : "", r.cancel_note, r.customer_name,
        r.credit_note, r.credit_note_kes,
      ]));
    }
    if (section === "credit-notes") {
      const { data, error } = await supabase.rpc("report_credit_notes_csv", range);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Record<string, Cell>[];
      return csv(fileName("credit-notes", p.from, p.to), [
        "Line", "Credit note", "Date", "Time", "Order", "Order date", "Order total (KSh)", "Amount (KSh)", "Kept (KSh)", "Refunded by", "Reason", "By",
      ], rows.map((r) => [r.line, r.code, r.day, r.at_time, r.order_code, r.order_day, r.order_total_kes, r.amount_kes, r.kept_kes, WITH[String(r.refunded_with)] ?? r.refunded_with, r.reason, r.by_name]));
    }
    if (section === "sales") {
      const { data, error } = await supabase.rpc("report_sales", { ...range, p_cmp_from: null, p_cmp_to: null });
      if (error) throw error;
      const r = data as unknown as SalesReport;
      const grain = r.grain === "day" ? "Day" : r.grain === "week" ? "Week starting" : "Month starting";
      const sales = toCsv([grain, "Orders", "Food (KSh)", "Delivery fees (KSh)", "Sales (KSh)"], r.by_bucket.map((b) => [b.bucket, b.orders, b.food, b.fees, b.sales]));
      const money = toCsv(
        [grain, "Cash (KSh)", "M-Pesa (KSh)", "M-Pesa online (KSh)", "Card (KSh)", "Not recorded (KSh)", "Credit notes (KSh)", "Credit notes voided (KSh)", "Net money in (KSh)"],
        r.money_in.map((m) => [m.bucket, m.cash, m.mpesa, m.mpesa_online, m.card, m.not_recorded, -m.credit_notes, m.credit_notes_voided, netOf(m)]),
      );
      return send(fileName("sales-and-money", p.from, p.to, "zip"), zip([
        { name: fileName("sales", p.from, p.to), content: sales },
        { name: fileName("money-in", p.from, p.to), content: money },
      ]) as BodyInit, "application/zip");
    }
    if (section === "dishes") {
      const { data, error } = await supabase.rpc("report_dishes", range);
      if (error) throw error;
      const r = data as unknown as DishesReport;
      const dishes = toCsv(["Dish", "Plates", "Dish sales (KSh)", "Days on the menu", "Plates per day", "Average plate limit", "Average plates sold on limit days", "Days sold out", "Usual sold-out time", "Rating (stars)", "Ratings"],
        r.dishes.map((d) => [d.name, d.plates, d.revenue, d.days_on, d.per_day, d.limit_avg, d.limit_used_avg, d.sold_out_days, minutesLabel(d.usual_sold_out_minutes) === "—" ? "" : minutesLabel(d.usual_sold_out_minutes), d.rating_count > 0 ? d.rating_avg : "", d.rating_count]));
      const days = toCsv(["Date", "Dish", "Plates", "Plate limit", "Sold out at", "Sold out then back on"],
        r.days.map((d) => [d.day, d.dish, d.plates, d.limit, d.sold_out_minutes === null ? "" : minutesLabel(d.sold_out_minutes), d.back_on ? "Yes" : ""]));
      return send(fileName("dishes", p.from, p.to, "zip"), zip([
        { name: fileName("dishes", p.from, p.to), content: dishes },
        { name: fileName("dishes-by-day", p.from, p.to), content: days },
      ]) as BodyInit, "application/zip");
    }
    if (section === "times") {
      const { data, error } = await supabase.rpc("report_times", range);
      if (error) throw error;
      const r = data as unknown as TimesReport;
      return csv(fileName("busy-times", p.from, p.to), ["Hour", "Orders", "Orders per day"], r.by_hour.map((h) => [hourLabel(h.hour), h.orders, h.per_day]));
    }
    if (section === "delivery") {
      const { data, error } = await supabase.rpc("report_delivery", range);
      if (error) throw error;
      const r = data as unknown as DeliveryReport;
      return csv(fileName("delivery", p.from, p.to), ["Area", "Orders", "Delivery fees (KSh)", "Food (KSh)"], r.zones.map((z) => [z.zone, z.orders, z.fees, z.food]));
    }
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error("[export] failed:", section, err.code ?? "", err.message ?? "");
    if (err.code === "42501") return fail(403, "Only the owner can do this.");
    return fail(500, "Couldn’t make the file.");
  }
  return fail(400, "Unknown download.");
}
