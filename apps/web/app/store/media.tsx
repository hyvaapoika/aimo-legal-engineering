"use client";
import { useState } from "react";
import { Package } from "lucide-react";
import type { StoreProduct } from "./types";
export function ProductMedia({ product }: { product: StoreProduct }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="s-photo">
      {product.image && !failed ? (
        <img
          src={product.image}
          alt={product.names.en || product.names.fi}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="s-no-photo">
          <Package size={36} strokeWidth={1} />
          <span>Image unavailable</span>
        </div>
      )}
    </div>
  );
}
