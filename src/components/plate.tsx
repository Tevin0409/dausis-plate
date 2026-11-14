// The plate (DESIGN.md "Plate"): a teal ring at 13.5% inset, a white rim, then the centre. Without a
// photo the centre is one of four tints with the brand's fork and spoon, never initials.

// Tint and the mark drawn on it: white only shows on pink; the pale tints take their own ink.
const TINTS = [
  { bg: "#e99d99", mark: "#ffffff" },
  { bg: "#f3d3cf", mark: "#b4474b" },
  { bg: "#e6f6f5", mark: "#006b66" },
  { bg: "#fef3c7", mark: "#b45309" },
];

function tint(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length]!;
}

export function Plate({
  id,
  photo,
  size,
  dim = false,
  className = "",
}: {
  id: string;
  photo: string | null;
  /** Pixels; omit to size it with `className` (responsive sizes). */
  size?: number;
  dim?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`${/\babsolute\b/.test(className) ? "" : "relative"} block shrink-0 rounded-full bg-teal ${dim ? "opacity-55 grayscale" : ""} ${className}`}
      style={size ? { width: size, height: size } : undefined}
    >
      <span className="absolute inset-[13.5%] rounded-full bg-paper" />
      <span className="absolute inset-[17%] overflow-hidden rounded-full" style={{ background: tint(id).bg }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a thumbnail inside a ring; next/image adds nothing here
          <img src={photo} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <svg viewBox="0 0 130 130" className="size-full">
            <g transform="translate(-35,-35)" fill={tint(id).mark}>
              <path d="M71 46h4v28h3.2V46h4v28h3.2V46h4v28h3.2V46h4v30c0 7-4 12-9 14v104a3.6 3.6 0 0 1-7.2 0V90c-5-2-9-7-9-14z" />
              <path d="M118 44c8.5 0 14 10 14 23 0 11-5 19-10.4 22v105a3.6 3.6 0 0 1-7.2 0V89C109 86 104 78 104 67c0-13 5.5-23 14-23z" />
            </g>
          </svg>
        )}
      </span>
    </span>
  );
}
