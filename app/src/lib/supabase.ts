import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://qzyzmvcwnfkpadrqgkzr.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_N0T4w_-nd2yf0xImmDIGNw_eiaLsyYB";

export const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

/** Calls an edge function and returns parsed JSON plus HTTP status, without throwing. */
export async function callFunction<T = Record<string, unknown>>(
  name: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) return { ok: false, status: 401, data: null };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
