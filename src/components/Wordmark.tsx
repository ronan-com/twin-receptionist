import { Link } from "react-router-dom";
import { brand } from "../brand";

export default function Wordmark({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="wordmark" aria-label={`${brand.product} home`}>
      <span className="wordmark-name">
        {brand.name}
        <span className="wordmark-dot">.</span>
      </span>
      <span className="wordmark-sub">Receptionist</span>
    </Link>
  );
}
