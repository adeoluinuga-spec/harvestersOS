import { cn } from "@/lib/utils";

/**
 * Tiny inline trend — pure SVG, no chart library, renders on the server.
 * For KPI cards and table rows; detailed charts stay in Recharts.
 */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  className,
  strokeClassName = "stroke-cobalt",
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  strokeClassName?: string;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const step = (width - pad * 2) / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = pad + i * step;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={strokeClassName}
      />
    </svg>
  );
}
