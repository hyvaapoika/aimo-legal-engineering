"use client";
import { useState } from "react";
import { ArrowRight, Check, SlidersHorizontal } from "lucide-react";
import type { Approval, Proposal, Product } from "@aimo/schema";
import { api, money, count, day, time, short } from "./shared";
export function ApprovalCard({
  proposal,
  approval,
  products,
  busy,
  act,
}: {
  proposal: Proposal;
  approval: Approval;
  products: Record<string, Product>;
  busy: boolean;
  act: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const physical = proposal.verdict.firedRules.some((r) =>
    [
      "UNKNOWN_QUANTITY",
      "UNAVAILABLE",
      "INSUFFICIENT_STOCK",
      "LATE_DELIVERY",
    ].includes(r.code),
  );
  const decide = (decision: string) =>
    act(
      () =>
        api(`approvals/${approval.id}/decide`, {
          decision,
          revision: proposal.revision,
          challengeToken: approval.challengeToken,
          ...(decision === "approve_with_amount"
            ? {
                amendedLines: proposal.lines.map((l) => ({
                  productId: l.productId,
                  qty: Number(amounts[l.productId] ?? l.qty),
                })),
              }
            : {}),
        }),
      decision === "approve"
        ? "Approval recorded. Your order is now placed."
        : decision === "approve_with_amount"
          ? "Amounts changed and re-evaluated. Check the new proposal in the inbox."
          : "Proposal rejected. No order was placed.",
    );
  return (
    <article className="approval-card">
      <div className="approval-meta">
        <span>
          <span className="amber-dot" /> HUMAN DECISION REQUIRED
        </span>
        <span className="mono">
          {short(proposal.id)} <span className="separator">/</span>{" "}
          {time(proposal.createdAt)}
        </span>
      </div>
      <div className="approval-title">
        <div>
          <h3>
            {proposal.lines.length > 1
              ? "Kitchen replenishment"
              : (products[proposal.lines[0]!.productId]?.names.fi ??
                "Supplier availability exception")}
          </h3>
          <p>
            Hotel Haven buyer <span className="separator">→</span>{" "}
            {proposal.deliverySite} <span className="separator">/</span>{" "}
            {day(proposal.requestedDate)}
          </p>
        </div>
        <div className="receipt-total">
          {money(proposal.totalCents)}
          <span>excl. VAT</span>
        </div>
      </div>
      <div className="receipt-lines">
        {proposal.lines.map((line) => {
          const product = products[line.productId];
          const factor =
            product?.packs.find((p) => p.unitId === product.salesUnit)
              ?.sizeInBaseUnits ?? 1;
          return (
            <div key={line.productId} className="receipt-line">
              <div>
                {product?.names.fi ?? line.productId}
                {line.substituteFor && (
                  <span className="substitute">
                    Substitution for {line.substituteFor}
                  </span>
                )}
              </div>
              <span className="human-qty">
                {product?.netContent
                  ? `${count(line.qty * factor * product.netContent.value)} ${product.netContent.unit}`
                  : ""}
              </span>
              {editing ? (
                <label className="qty-input">
                  <span className="sr-only">Quantity for {line.productId}</span>
                  <input
                    type="number"
                    min="0.01"
                    step={product?.allowedLotSize ?? 0.01}
                    value={amounts[line.productId] ?? line.qty}
                    onChange={(e) =>
                      setAmounts({
                        ...amounts,
                        [line.productId]: e.target.value,
                      })
                    }
                  />{" "}
                  {line.salesUnit}
                </label>
              ) : (
                <span className="mono">
                  {count(line.qty)} {line.salesUnit}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="rule-explanation">
        <SlidersHorizontal size={17} />
        <div>
          {proposal.verdict.firedRules.slice(0, 2).map((rule, i) => (
            <p key={`${rule.id}-${i}`}>{rule.message}</p>
          ))}
          {proposal.verdict.firedRules.length > 2 && (
            <details>
              <summary>
                {proposal.verdict.firedRules.length - 2} more policy checks
              </summary>
              {proposal.verdict.firedRules.slice(2).map((r, i) => (
                <p key={i}>{r.message}</p>
              ))}
            </details>
          )}
        </div>
      </div>
      <div className="approval-actions">
        <div>
          {editing ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void decide("approve_with_amount")}
            >
              Submit changed amounts <ArrowRight size={15} />
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy || physical}
              title={
                physical
                  ? "Amend the availability exception before approving."
                  : undefined
              }
              onClick={() => void decide("approve")}
            >
              <Check size={16} /> Approve order
            </button>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setEditing(!editing)}
          >
            {editing ? "Cancel changes" : "Change amounts"}
          </button>
          <button
            className="text-button reject"
            disabled={busy}
            onClick={() => void decide("reject")}
          >
            Reject
          </button>
        </div>
        <span className="small muted">
          {physical
            ? "Availability must be resolved first"
            : "Decision recorded in the ledger"}
        </span>
      </div>
    </article>
  );
}
