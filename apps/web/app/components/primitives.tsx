import type { ReactNode } from "react";
import type { LedgerEvent } from "@aimo/schema";
import { PackageCheck } from "lucide-react";
import { title, time } from "./shared";
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      {status === "placed"
        ? "Placed"
        : status === "held" || status === "pending"
          ? "Needs decision"
          : status === "refused"
            ? "Refused"
            : status === "active"
              ? "Active"
              : status}
    </span>
  );
}
export function Empty({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <PackageCheck size={28} strokeWidth={1.3} />
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Timeline({
  events,
  compact = false,
}: {
  events: LedgerEvent[];
  compact?: boolean;
}) {
  return (
    <div className="timeline">
      {events
        .slice()
        .reverse()
        .slice(0, compact ? 6 : 100)
        .map((event) => (
          <div
            className={`event ${event.type === "request.refused" ? "refused" : ""}`}
            key={event.seq}
          >
            <span className="event-dot" />
            <div>
              <div className="event-title">{title(event)}</div>
              <div className="muted small">
                {event.actor.id} <span className="separator">/</span>{" "}
                {time(event.ts)} <span className="separator">/</span>{" "}
                <code>{event.hash.slice(0, 12)}</code>
              </div>
              {!compact && (
                <details>
                  <summary>Event details</summary>
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </details>
              )}
            </div>
            <span className="event-seq mono">
              {String(event.seq).padStart(3, "0")}
            </span>
          </div>
        ))}
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
