import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const text = (value: unknown, max = 500) =>
  String(value ?? "")
    .trim()
    .slice(0, max);

Deno.serve(async (request) => {
  try {
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    const expected = Deno.env.get("BOOKINGCAL_INTEGRATION_SECRET") || "";
    if (!expected || request.headers.get("x-bookingcal-secret") !== expected)
      return json({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, key);
    const p = await request.json();
    const bookingId = text(p.booking_id, 200),
      sessionId = text(p.stripe_checkout_session_id, 200);
    if (!bookingId || !sessionId)
      return json(
        { error: "Booking and Stripe session IDs are required" },
        400,
      );
    const existing = await db
      .from("booking_invoice_imports")
      .select("invoice_id,payment_id")
      .eq("external_booking_id", bookingId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return json({ ...existing.data, duplicate: true });

    const workspaceId = text(p.workspace_id, 50),
      productId = text(p.product_service_id, 50),
      vatId = text(p.vat_code_id, 50);
    const [workspaceResult, productResult, vatResult] = await Promise.all([
      db
        .from("workspaces")
        .select("id,base_currency")
        .eq("id", workspaceId)
        .single(),
      db
        .from("products_services")
        .select("id,name,description,unit,currency,revenue_account_id")
        .eq("id", productId)
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .single(),
      db
        .from("vat_codes")
        .select("id,vat_rate")
        .eq("id", vatId)
        .eq("workspace_id", workspaceId)
        .in("applies_to", ["sales", "both"])
        .single(),
    ]);
    if (workspaceResult.error || productResult.error || vatResult.error)
      throw new Error("Invalid accounting company, product, or VAT code");
    const currency = text(p.currency, 3).toUpperCase(),
      gross = Number(p.gross_amount);
    if (
      currency !== productResult.data.currency ||
      !Number.isFinite(gross) ||
      gross <= 0
    )
      throw new Error("Payment currency or amount is invalid");
    const rate = Number(vatResult.data.vat_rate),
      net = Math.round((gross / (1 + rate)) * 100) / 100,
      tax = Math.round((gross - net) * 100) / 100;
    const customer = p.customer || {},
      email = text(customer.email, 320).toLowerCase(),
      name = text(customer.company_name || customer.name, 200);
    if (!email || !name)
      throw new Error("Customer name and billing email are required");
    let customerQuery = db
      .from("counterparties")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("kind", ["customer", "both"])
      .eq("email_lc", email);
    const vatNumber = text(customer.vat_number, 80);
    if (vatNumber) customerQuery = customerQuery.eq("vat_trn", vatNumber);
    const found = await customerQuery
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (found.error) throw found.error;
    let customerId = found.data?.id;
    if (!customerId) {
      const created = await db
        .from("counterparties")
        .insert({
          workspace_id: workspaceId,
          kind: "customer",
          company_name: name,
          alias: text(customer.name || name, 200),
          email,
          street_address: text(customer.address, 300) || null,
          zip: text(customer.postal_code, 40) || null,
          city: text(customer.city, 100) || null,
          state: text(customer.state, 100) || null,
          country: text(customer.country, 100) || null,
          vat_trn: vatNumber || null,
        })
        .select("id")
        .single();
      if (created.error) throw created.error;
      customerId = created.data.id;
    }
    const template = await db
      .from("document_templates")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("document_type", "invoice")
      .eq("is_default", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (template.error) throw template.error;
    const today = new Date().toISOString().slice(0, 10),
      serviceDate = text(p.service_date, 200) || null;
    const document = await db
      .from("sales_documents")
      .insert({
        workspace_id: workspaceId,
        document_type: "invoice",
        customer_id: customerId,
        template_id: template.data?.id || null,
        issue_date: today,
        due_date: today,
        service_date: serviceDate,
        currency,
        status: "draft",
        header_text: `BookingCal booking ${bookingId}`,
        terms_text: "Paid online via Stripe",
        notes:
          "Automatically prepared from a paid BookingCal booking. Review before issuing.",
        subtotal: net,
        tax_total: tax,
        total: gross,
        amount_paid: gross,
      })
      .select("id")
      .single();
    if (document.error) throw document.error;
    const invoiceId = document.data.id;
    const line = await db
      .from("sales_document_lines")
      .insert({
        workspace_id: workspaceId,
        document_id: invoiceId,
        line_no: 1,
        product_service_id: productId,
        description:
          text(p.description, 500) ||
          productResult.data.description ||
          productResult.data.name,
        quantity: 1,
        unit: productResult.data.unit || "each",
        unit_price: net,
        discount_percent: 0,
        vat_code_id: vatId,
        vat_rate: rate,
        net_amount: net,
        vat_amount: tax,
        gross_amount: gross,
        revenue_account_id: productResult.data.revenue_account_id,
      });
    if (line.error) throw line.error;
    const payment = await db
      .from("customer_payments")
      .insert({
        workspace_id: workspaceId,
        customer_id: customerId,
        payment_date: today,
        amount: gross,
        currency,
        reference: `Stripe ${sessionId}`,
      })
      .select("id")
      .single();
    if (payment.error) throw payment.error;
    const paymentId = payment.data.id;
    const allocation = await db
      .from("payment_allocations")
      .insert({
        workspace_id: workspaceId,
        payment_id: paymentId,
        invoice_id: invoiceId,
        amount: gross,
      });
    if (allocation.error) throw allocation.error;
    const imported = await db
      .from("booking_invoice_imports")
      .insert({
        workspace_id: workspaceId,
        external_booking_id: bookingId,
        stripe_checkout_session_id: sessionId,
        stripe_payment_intent_id: text(p.stripe_payment_intent_id, 200) || null,
        invoice_id: invoiceId,
        payment_id: paymentId,
        gross_amount: gross,
        currency,
      });
    if (imported.error) throw imported.error;
    await db
      .from("audit_events")
      .insert({
        workspace_id: workspaceId,
        entity_type: "invoice",
        entity_id: invoiceId,
        action: "paid_booking_draft_created",
        details: {
          booking_id: bookingId,
          stripe_checkout_session_id: sessionId,
        },
      });
    return json({
      invoice_id: invoiceId,
      payment_id: paymentId,
      duplicate: false,
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
});
