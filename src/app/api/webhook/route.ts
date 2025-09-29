import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseServer";

function computeSignature(secret: string, timestamp: string, payloadRaw: string) {
    const signed = `${timestamp}.${payloadRaw}`;
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(signed, "utf8");
    return hmac.digest("base64");
}

export async function POST(request: Request) {
    try {
        const raw = await request.text();

        const signature = request.headers.get("x-webhook-signature") || request.headers.get("X-Webhook-Signature");
        const timestamp = request.headers.get("x-webhook-timestamp") || request.headers.get("X-Webhook-Timestamp");

        if (!signature || !timestamp) {
            console.warn("Missing signature or timestamp in webhook");
            return NextResponse.json({ ok: false, error: "Missing signature or timestamp" }, { status: 400 });
        }

        const secret = process.env.CASHFREE_WEBHOOK_SECRET;
        if (!secret) {
            console.error("CASHFREE_WEBHOOK_SECRET not set in environment");
            return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });
        }

        const expected = computeSignature(secret, timestamp, raw);

        const expectedBuf = Buffer.from(expected);
        const receivedBuf = Buffer.from(signature);

        if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
            console.warn("Invalid webhook signature");
            return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 400 });
        }

        const payload = JSON.parse(raw);

        const orderId = payload.order.order_id;
        const txnId = payload.payment.cf_payment_id;
        const event = payload.type;
        const orderStatus = payload.payment.payment_status;

        if(!orderId) {
            console.warn("Webhook missing order_id", payload);
            return NextResponse.json({ ok: false, error: "Missing order_id in payload" }, { status: 400 });
        }

        // Update row only if status changed or transaction_id missing
        const { data: existing, error: selErr } = await supabaseAdmin
            .from("payments")
            .select("*")
            .eq("order_id", orderId)
            .limit(1)
            .maybeSingle();
        
        if (selErr) {
            console.error("Error fetching payment record:", selErr);
        }
        if (!existing) {
            const { error: InsertErr } = await supabaseAdmin
                .from("payments")
                .insert({
                    order_id: orderId,
                    payment_session_id: payload.customer_details.customer_id,
                    transaction_id: txnId,
                    amount: payload.payment.payment_amount,
                    currency: payload.payment.payment_currency,
                    status: orderStatus === "PAID" ? "PAID" : orderStatus.toUpperCase(),
                    raw_payload: payload
                });
            if (InsertErr) {
                console.error("Error inserting new payment record:", InsertErr);
            }
        } else {
            const updates: any = {};
            if(orderStatus && orderStatus.toUpperCase() !== (existing.status).toUpperCase()) {
                updates.status = orderStatus === "PAID" ? "paid" : orderStatus.toLowerCase();
            }
            if (txnId && !existing.transaction_id) updates.transaction_id = txnId;
            if (Object.keys(updates).length > 0) {
                updates.updated_at = new Date().toISOString();
                updates.raw_payload = payload;
                const { error: updateErr } = await supabaseAdmin
                    .from("payments")
                    .update(updates)
                    .eq("order_id", orderId);
                if (updateErr) {
                    console.error("Error updating payment record:", updateErr);
                }
            }
        }
        
        // If the event indicates a successful payment, update the team record
        if (orderStatus === "PAID" || (payload && payload.event === "PAYMENT_SUCCESS")) {
        // find team_id
        const { data: found, error: findErr } = await supabaseAdmin
            .from("payments")
            .select("team_id")
            .eq("order_id", orderId)
            .limit(1)
            .maybeSingle();

        if (findErr) console.error("find payment team err", findErr);
        if (found?.team_id) {
            const { error: teamErr } = await supabaseAdmin
            .from("teams")
            .update({ payment_status: "paid" })
            .eq("team_id", found.team_id);
            if (teamErr) console.error("update team err", teamErr);
        }}

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error("webhook error", err);
        return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
    }
}