import type { Agent, Approval, Proposal } from "@aimo/schema";
import { append } from "@aimo/ledger";
import type { GatewayService } from "./service.js";

// Persisted routing state survives restarts. App inbox is always available.
// Provider channels remain disabled until an explicit provider adapter is configured.
export async function processApprovalQueue(service: GatewayService) {
  return service.db.transaction(async (repo) => {
    for (const approval of await repo.all<Approval>("approvals")) {
      if (approval.status !== "pending") continue;
      const now = service.now();
      if (Date.parse(approval.expiresAt) <= now.getTime()) {
        approval.status = "expired";
        const proposal = await repo.get<Proposal>(
          "proposals",
          approval.proposalId,
        );
        if (proposal?.status === "held") {
          proposal.status = "expired";
          await repo.put("proposals", proposal);
        }
        await repo.put("approvals", approval);
        await append(
          repo,
          {
            type: "approval.expired",
            customerId: approval.customerId,
            actor: { kind: "aimo", id: "approval-worker" },
            refs: { approvalId: approval.id },
            payload: {},
          },
          now,
        );
        continue;
      }
      if (Date.parse(approval.nextAttemptAt) > now.getTime()) continue;
      const proposal = await repo.get<Proposal>(
        "proposals",
        approval.proposalId,
      );
      const agent = proposal
        ? await repo.get<Agent>("agents", proposal.agentId)
        : undefined;
      const channels = [
        ...(agent?.mandate.approvers[0]?.channels ?? []),
        "app",
      ].filter((c, i, all) => all.indexOf(c) === i);
      const channel = channels[approval.channelIndex];
      if (!channel) continue;
      const outcome =
        channel === "app"
          ? "available_in_inbox"
          : "provider_disabled_fallback_to_inbox";
      approval.attempts.push({ channel, at: now.toISOString(), outcome });
      approval.channelIndex++;
      approval.nextAttemptAt = new Date(
        now.getTime() + (channel === "app" ? 4 * 3_600_000 : 120_000),
      ).toISOString();
      await repo.put("approvals", approval);
      await append(
        repo,
        {
          type: "approval.channel_attempted",
          customerId: approval.customerId,
          actor: { kind: "aimo", id: "approval-worker" },
          refs: { approvalId: approval.id },
          payload: { channel, outcome },
        },
        now,
      );
    }
  });
}
