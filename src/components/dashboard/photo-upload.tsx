"use client";
import { useRef, useState } from "react";
import { photoUrl } from "@/lib/photos";

type Props = { name: string; initialKey: string | null };

/** Uploads straight to R2 with a presigned URL, then stores the key in a hidden input for the form. */
export function PhotoUpload({ name, initialKey }: Props) {
  const [key, setKey] = useState<string | null>(initialKey);
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const preview = photoUrl(key, 640);

  async function upload(file: File) {
    setState("uploading");
    setMessage(null);
    try {
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      });
      const data: { key?: string; url?: string; error?: string } = await res.json();
      if (!res.ok || !data.key || !data.url) throw new Error(data.error ?? "Upload failed");
      const put = await fetch(data.url, { method: "PUT", headers: { "content-type": file.type }, body: file });
      if (!put.ok) throw new Error("Upload failed, check your connection and try again");
      setKey(data.key);
      setState("idle");
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Upload failed");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">Photo</span>
      <input type="hidden" name={name} value={key ?? ""} />
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="relative flex h-40 flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-[#9aa5b4] bg-[#f8fafc] font-semibold text-teal-deep"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Dish photo" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            <span>{state === "uploading" ? "Uploading…" : "Take a photo or upload"}</span>
            <span className="text-[13px] font-normal text-ink-soft">Natural light by the window works best</span>
          </>
        )}
        {preview && (
          <span className="absolute bottom-2 right-2 rounded-full bg-white px-3 py-1 text-sm">
            {state === "uploading" ? "Uploading…" : "Change photo"}
          </span>
        )}
      </button>
      {message && <p role="alert" className="text-sm text-coral-ink">{message}</p>}
    </div>
  );
}
