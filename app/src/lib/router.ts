import { useEffect, useState } from "react";

const read = () => (window.location.hash.replace(/^#/, "") || "/").split("?")[0];

export function useRoute(): string {
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => setPath(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return path;
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  const url = `#${path}`;
  if (opts.replace) {
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = path;
  }
  window.scrollTo({ top: 0 });
}

export function back(fallback = "/") {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback, { replace: true });
}
