import { adminApi } from "../lib/api";
import type { Viewing } from "../lib/shared";

// Shown the whole time the platform team is looking at an agency or a customer's view.
export default function ViewBanner({ viewing }: { viewing: Viewing }) {
  async function exit() {
    await adminApi.exitView().catch(() => {});
    window.location.replace("/agencies");
  }
  return (
    <div className="view-banner" role="status">
      <span>
        Viewing <strong>{viewing.org}</strong>
        {viewing.client && (
          <>
            {" "}
            · customer view of <strong>{viewing.business}</strong>
          </>
        )}{" "}
        as the platform team. Read-only.
      </span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={exit}>
        Exit view
      </button>
    </div>
  );
}
