import { supabaseAdmin } from "@/lib/supabaseServer";
import { NextResponse } from "next/server";

const CASHFREE_BASE =
  process.env.CASHFREE_ENV === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";

type Body = {
  amount?: string;
  currency?: string;
  team_id: string;
  customer_id?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  return_url?: string;
};

export async function POST(request: Request) {
  try {
    const body: Body = (await request.json()) || {};

    const {
      amount = "1.00",
      currency = "INR",
      team_id,
      customer_id = `cust_${Date.now()}`,
      customer_name = "",
      customer_email = "",
      customer_phone = "",
      return_url = `${process.env.NEXT_PUBLIC_BASE_URL}/order-result`,
    } = body;

    const payload = {
      order_amount: amount,
      order_currency: currency,
      customer_details: {
        customer_id,
        customer_name,
        customer_email,
        customer_phone,
      },
      order_meta: { return_url },
    };

    const res = await fetch(`${CASHFREE_BASE}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-version": process.env.CASHFREE_API_VERSION || "2023-08-01",
        "x-client-id": process.env.CASHFREE_CLIENT_ID || "",
        "x-client-secret": process.env.CASHFREE_CLIENT_SECRET || "",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Cashfree create order error:", data);
      return NextResponse.json({ ok: false, error: data }, { status: 500 });
    }

    const orderId = data.order_id;
    const paymentSessionId = data.payment_session_id;

    const { error: InsertErr } = await supabaseAdmin
      .from("payments")
      .insert({
        team_id,
        order_id: orderId,
        payment_session_id: paymentSessionId,
        amount: amount,
        currency,
        status: data.order_status,
        raw_payload: data
      })
      .select();

    if (InsertErr) {
      console.error("Supabase insert error:", InsertErr);
      return NextResponse.json({ ok: false, error: InsertErr.message }, { status: 500 });
    }

    const { error: TeamErr } = await supabaseAdmin
      .from("teams")
      .update({ payment_status: "Pending" })
      .eq("team_id", team_id);

    if (TeamErr) {
      console.error("Supabase update team error:", TeamErr);
      return NextResponse.json({ ok: false, error: TeamErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    console.error("create-order error", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
