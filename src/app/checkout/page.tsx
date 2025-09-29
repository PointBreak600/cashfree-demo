// app/checkout/page.tsx
"use client";
import React, { useState } from "react";

export default function CheckoutPage(): JSX.Element {
  const [msg, setMsg] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  function loadCashfreeSDK(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined") return reject(new Error("no window"));
      if ((window as any).Cashfree) return resolve((window as any).Cashfree);
      const script = document.createElement("script");
      script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      script.async = true;
      script.onload = () => {
        if ((window as any).Cashfree) resolve((window as any).Cashfree);
        else reject(new Error("Cashfree SDK loaded but window.Cashfree missing"));
      };
      script.onerror = (e) => reject(e);
      document.body.appendChild(script);
    });
  }

  async function handlePayClick() {
    setLoading(true);
    setMsg("Creating order...");
    const teamId = 619662;

    try {
      const resp = await fetch("/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: "10.00",
          customer_email: "buyer@example.com",
          customer_phone: "9999999999",
          customer_id: "cust_1234",
          team_id: teamId
        }),
      });

      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        console.error("create-order failed", data);
        setMsg("Create order failed — check server logs");
        setLoading(false);
        return;
      }

      const serverResponse = data.data; // First, access the nested data object
      const paymentSessionId =
        serverResponse.payment_session_id || serverResponse.payment_sessions_id || serverResponse.paymentSessionId;
      const orderId = serverResponse.order_id;

      if (!paymentSessionId || !orderId) {
        console.error("Missing paymentSessionId/orderId", data);
        setMsg("Create-order succeeded but missing required IDs — inspect console");
        setLoading(false);
        return;
      }

      setMsg("Loading Cashfree SDK...");
      const Cashfree = await loadCashfreeSDK();
      const cf = Cashfree({ mode: process.env.NEXT_PUBLIC_CASHFREE_MODE || "sandbox" });

      setMsg("Opening checkout...");
      // Must be in user gesture (we're inside click handler) to avoid popup blockers
      cf.checkout({ paymentSessionId, redirectTarget: "_modal" })
        .then(async () => {
          setMsg("Checkout closed — verifying payment on server...");
          try {
            const verifyResp = await fetch(`/api/verify-order?order_id=${encodeURIComponent(orderId)}`);
            const verifyData = await verifyResp.json();
            if (verifyResp.ok && verifyData.ok && verifyData.order && verifyData.order.order_status === "PAID") {
              setMsg("Payment successful (verified) 🎉");
            } else {
              console.log("verifyData", verifyData);
              setMsg("Payment not verified. Check order status.");
            }
          } catch (ve) {
            console.error("verify error", ve);
            setMsg("Error verifying payment on server.");
          } finally {
            setLoading(false);
          }
        })
        .catch((err: any) => {
          console.error("checkout error", err);
          setMsg("Checkout error or closed by user.");
          setLoading(false);
        });
    } catch (err: any) {
      console.error("unexpected error", err);
      setMsg("Unexpected error");
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Pay with Cashfree (Popup)</h1>
      <button onClick={handlePayClick} disabled={loading}>
        {loading ? "Processing..." : "Pay ₹10"}
      </button>
      <p>{msg}</p>
    </main>
  );
}
