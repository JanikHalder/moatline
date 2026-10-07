import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The mark: a shield guarding a package (or container) — security for what
 * you ship. Same drawing as public/logo.svg and the one-click templates.
 */
export function Logo({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-8 shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#0b1220" />
      <path
        d="M32 7 51 14v14.5c0 12-8 22.3-19 26.5C21 50.8 13 40.5 13 28.5V14z"
        fill={`url(#${id})`}
      />
      <path d="M32 18.5 42.5 24.3 32 30.1 21.5 24.3z" fill="#fff" />
      <path
        d="M21.5 24.3 32 30.1v12.4l-10.5-5.8z"
        fill="#fff"
        fillOpacity=".72"
      />
      <path d="M32 30.1 42.5 24.3v12.4L32 42.5z" fill="#fff" fillOpacity=".5" />
    </svg>
  );
}
