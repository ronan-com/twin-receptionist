import { Link } from "react-router-dom";
import { brand as product } from "../brand";
import type { Brand } from "../lib/shared";

// The product name, or the agency's own logo when it has set one.
export default function Wordmark({ to = "/", brand }: { to?: string; brand?: Brand | null }) {
  if (brand?.logo) {
    return (
      <Link to={to} className="wordmark" aria-label="Home">
        <img className="brand-logo" src={brand.logo} alt="" />
      </Link>
    );
  }
  return (
    <Link to={to} className="wordmark" aria-label={`${product.product} home`}>
      <span className="wordmark-name">
        {product.name}
        {product.dot && <span className="wordmark-dot">.</span>}
      </span>
      <span className="wordmark-sub">Receptionist</span>
    </Link>
  );
}
