import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatNumber, type AvailableNumber, type NumberRequest, type NumberState, type NumberType } from "../lib/shared";

const money = (n: number, currency: string) => `${currency === "USD" ? "US$" : `${currency} `}${n.toFixed(2)}`;

export default function PhoneNumberCard({ clientId, businessName }: { clientId: string; businessName: string }) {
  const [state, setState] = useState<NumberState | null>(null);
  const [error, setError] = useState("");
  const [type, setType] = useState<NumberType | null>(null);
  const [options, setOptions] = useState<AvailableNumber[] | null>(null);
  const [buying, setBuying] = useState("");
  const [notice, setNotice] = useState("");
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<NumberType | null>(null);

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
        `then ${money(n.monthly, n.currency)} a month, charged to our balance.`,
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
          : `Order placed for ${formatNumber(n.phoneNumber)}. It is still processing` +
              (result.order.requirementsMet ? "." : " and needs address or ID documents before it goes live."),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBuying("");
    }
  }

  async function ask() {
    if (!asking) return;
    setError("");
    setNotice("");
    try {
      const requests = await api.requestNumber(clientId, asking, note.trim());
      setState((prev) => (prev ? { ...prev, requests } : prev));
      setNotice("Request sent. We'll set up the number and connect it to this receptionist.");
      setAsking(null);
      setNote("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const connected = state?.numbers ?? [];
  const waiting = (state?.requests ?? []).filter((r) => r.status === "pending");
  const declined = (state?.requests ?? []).filter((r) => r.status === "declined").slice(0, 1);
  const pending = state?.pending ?? [];

  return (
    <section className="card">
      <h2>Phone number</h2>

      {state === null && !error && <p className="muted">Loading…</p>}

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
          {o.phoneNumbers.map(formatNumber).join(", ")} is being set up.{" "}
          {o.requirementsMet
            ? "It will go live shortly."
            : state?.canBuy
              ? "It needs address or ID documents before it goes live. Finish them in the carrier portal under Numbers, then Orders."
              : "We'll be in touch if we need anything from you."}
        </div>
      ))}

      {waiting.map((r: NumberRequest) => (
        <div key={r.id} className="notice notice-wait" role="status">
          Number requested ({r.type === "mobile" ? "mobile" : "local"}). We're setting it up and will connect it here.
        </div>
      ))}
      {declined.map((r: NumberRequest) => (
        <div key={r.id} className="notice notice-error" role="status">
          We couldn't set up that number{r.reason ? `: ${r.reason}` : "."} You can send a new request.
        </div>
      ))}

      {state && connected.length === 0 && pending.length === 0 && waiting.length === 0 && (
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

      {state && !state.canBuy && waiting.length === 0 && (
        <div className="number-find">
          <p className="number-find-label">{connected.length ? "Request another number" : "Request a number"}</p>
          <div className="segmented" role="radiogroup" aria-label="Number type">
            <button type="button" role="radio" aria-checked={asking === "local"} className={asking === "local" ? "is-on" : ""} onClick={() => setAsking("local")}>
              Local · calls only
            </button>
            <button type="button" role="radio" aria-checked={asking === "mobile"} className={asking === "mobile" ? "is-on" : ""} onClick={() => setAsking("mobile")}>
              Mobile · calls and texts
            </button>
          </div>
          {asking && (
            <div className="stack-sm">
              <label className="field">
                <span>Anything we should know? (optional)</span>
                <input
                  type="text"
                  maxLength={300}
                  placeholder="e.g. a Brisbane number if possible"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <div>
                <button type="button" className="btn btn-primary btn-sm" onClick={ask}>
                  Send request
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {state?.canBuy && (
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
          {options?.length === 0 && <p className="muted">No {type} numbers are available right now.</p>}
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
              The balance is {money(state.balance.amount, state.balance.currency)}.
              {options.some((n) => n.upfront + n.monthly > state.balance!.amount) &&
                " Top it up to buy the greyed-out numbers."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
