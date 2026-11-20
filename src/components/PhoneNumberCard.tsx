import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatNumber, type AvailableNumber, type NumberState, type NumberType } from "../lib/shared";

const money = (n: number, currency: string) => `${currency === "USD" ? "US$" : `${currency} `}${n.toFixed(2)}`;

export default function PhoneNumberCard({ clientId, businessName }: { clientId: string; businessName: string }) {
  const [state, setState] = useState<NumberState | null>(null);
  const [error, setError] = useState("");
  const [type, setType] = useState<NumberType | null>(null);
  const [options, setOptions] = useState<AvailableNumber[] | null>(null);
  const [buying, setBuying] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    api
      .numbers(clientId)
      .then(setState)
      .catch((err: Error) => setError(err.message));
  }, [clientId]);

  useEffect(load, [load]);

  function search(next: NumberType) {
    setType(next);
    setOptions(null);
    setError("");
    setNotice("");
    api
      .availableNumbers(next)
      .then(setOptions)
      .catch((err: Error) => setError(err.message));
  }

  async function buy(n: AvailableNumber) {
    const first = n.upfront + n.monthly;
    const ok = window.confirm(
      `Buy ${formatNumber(n.phoneNumber)} for ${businessName}?\n\n` +
        `${money(first, n.currency)} now (${money(n.upfront, n.currency)} setup + first month), ` +
        `then ${money(n.monthly, n.currency)} a month, charged to your Telnyx balance.`,
    );
    if (!ok) return;
    setBuying(n.phoneNumber);
    setError("");
    try {
      const result = await api.buyNumber(clientId, n.phoneNumber);
      setState(result);
      setType(null);
      setOptions(null);
      setNotice(
        result.order.status === "success"
          ? `${formatNumber(n.phoneNumber)} is connected.`
          : `Order placed for ${formatNumber(n.phoneNumber)}. Telnyx is still processing it` +
              (result.order.requirementsMet ? "." : " and needs address or ID documents before it goes live."),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBuying("");
    }
  }

  const connected = state?.numbers ?? [];
  const pending = state?.pending ?? [];

  return (
    <section className="card">
      <h2>Phone number</h2>

      {state === null && !error && <p className="muted">Checking Telnyx…</p>}

      {connected.length > 0 && (
        <>
          <ul className="numbers">
            {connected.map((n) => (
              <li key={n.id}>
                <span className="number">{formatNumber(n.phoneNumber)}</span>
                <span className={`pill ${n.status === "active" ? "pill-on" : ""}`}>
                  {n.status === "active" ? "Answering calls" : n.status.replace(/-/g, " ")}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted">
            Calls to this number are answered by the receptionist. Have {businessName} forward their existing number
            to it.
          </p>
        </>
      )}

      {pending.map((o) => (
        <div key={o.id} className="notice notice-wait" role="status">
          {o.phoneNumbers.map(formatNumber).join(", ")} is on order.{" "}
          {o.requirementsMet
            ? "Telnyx is still processing it."
            : "Telnyx needs address or ID documents for this number. Finish them in the Telnyx portal under Numbers, then Orders."}
        </div>
      ))}

      {state && connected.length === 0 && pending.length === 0 && (
        <p className="muted">
          Not connected. This receptionist only answers browser test calls until it has an Australian number.
        </p>
      )}

      {notice && (
        <div className="notice notice-ok" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {state && (
        <div className="number-find">
          <p className="number-find-label">{connected.length ? "Add another number" : "Find a number"}</p>
          <div className="segmented" role="radiogroup" aria-label="Number type">
            <button type="button" role="radio" aria-checked={type === "local"} className={type === "local" ? "is-on" : ""} onClick={() => search("local")}>
              Local · calls only
            </button>
            <button type="button" role="radio" aria-checked={type === "mobile"} className={type === "mobile" ? "is-on" : ""} onClick={() => search("mobile")}>
              Mobile · calls and texts
            </button>
          </div>

          {type && options === null && !error && <p className="muted">Searching…</p>}
          {options?.length === 0 && <p className="muted">Telnyx has no {type} numbers available right now.</p>}
          {options && options.length > 0 && (
            <ul className="number-options">
              {options.map((n) => {
                const first = n.upfront + n.monthly;
                const short = state.balance !== null && first > state.balance.amount;
                return (
                  <li key={n.phoneNumber}>
                    <span>
                      <span className="number">{formatNumber(n.phoneNumber)}</span>
                      <span className="number-price">
                        {money(first, n.currency)} now, then {money(n.monthly, n.currency)}/month
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={short || buying !== ""}
                      onClick={() => buy(n)}
                    >
                      {buying === n.phoneNumber ? "Buying…" : "Buy and connect"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {options && options.length > 0 && state.balance && (
            <p className="hint">
              Your Telnyx balance is {money(state.balance.amount, state.balance.currency)}.
              {options.some((n) => n.upfront + n.monthly > state.balance!.amount) &&
                " Top it up in the Telnyx portal to buy the greyed-out numbers."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
