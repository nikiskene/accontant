import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const expected = Deno.env.get("BOOKINGCAL_INTEGRATION_SECRET") || "";
    if (!expected || request.headers.get("x-bookingcal-secret") !== expected)
      return json({ error: "Unauthorized" }, 401);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const payload = await request.json();

    if (payload.action === "create") {
      const result = await db
        .from("bookingcal_payments")
        .insert(payload.row)
        .select("*")
        .single();
      if (result.error) throw result.error;
      return json(result.data);
    }

    if (payload.action === "by_id" || payload.action === "by_session") {
      const column = payload.action === "by_id" ? "id" : "stripe_session_id";
      const result = await db
        .from("bookingcal_payments")
        .select("*")
        .eq(column, String(payload.id || ""))
        .maybeSingle();
      if (result.error) throw result.error;
      return json(result.data);
    }

    if (payload.action === "update") {
      const allowed = [
        "status",
        "stripe_session_id",
        "stripe_payment_intent_id",
        "event_id",
        "manage_url",
        "invoice_id",
        "error",
      ];
      const values = Object.fromEntries(
        Object.entries(payload.values || {}).filter(([key]) => allowed.includes(key)),
      );
      const result = await db
        .from("bookingcal_payments")
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq("id", String(payload.id || ""))
        .select("id")
        .single();
      if (result.error) throw result.error;
      return json({ ok: true });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
});
