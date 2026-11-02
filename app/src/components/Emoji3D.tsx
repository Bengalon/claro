import { useState } from "react";

export function emojiKey(e: string) {
  return [...e]
    .map((c) => c.codePointAt(0)!.toString(16))
    .filter((h) => h !== "fe0f")
    .join("-");
}

interface Props {
  emoji: string;
  size?: number;
  className?: string;
  eager?: boolean;
  label?: string;
}

/** Glossy 3D illustration for an emoji, falling back to the device emoji if the image is missing. */
export function Emoji3D({ emoji, size = 64, className, eager, label }: Props) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className={className}
        style={{ fontSize: size * 0.78, lineHeight: 1, width: size, height: size, display: "inline-grid", placeItems: "center" }}
      >
        {emoji}
      </span>
    );
  }
  return (
    <img
      src={`/emoji/${emojiKey(emoji)}.webp`}
      width={size}
      height={size}
      alt={label ?? ""}
      draggable={false}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={className}
      style={{ width: size, height: size, objectFit: "contain", userSelect: "none" }}
      onError={() => setFailed(true)}
    />
  );
}
