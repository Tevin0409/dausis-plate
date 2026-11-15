"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useReportRefusal } from "@/components/dashboard/refusal-note";
import { saveKitchenAddress } from "./actions";
import { btnPrimary, errorText, field, hint, tile, tileHeading } from "./ui";

/**
 * 2.8 (orch.lead 2026-11-14): the pickup address and its directions link. Customers see them in the
 * menu's band and rail, and on pickup and dine-in order pages. Same shape as the phone card.
 */
export function AddressCard({ initial }: { initial: { address: string; mapsUrl: string } }) {
  const [saved, setSaved] = useState(initial);
  const [address, setAddress] = useState(initial.address);
  const [mapsUrl, setMapsUrl] = useState(initial.mapsUrl);
  const [error, setError] = useState<{ text: string; field: "address" | "maps" | null } | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const reportRefusal = useReportRefusal();
  const id = useId();
  const addressRef = useRef<HTMLInputElement>(null);
  const mapsRef = useRef<HTMLInputElement>(null);

  const changed = address.trim() !== saved.address || mapsUrl.trim() !== saved.mapsUrl;
  const clear = () => (setError(null), setDone(false));

  function save(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    const a = address.trim();
    const m = mapsUrl.trim();
    // The database checks the same; saying it here saves a round trip.
    if (m && !/^https:\/\/\S+$/i.test(m)) {
      setError({ text: "Paste a maps link that starts with https://", field: "maps" });
      mapsRef.current?.focus();
      return;
    }
    setError(null);
    start(async () => {
      const res = await saveKitchenAddress(a, m).catch(() => null);
      if (!res?.ok) {
        const line = res && !res.ok ? res.error : "Couldn’t save. The address hasn’t changed. Try again.";
        const f = line.startsWith("Paste a maps link") ? "maps" : line.startsWith("Keep the address") ? "address" : null;
        setError({ text: line, field: f });
        if (res && !res.ok && res.stale) setTimeout(() => reportRefusal(line), 3000);
        (f === "maps" ? mapsRef : addressRef).current?.focus();
        return;
      }
      setSaved({ address: a, mapsUrl: m });
      setAddress(a);
      setMapsUrl(m);
      setDone(true);
    });
  }

  return (
    <section aria-labelledby={`${id}-h`} className={tile}>
      <h2 id={`${id}-h`} className={tileHeading}>
        Kitchen address
      </h2>
      <p id={`${id}-hint`} className={`${hint} mt-1`}>
        Customers see it on the menu and on pickup and dine-in orders, with a Directions link.
      </p>

      <form onSubmit={save} noValidate className="mt-4 flex flex-col gap-3">
        <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold text-ink-soft">
          Address
          <input
            ref={addressRef}
            autoComplete="street-address"
            maxLength={200}
            placeholder="Argwings Kodhek Rd, Kilimani, Nairobi"
            value={address}
            onChange={(e) => (clear(), setAddress(e.target.value))}
            aria-invalid={error?.field === "address" ? true : undefined}
            aria-describedby={error?.field === "address" ? `${id}-err ${id}-hint` : `${id}-hint`}
            className={field}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold text-ink-soft">
          <span>
            Maps link <span className="font-normal">(optional)</span>
          </span>
          <input
            ref={mapsRef}
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={500}
            placeholder="https://maps.app.goo.gl/…"
            value={mapsUrl}
            onChange={(e) => (clear(), setMapsUrl(e.target.value))}
            aria-invalid={error?.field === "maps" ? true : undefined}
            aria-describedby={error?.field === "maps" ? `${id}-err ${id}-maps-hint` : `${id}-maps-hint`}
            className={field}
          />
          <span id={`${id}-maps-hint`} className="font-normal">
            In Google Maps, open the kitchen, press Share and copy the link.
          </span>
        </label>
        <button type="submit" disabled={!changed || pending} className={`${btnPrimary} min-[480px]:self-start`}>
          {pending ? "Saving…" : "Save"}
        </button>
      </form>

      {error && (
        <p key={error.text} id={`${id}-err`} role="alert" className={`${errorText} mt-2`}>
          {error.text}
        </p>
      )}
      <div role="status" aria-live="polite">
        {done && !changed && (
          <p className="note-in mt-2 text-[15px] font-semibold text-teal-deeper">
            {saved.address ? "Saved. Customers see it on the menu and their order page." : "Removed. Customers see no address."}
          </p>
        )}
      </div>
    </section>
  );
}
