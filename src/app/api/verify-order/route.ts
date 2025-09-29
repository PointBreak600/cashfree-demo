import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

const CASHFREE_BASE = process.env.CASHFREE_ENV === "production"
  ? "https://api.cashfree.com/pg"
  : "https://sandbox.cashfree.com/pg";

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const order_id = url.searchParams.get("order_id");
        if (!order_id) {
            return NextResponse.json({ ok: false, error: "Missing order_id" }, { status: 400 });
        }

        const res = await fetch(`${CASHFREE_BASE}/orders/${encodeURIComponent(order_id)}`, {
            method: "GET",
            headers: {
                "x-api-version": process.env.CASHFREE_API_VERSION || "2023-08-01",
                "x-client-id": process.env.CASHFREE_CLIENT_ID || "",
                "x-client-secret": process.env.CASHFREE_CLIENT_SECRET || "",
            }
        });

        const data = await res.json();
        if (!res.ok) {
            console.error("Cashfree get order error:", data);
            return NextResponse.json({ ok: false, error: data }, { status: 500 });
        }

        const orderStatus = data.order_status;
        const txnId = data.transaction_id;

        const { error: updateErr } = await supabaseAdmin
            .from("payments")
            .update({
                status: orderStatus === "PAID" ? "PAID" : orderStatus.toUpperCase(),
                transaction_id: txnId,
                raw_payload: data,
                updated_at: new Date().toISOString(),
            })
            .eq("order_id", order_id);

        if (updateErr) {
            console.error("Error updating payment record:", updateErr);
        }

        if (orderStatus === "PAID") {
            const { data: paymentRows, error: selErr } = await supabaseAdmin
                .from("payments")
                .select("team_id")
                .eq("order_id", order_id)
                .limit(1)
                .maybeSingle();
            
            if (selErr) {
                console.error("Error fetching payment record:", selErr);
            } else if (paymentRows?.team_id) {
                const { error: teamErr } = await supabaseAdmin
                    .from("teams")
                    .update({ payment_status: "PAID" })
                    .eq("team_id", paymentRows.team_id);
                
                if (teamErr) {
                    console.error("Error updating team payment status:", teamErr);
                }
            }
        }

        return NextResponse.json({ ok: true, order: data });
    } catch (error: any) {
        console.error("Error verifying order:", error);
        return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 });
    }
}