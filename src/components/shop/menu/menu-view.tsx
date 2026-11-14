"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ClockIcon } from "@/components/icons";
import type { MenuModel, MenuSection } from "@/lib/menu-model";
import type { WaiterStatus } from "@/lib/table-requests";
import { useCart } from "../cart-provider";
import { useKitchen } from "../kitchen-provider";
import { OrderPanel } from "../order-panel";
import { CartBar } from "../ui";
import { MenuBand } from "./band";
import { DishRow, DishTile } from "./dish-cards";
import { QrNotice } from "./qr-notice";
import { focusReturnedRow, leftMenu } from "./return-to";
import { JumpBar, type NavSection, Rail } from "./section-nav";

type Props = { model: MenuModel; address: string | null; zones: string[]; soldOutLine: string; qrUnknown?: boolean; waiter?: WaiterStatus };

function Section({ section, model, soldOutLine }: { section: MenuSection; model: MenuModel; soldOutLine: string }) {
  const tiles = section.id === "today" || section.id === "week";
  const head = `head-${section.id}`;
  return (
    <section id={section.id} aria-labelledby={head} className="scroll-mt-[68px] pt-7 lg:scroll-mt-4">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-5 lg:px-0">
        <h2 id={head} className="font-display text-[26px] leading-tight">{section.head}</h2>
        {section.aside && <span className="flex-none text-[13px] font-semibold text-ink-soft">{section.aside}</span>}
      </div>
      {tiles ? (
        <div className="flex flex-col gap-4 px-4 lg:px-0">
          {section.dishes.map((d, i) => (
            <DishTile key={d.key} dish={d} open={model.open} day={model.dayName} index={i} soldOutLine={soldOutLine} />
          ))}
        </div>
      ) : (
        <ul className="mx-4 divide-y divide-sand overflow-hidden rounded-[var(--r-lg)] bg-paper shadow-[var(--shadow-card)] lg:mx-0">
          {section.dishes.map((d) => (
            <DishRow key={d.key} dish={d} open={model.open} day={model.dayName} soldOutLine={soldOutLine} />
          ))}
        </ul>
      )}
    </section>
  );
}

type FrameProps = {
  model: MenuModel;
  address: string | null;
  zones: string[];
  onMenu: boolean;
  /** The menu page only: the table's latest waiter call (spec-2.9). Undefined: no Call waiter button. */
  waiter?: WaiterStatus;
  children: React.ReactNode;
};

/**
 * The page's shape from lg: band, then rail | middle | order panel (spec-2.8 "Page grid"). The dish
 * page keeps it, so the page doesn't jump when a dish opens. Below lg: the phone column.
 */
export function MenuFrame({ model, address, zones, onMenu, waiter, children }: FrameProps) {
  const nav: NavSection[] = model.sections.map((s) => ({ id: s.id, label: s.rail, count: s.dishes.length }));
  return (
    <>
      <div className={onMenu ? "" : "hidden lg:block"}>
        <MenuBand dayName={model.dayName} address={address} zones={zones} waiter={waiter} />
      </div>
      {onMenu && <JumpBar sections={nav} />}
      <div
        className={`mx-auto max-w-[430px] lg:grid lg:max-w-[1264px] lg:grid-cols-[184px_minmax(0,1fr)_340px] lg:gap-7 lg:px-8 lg:pb-[120px] ${
          onMenu ? "pb-[calc(112px+env(safe-area-inset-bottom,0px))]" : ""
        }`}
      >
        <Rail sections={nav} address={address} onMenu={onMenu} />
        <main className="min-w-0">{children}</main>
        <OrderPanel />
      </div>
      {onMenu && <CartBar />}
    </>
  );
}

/** The customer menu: phone column (jump bar, cart bar) and, from lg, the rail and the order panel. */
export function MenuView({ model, address, zones, soldOutLine, qrUnknown = false, waiter = null }: Props) {
  const router = useRouter();
  const { open } = useKitchen();
  const { recheck } = useCart();

  // The kitchen opened or closed while the page was open: the menu's day may have changed.
  useEffect(() => {
    if (open !== model.open) router.refresh();
  }, [open, model.open, router]);

  // New menu data from the server: check the order against it (skipping the first render,
  // which the cart already checks on load).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void recheck();
  }, [model, recheck]);

  useEffect(() => {
    focusReturnedRow();
    return leftMenu;
  }, []);

  return (
    <MenuFrame model={model} address={address} zones={zones} onMenu waiter={waiter}>
      {qrUnknown && <QrNotice />}
      {model.notPlanned && (
        <p className="mx-4 mt-7 flex gap-3 rounded-[var(--r-lg)] bg-paper p-4 text-[15px] leading-snug text-ink-soft ring-1 ring-sand-deep lg:mx-0">
          <ClockIcon size={20} className="mt-px flex-none text-teal-deep" />
          <span>
            <strong className="font-semibold text-ink">{model.notPlanned.lead}</strong> {model.notPlanned.rest}
          </span>
        </p>
      )}
      {model.sections.map((s) => (
        <Section key={s.id} section={s} model={model} soldOutLine={soldOutLine} />
      ))}
      {model.sections.length === 0 && (
        <p className="mx-4 mt-7 rounded-[var(--r-lg)] bg-paper p-5 text-[15px] text-ink-soft ring-1 ring-sand lg:mx-0">
          Nothing on the menu yet. Check back soon.
        </p>
      )}
    </MenuFrame>
  );
}
