import type { ReactNode } from "react";

// A run of Spanish: words with the spaces, commas and slashes between them, so lists like
// "soy, eres, es" stay in order inside Hebrew text. Trailing ?!. belong to the run only for
// Spanish-style sentences that open with ¿ or ¡ (and a "." to multi-word phrases); otherwise they end the Hebrew sentence.
const L = "A-Za-zÀ-ÖØ-öø-ÿ";
const LATIN = new RegExp(`([¿¡]?[${L}](?:[${L}'’\\-/ ,.…]*[${L}])?[?!.]?)`, "g");

function latin(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(LATIN)) {
    const start = m.index ?? 0;
    let val = m[0].trimEnd();
    // keep a closing "." on multi-word Spanish phrases ("soy, eres, es."), drop ?!. after single words
    if (!/^[¿¡]/.test(val) && !(/\.$/.test(val) && /[ ,]/.test(val))) val = val.replace(/[?!.]$/, "");
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <span lang="es" key={`${keyBase}-${i++}`}>
        {val}
      </span>,
    );
    last = start + val.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Renders Hebrew text with **bold** and Spanish runs set in the Spanish face. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{latin(p.slice(2, -2), `b${i}`)}</strong> : <span key={i}>{latin(p, `t${i}`)}</span>,
      )}
    </>
  );
}
