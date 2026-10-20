"use client";
import { useEffect, useRef, useState } from "react";
import { optimisePhoto } from "@/lib/image-compress";

type Props = { initialUrl: string | null };

type Upload = { name: "full" | "thumb"; key: string; url: string };

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/**
 * Optimises the photo in the browser (WebP, 1600px + 480px), uploads both straight to R2
 * with presigned URLs, and hands the keys to the form. The server builds the public URLs.
 */
export function PhotoUpload({ initialUrl }: Props) {
  const [keys, setKeys] = useState<{ full: string; thumb: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(initialUrl);
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function handle(file: File) {
    setState("working");
    setMessage("Optimising…");
    try {
      const variants = await optimisePhoto(file);
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variants: variants.map((v) => ({ name: v.name, contentType: v.blob.type, size: v.blob.size })) }),
      });
      const data: { uploads?: Upload[]; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !data.uploads) {
        throw new Error(data.error ?? (res.status === 401 ? "Your session expired. Sign in again." : `Upload couldn’t start (server error ${res.status}).`));
      }

      setMessage("Uploading…");
      await Promise.all(
        data.uploads.map(async (u) => {
          const blob = variants.find((v) => v.name === u.name)?.blob;
          if (!blob) throw new Error("Upload failed");
          let put: Response;
          try {
            put = await fetch(u.url, { method: "PUT", headers: { "content-type": blob.type }, body: blob });
          } catch {
            // The browser blocks the response when the bucket's CORS policy doesn't allow this site.
            throw new Error(`Photo storage refused the upload from ${window.location.origin}. Add it to the R2 bucket’s CORS policy.`);
          }
          if (!put.ok) {
            const body = await put.text().catch(() => "");
            const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
            throw new Error(`Photo storage rejected the upload (${put.status}${code ? ` ${code}` : ""}). Check the R2 API token and bucket name.`);
          }
        }),
      );

      const full = data.uploads.find((u) => u.name === "full");
      const thumb = data.uploads.find((u) => u.name === "thumb");
      if (!full || !thumb) throw new Error("Upload failed");
      const fullBlob = variants.find((v) => v.name === "full")?.blob;
      setKeys({ full: full.key, thumb: thumb.key });
      if (fullBlob) setPreview(URL.createObjectURL(fullBlob));
      setState("idle");
      setMessage(`Optimised ${kb(file.size)} → ${kb(fullBlob?.size ?? 0)}. Save the dish to keep it.`);
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Upload failed");
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">Photo</span>
      <input type="hidden" name="photo_key" value={keys?.full ?? ""} />
      <input type="hidden" name="photo_thumb_key" value={keys?.thumb ?? ""} />
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Choose a dish photo"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handle(file);
        }}
      />
      <button
        type="button"
        disabled={state === "working"}
        onClick={() => input.current?.click()}
        className="relative flex h-44 flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-[#9aa5b4] bg-[#f8fafc] font-semibold text-teal-deep"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Dish photo" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            <span>Take a photo or upload</span>
            <span className="text-[13px] font-normal text-ink-soft">Natural light by the window works best</span>
          </>
        )}
        {preview && (
          <span className="absolute bottom-2 right-2 rounded-full bg-white px-3 py-1 text-sm">
            {state === "working" ? message : "Change photo"}
          </span>
        )}
        {!preview && state === "working" && <span className="text-sm font-normal text-ink-soft">{message}</span>}
      </button>
      {message && state !== "working" && (
        <p role={state === "error" ? "alert" : "status"} className={`text-sm ${state === "error" ? "text-coral-ink" : "text-ink-soft"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
