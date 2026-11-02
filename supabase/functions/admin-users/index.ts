// User management for the app owner: list, add, reset password, set daily voice minutes.
// Authentication is checked inside the function (works with any JWT signing key type).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: me } = await admin.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) return json({ error: "forbidden" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const action = String(body.action ?? "");

  if (action === "list") {
    const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return json({ error: "list_failed" }, 500);
    const { data: profiles } = await admin.from("profiles").select("id, display_name, gender, xp, voice_daily_minutes, is_admin");
    const { data: days } = await admin.from("activity_days").select("user_id, day").order("day", { ascending: false });
    const lastDay = new Map<string, string>();
    for (const d of days ?? []) if (!lastDay.has(d.user_id)) lastDay.set(d.user_id, d.day);
    const users = list.users.map((u) => {
      const p = profiles?.find((x) => x.id === u.id);
      return {
        id: u.id,
        email: u.email,
        display_name: p?.display_name ?? "",
        gender: p?.gender ?? "m",
        xp: p?.xp ?? 0,
        voice_daily_minutes: p?.voice_daily_minutes ?? 20,
        is_admin: p?.is_admin ?? false,
        last_active: lastDay.get(u.id) ?? null,
        last_sign_in: u.last_sign_in_at ?? null,
      };
    });
    return json({ users });
  }

  if (action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const display_name = String(body.display_name ?? "").trim().slice(0, 40);
    const gender = body.gender === "f" ? "f" : "m";
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "bad_email" }, 400);
    if (password.length < 8) return json({ error: "short_password" }, 400);
    await admin.from("invites").upsert({ email });
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { display_name, gender },
    });
    if (error) return json({ error: error.message.includes("already") ? "email_exists" : "create_failed" }, 400);
    return json({ id: data.user.id });
  }

  if (action === "set_password") {
    const id = String(body.userId ?? "");
    const password = String(body.password ?? "");
    if (password.length < 8) return json({ error: "short_password" }, 400);
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return json({ error: "update_failed" }, 400);
    return json({ ok: true });
  }

  if (action === "set_voice_minutes") {
    const id = String(body.userId ?? "");
    const minutes = Math.round(Number(body.minutes));
    if (!(minutes >= 0 && minutes <= 240)) return json({ error: "bad_minutes" }, 400);
    const { error } = await admin.from("profiles").update({ voice_daily_minutes: minutes }).eq("id", id);
    if (error) return json({ error: "update_failed" }, 400);
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});
