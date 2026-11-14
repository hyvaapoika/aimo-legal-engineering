import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { JWK } from "jose";
import { Catalog, loadCatalog } from "@aimo/catalog";
import { createDatabase, type Database, type Repository } from "@aimo/database";
import { append, events, verifyChain } from "@aimo/ledger";
import {
  Signer,
  canonical,
  generateKeys,
  sha256,
  token,
  constantEqual,
} from "@aimo/signing";
import {
  LiveValioClient,
  MockValioClient,
  type ValioAdapter,
  type MockScenario,
} from "@aimo/valio-client";
import {
  DomainError,
  proposalInputSchema,
  offersInputSchema,
  searchSchema,
  type Agent,
  type Approval,
  type Decision,
  type Mandate,
  type Offer,
  type Order,
  type Proposal,
  type ProposalInput,
  type SearchInput,
} from "@aimo/schema";
import { lineCents, nonOverridableHolds, toInstant } from "@aimo/feasibility";
import { evaluate } from "@aimo/rules";
import type { Configuration } from "./config.js";

export const DEMO_AGENT = "hotel-haven-buyer";
export const DEMO_CUSTOMER = "hotel-haven";
const actor = (id: string, kind: "agent" | "aimo" | "human" = "agent") => ({
  id,
  kind,
});
export function defaultMandate(
  categories: string[],
  now = new Date(),
): Mandate {
  return {
    version: 1,
    limits: { perOrder: 2000, perWeek: 10000, currency: "EUR" },
    categories,
    deliverySites: ["haven-kitchen"],
    substitutionPolicy: "explicit",
    allergenProfile: "standard",
    requiredClaims: [],
    allergenFree: [],
    acceptCatalogPrice: true,
    approvers: [{ userId: "maija", name: "Maija Korhonen", channels: ["app"] }],
    validTo: new Date(now.getTime() + 365 * 86_400_000).toISOString(),
  };
}
export function publicAgent(agent: Agent) {
  const { tokenHash: _tokenHash, ...safe } = agent;
  return safe;
}
export class GatewayService {
  constructor(
    readonly db: Database,
    readonly catalog: Catalog,
    readonly valio: ValioAdapter,
    readonly signer: Signer,
    readonly now: () => Date = () => new Date(),
  ) {}
  async audit(
    type: string,
    customerId: string,
    actorId: string,
    payload: Record<string, unknown> = {},
  ) {
    return this.db.transaction((repo) =>
      append(
        repo,
        { type, customerId, actor: actor(actorId), refs: {}, payload },
        this.now(),
      ),
    );
  }
  async agent(id: string) {
    const agent = await this.db.transaction((repo) =>
      repo.get<Agent>("agents", id),
    );
    if (!agent) throw new DomainError("UNKNOWN_AGENT", "Unknown agent.", 401);
    return agent;
  }
  async agentByToken(bearer: string) {
    const hash = sha256(bearer);
    const agents = await this.db.transaction((repo) =>
      repo.all<Agent>("agents"),
    );
    const agent = agents.find((a) => constantEqual(a.tokenHash, hash));
    if (!agent || !agent.active)
      throw new DomainError("UNAUTHORIZED", "Unknown or revoked agent.", 401);
    return agent;
  }
  async search(agent: Agent, raw: SearchInput) {
    const input = searchSchema.parse(raw);
    const products = this.catalog.search(input);
    await this.audit("catalog.searched", agent.customerId, agent.id, {
      query: input.query,
      count: products.length,
    });
    return { products, catalogCount: this.catalog.products.length };
  }
  async getOffers(agent: Agent, raw: unknown) {
    const input = offersInputSchema.parse(raw);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Helsinki",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(this.now());
    if (input.requestedDate < today)
      throw new DomainError(
        "PAST_DATE",
        "Requested delivery date is in the past.",
      );
    const substitutions = input.includeSubstitutesFor.map((productId) => {
      const source = this.catalog.get(productId);
      const claims = [
        ...agent.mandate.requiredClaims,
        ...(agent.mandate.allergenProfile === "strict"
          ? source.claims.filter((c) => c.startsWith("FREE_FROM_"))
          : []),
      ];
      const free = [
        ...agent.mandate.allergenFree,
        ...(agent.mandate.allergenProfile === "strict"
          ? source.allergenFree
          : []),
      ];
      return {
        productId,
        candidates: this.catalog.substitutes(productId, claims, free),
      };
    });
    const ids = [
      ...new Set([
        ...input.productIds,
        ...substitutions.flatMap((s) => s.candidates.map((c) => c.product.id)),
      ]),
    ];
    if (ids.length > 1000)
      throw new DomainError(
        "INVALID_BATCH",
        "Shortlist including substitutes exceeds 1,000 products.",
      );
    const products = ids.map((id) => this.catalog.get(id));
    const now = this.now();
    const { prices, availability } = await this.valio.lookup(
      agent.customerId,
      products,
      input.requestedDate,
      now,
    );
    if (
      prices.customerId !== agent.customerId ||
      prices.currency !== "EUR" ||
      prices.pricingDate.slice(0, 10) !== input.requestedDate ||
      availability.requestedDate.slice(0, 10) !== input.requestedDate
    )
      throw new DomainError(
        "UPSTREAM_MISMATCH",
        "Valio response does not match the requested customer, date, or currency.",
        502,
      );
    const priceMap = new Map(prices.products.map((p) => [p.productId, p]));
    const availableMap = new Map(
      availability.products.map((p) => [p.productId, p]),
    );
    if (
      priceMap.size !== prices.products.length ||
      availableMap.size !== availability.products.length
    )
      throw new DomainError(
        "UPSTREAM_MISMATCH",
        "Supplier returned duplicate product records.",
        502,
      );
    const offers: Offer[] = [];
    for (const product of products) {
      const price = priceMap.get(product.id);
      const available = availableMap.get(product.id);
      if (!price || !available || price.quantity !== 1)
        throw new DomainError(
          "UPSTREAM_INCOMPLETE",
          `Supplier response is incomplete for ${product.id}.`,
          502,
        );
      const catalogPrice = price.error ? null : price.catalogPrice;
      if (catalogPrice && catalogPrice.currency !== "EUR")
        throw new DomainError(
          "UPSTREAM_CURRENCY",
          "Unsupported supplier price currency.",
          502,
        );
      const closingTime = available.closingTime
        ? toInstant(available.closingTime)
        : null;
      const normalizedPrice = catalogPrice
        ? {
            value: catalogPrice.value,
            currency: "EUR" as const,
            validFrom: toInstant(catalogPrice.validFrom),
            validTo: toInstant(catalogPrice.validTo, true),
            netPriceFound: price.netPriceFound,
          }
        : null;
      if (
        normalizedPrice &&
        (catalogPrice!.validFrom.slice(0, 10) > input.requestedDate ||
          catalogPrice!.validTo.slice(0, 10) < input.requestedDate)
      )
        throw new DomainError(
          "UPSTREAM_PRICE_DATE",
          "Supplier price does not cover the requested delivery date.",
          502,
        );
      const payload = {
        id: randomUUID(),
        customerId: agent.customerId,
        productId: product.id,
        product,
        requestedDate: input.requestedDate,
        issuedAt: now.toISOString(),
        validUntil: new Date(
          Math.min(
            now.getTime() + 30 * 60_000,
            closingTime ? Date.parse(closingTime) : Infinity,
            normalizedPrice ? Date.parse(normalizedPrice.validTo) : Infinity,
          ),
        ).toISOString(),
        source: this.valio.source,
        price: normalizedPrice,
        ...(price.comparisonPrice
          ? {
              comparisonPrice: {
                value: price.comparisonPrice.value,
                unit: price.comparisonUnit ?? "UNKNOWN",
              },
            }
          : {}),
        salesBlock: available.salesBlock,
        closingTime,
        logisticModel: available.logisticModel ?? null,
        availability: available.scheduleLines.map((s) => ({
          ...s,
          availableDate: s.availableDate?.slice(0, 10) ?? null,
        })),
      };
      offers.push({ ...payload, signature: await this.signer.sign(payload) });
    }
    // Comparison ranking uses supplier prices only after the candidate shortlist is fetched.
    for (const group of substitutions)
      group.candidates.sort((a, b) => {
        const av = offers.find((o) => o.productId === a.product.id);
        const bv = offers.find((o) => o.productId === b.product.id);
        const usable = (o?: Offer) =>
          o?.price && !o.salesBlock && o.availability.length ? 1 : 0;
        return (
          usable(bv) - usable(av) ||
          Number(b.explicit) - Number(a.explicit) ||
          (av?.comparisonPrice?.unit === bv?.comparisonPrice?.unit &&
          av?.comparisonPrice &&
          bv?.comparisonPrice
            ? av.comparisonPrice.value - bv.comparisonPrice.value
            : b.score - a.score)
        );
      });
    await this.db.transaction(async (repo) => {
      for (const offer of offers) await repo.put("offers", offer);
      await append(
        repo,
        {
          type: "offers.returned",
          customerId: agent.customerId,
          actor: actor(agent.id),
          refs: {},
          payload: {
            offerIds: offers.map((o) => o.id),
            products: ids,
            source: this.valio.source,
          },
        },
        now,
      );
      if (substitutions.length)
        await append(
          repo,
          {
            type: "substitutes.proposed",
            customerId: agent.customerId,
            actor: actor("aimo", "aimo"),
            refs: {},
            payload: { substitutions },
          },
          now,
        );
    });
    return { offers, substitutions };
  }
  private async evaluateIn(
    repo: Repository,
    agent: Agent,
    input: ProposalInput,
    proposalId: string,
  ) {
    const offers = new Map<string, Offer>();
    const validSignatures = new Set<string>();
    for (const line of input.lines) {
      const offer = await repo.get<Offer>("offers", line.offerId);
      if (offer) {
        offers.set(offer.id, offer);
        const { signature, ...payload } = offer;
        if (await this.signer.verify(payload, signature))
          validSignatures.add(offer.id);
      }
    }
    const history = await repo.all<Order>("orders", agent.customerId);
    return {
      verdict: evaluate({
        proposalId,
        input,
        agent,
        offers,
        validSignatures,
        history,
        products: this.catalog.byId,
        now: this.now(),
      }),
      offers,
    };
  }
  private async placeIn(
    repo: Repository,
    proposal: Proposal,
    offers: Map<string, Offer>,
    approvalId?: string,
  ): Promise<Order> {
    const existing = (
      await repo.all<Order>("orders", proposal.customerId)
    ).find((o) => o.proposalId === proposal.id);
    if (existing) return existing;
    const lines = proposal.lines.map((line) => {
      const offer = offers.get(line.offerId)!;
      return {
        ...line,
        name:
          offer.product.names.fi || offer.product.names.en || offer.productId,
        gtin: offer.product.gtin,
        unitPrice: offer.price!.value,
        lineTotalCents: lineCents(line.qty, offer.price!.value),
        deliveryDate: offer.availability[0]!.availableDate!.slice(0, 10),
      };
    });
    const order: Order = {
      id: `AIMO-${randomUUID().slice(0, 8).toUpperCase()}`,
      proposalId: proposal.id,
      verdictId: proposal.verdict.id,
      approvalId,
      customerId: proposal.customerId,
      agentId: proposal.agentId,
      lines,
      totalCents: lines.reduce((n, l) => n + l.lineTotalCents, 0),
      currency: "EUR",
      deliveryDate: lines
        .map((l) => l.deliveryDate)
        .sort()
        .at(-1)!,
      deliverySite: proposal.deliverySite,
      confirmedAt: this.now().toISOString(),
      simulated: true,
    };
    await repo.put("orders", order);
    proposal.status = "placed";
    proposal.orderId = order.id;
    await repo.put("proposals", proposal);
    await append(
      repo,
      {
        type: "order.placed",
        customerId: proposal.customerId,
        actor: actor("aimo", "aimo"),
        refs: { proposalId: proposal.id, orderId: order.id },
        payload: {
          totalCents: order.totalCents,
          simulated: true,
          approvalId: approvalId ?? null,
          verdictId: proposal.verdict.id,
        },
      },
      this.now(),
    );
    return order;
  }
  private async submitIn(
    repo: Repository,
    agent: Agent,
    input: ProposalInput,
    parentId?: string,
  ) {
    const prior = (
      await repo.all<Proposal>("proposals", agent.customerId)
    ).find(
      (p) =>
        p.agentId === agent.id && p.idempotencyKey === input.idempotencyKey,
    );
    if (prior) {
      if (
        canonical(proposalInputSchema.parse(priorInput(prior))) !==
        canonical(input)
      )
        throw new DomainError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for a different proposal.",
          409,
        );
      return prior;
    }
    const id = randomUUID();
    const { verdict, offers } = await this.evaluateIn(repo, agent, input, id);
    const now = this.now();
    const proposal: Proposal = {
      ...input,
      id,
      customerId: agent.customerId,
      agentId: agent.id,
      totalCents: input.lines.reduce(
        (sum, line) =>
          sum +
          lineCents(line.qty, offers.get(line.offerId)?.price?.value ?? 0),
        0,
      ),
      status: verdict.result === "REFUSE" ? "refused" : "held",
      verdict,
      createdAt: now.toISOString(),
      revision: 1,
      parentId,
    };
    await repo.put("proposals", proposal);
    await repo.put("verdicts", { ...verdict, customerId: agent.customerId });
    await append(
      repo,
      {
        type: "proposal.submitted",
        customerId: agent.customerId,
        actor: actor(agent.id),
        refs: { proposalId: id },
        payload: { lines: input.lines, totalCents: proposal.totalCents },
      },
      now,
    );
    await append(
      repo,
      {
        type: "rules.evaluated",
        customerId: agent.customerId,
        actor: actor("aimo", "aimo"),
        refs: { proposalId: id },
        payload: { result: verdict.result, firedRules: verdict.firedRules },
      },
      now,
    );
    if (verdict.result === "AUTO") await this.placeIn(repo, proposal, offers);
    else if (verdict.result === "HOLD") {
      const approval: Approval = {
        id: randomUUID(),
        proposalId: id,
        customerId: agent.customerId,
        status: "pending",
        challengeToken: token(),
        lineHash: sha256(canonical(proposal.lines)),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 4 * 3_600_000).toISOString(),
        nextAttemptAt: now.toISOString(),
        channelIndex: 0,
        attempts: [],
      };
      proposal.approvalId = approval.id;
      await repo.put("approvals", approval);
      await repo.put("proposals", proposal);
      await append(
        repo,
        {
          type: "approval.requested",
          customerId: agent.customerId,
          actor: actor("aimo", "aimo"),
          refs: { proposalId: id, approvalId: approval.id },
          payload: { firedRules: verdict.firedRules },
        },
        now,
      );
    } else
      await append(
        repo,
        {
          type: "request.refused",
          customerId: agent.customerId,
          actor: actor("aimo", "aimo"),
          refs: { proposalId: id },
          payload: { rules: verdict.firedRules },
        },
        now,
      );
    return proposal;
  }
  async submit(agent: Agent, raw: unknown) {
    const input = proposalInputSchema.parse(raw);
    return this.db.transaction(async (repo) =>
      this.submitIn(
        repo,
        (await repo.get<Agent>("agents", agent.id)) ?? agent,
        input,
      ),
    );
  }
  async getProposal(agent: Agent, id: string) {
    return this.db.transaction(async (repo) => {
      const proposal = await repo.get<Proposal>("proposals", id);
      if (
        !proposal ||
        proposal.customerId !== agent.customerId ||
        proposal.agentId !== agent.id
      )
        throw new DomainError("NOT_FOUND", "Proposal not found.", 404);
      await append(
        repo,
        {
          type: "proposal.read",
          customerId: agent.customerId,
          actor: actor(agent.id),
          refs: { proposalId: id },
          payload: {},
        },
        this.now(),
      );
      // Approval challenge tokens are available only through the authenticated human channel.
      return proposal;
    });
  }
  async getOrder(agent: Agent, id: string) {
    return this.db.transaction(async (repo) => {
      const order = await repo.get<Order>("orders", id);
      if (
        !order ||
        order.customerId !== agent.customerId ||
        order.agentId !== agent.id
      )
        throw new DomainError("NOT_FOUND", "Order not found.", 404);
      await append(
        repo,
        {
          type: "order.read",
          customerId: agent.customerId,
          actor: actor(agent.id),
          refs: { orderId: id },
          payload: {},
        },
        this.now(),
      );
      return order;
    });
  }
  async decide(
    approvalId: string,
    decision: Decision,
    approverId: string,
    customerId = DEMO_CUSTOMER,
  ) {
    return this.db.transaction(async (repo) => {
      const approval = await repo.get<Approval>("approvals", approvalId);
      if (!approval || approval.customerId !== customerId)
        throw new DomainError("NOT_FOUND", "Approval not found.", 404);
      if (approval.status !== "pending")
        throw new DomainError(
          "ALREADY_DECIDED",
          "This approval has already been resolved.",
          409,
        );
      if (Date.parse(approval.expiresAt) <= this.now().getTime())
        throw new DomainError(
          "APPROVAL_EXPIRED",
          "Approval expired. Request fresh offers and resubmit.",
          409,
        );
      const proposal = (await repo.get<Proposal>(
        "proposals",
        approval.proposalId,
      ))!;
      const agent = (await repo.get<Agent>("agents", proposal.agentId))!;
      if (!agent.mandate.approvers.some((a) => a.userId === approverId))
        throw new DomainError(
          "FORBIDDEN",
          "User is not a registered approver.",
          403,
        );
      if (
        !constantEqual(approval.challengeToken, decision.challengeToken) ||
        proposal.revision !== decision.revision ||
        approval.lineHash !== sha256(canonical(proposal.lines))
      )
        throw new DomainError(
          "STALE_DECISION",
          "Approval does not match the current proposal.",
          409,
        );
      if (decision.decision === "callback") {
        approval.nextAttemptAt = new Date(
          this.now().getTime() + 10 * 60_000,
        ).toISOString();
        await repo.put("approvals", approval);
        await append(
          repo,
          {
            type: "approval.callback_requested",
            customerId,
            actor: actor(approverId, "human"),
            refs: { approvalId },
            payload: {},
          },
          this.now(),
        );
        return { proposal, approval };
      }
      if (decision.decision === "approve_with_amount") {
        if (
          !decision.amendedLines?.length ||
          decision.amendedLines.some(
            (l) => !proposal.lines.some((p) => p.productId === l.productId),
          ) ||
          new Set(decision.amendedLines.map((l) => l.productId)).size !==
            decision.amendedLines.length
        )
          throw new DomainError(
            "INVALID_AMENDMENT",
            "Supply unique quantities for existing product lines.",
          );
        const input = priorInput(proposal);
        input.idempotencyKey = `amend-${approval.id}`;
        input.lines = input.lines.map((l) => ({
          ...l,
          qty:
            decision.amendedLines!.find((a) => a.productId === l.productId)
              ?.qty ?? l.qty,
        }));
        const amended = await this.submitIn(repo, agent, input, proposal.id);
        proposal.status = "amended";
        approval.status = "amended";
        approval.replacementProposalId = amended.id;
      } else if (decision.decision === "reject") {
        proposal.status = "rejected";
        approval.status = "rejected";
      } else {
        const { verdict, offers } = await this.evaluateIn(
          repo,
          agent,
          priorInput(proposal),
          proposal.id,
        );
        if (
          verdict.result === "REFUSE" ||
          verdict.firedRules.some((r) => nonOverridableHolds.has(r.code))
        )
          throw new DomainError(
            "REVALIDATION_REQUIRED",
            "Approval cannot override unavailable stock, unknown quantities, late delivery, or hard refusals. Amend the proposal or request new offers.",
            409,
            verdict,
          );
        proposal.verdict = verdict;
        await repo.put("verdicts", { ...verdict, customerId });
        approval.status = "approved";
        // Decision evidence is persisted in the same transaction before the order.
        approval.decidedAt = this.now().toISOString();
        approval.approverId = approverId;
        approval.channel = "app";
        approval.signature = await this.signer.sign({
          approvalId,
          lineHash: approval.lineHash,
          decision: decision.decision,
          approverId,
          decidedAt: approval.decidedAt,
        });
        await repo.put("approvals", approval);
        await append(
          repo,
          {
            type: "approval.decided",
            customerId,
            actor: actor(approverId, "human"),
            refs: { approvalId, proposalId: proposal.id },
            payload: {
              decision: decision.decision,
              lineHash: approval.lineHash,
              signature: approval.signature,
            },
          },
          this.now(),
        );
        await this.placeIn(repo, proposal, offers, approvalId);
        return { proposal, approval };
      }
      approval.decidedAt = this.now().toISOString();
      approval.approverId = approverId;
      approval.channel = "app";
      approval.signature = await this.signer.sign({
        approvalId,
        lineHash: approval.lineHash,
        decision: decision.decision,
        amendedLines: decision.amendedLines,
        approverId,
        decidedAt: approval.decidedAt,
      });
      await repo.put("approvals", approval);
      await repo.put("proposals", proposal);
      await append(
        repo,
        {
          type: "approval.decided",
          customerId,
          actor: actor(approverId, "human"),
          refs: { approvalId, proposalId: proposal.id },
          payload: {
            decision: decision.decision,
            replacementProposalId: approval.replacementProposalId ?? null,
          },
        },
        this.now(),
      );
      return { proposal, approval };
    });
  }
  async snapshot(customerId = DEMO_CUSTOMER) {
    return this.db.transaction(async (repo) => ({
      agents: (await repo.all<Agent>("agents", customerId)).map(publicAgent),
      proposals: await repo.all<Proposal>("proposals", customerId),
      approvals: await repo.all<Approval>("approvals", customerId),
      orders: await repo.all<Order>("orders", customerId),
      events: await events(repo, customerId),
      catalogCount: this.catalog.products.length,
      mode: this.valio.source,
      categories: [
        ...new Set(this.catalog.products.map((p) => p.category)),
      ].sort(),
    }));
  }
  async verifyLedger() {
    return this.db.transaction(async (repo) => verifyChain(await events(repo)));
  }
  async register(name: string, mandate: Mandate, customerId = DEMO_CUSTOMER) {
    const keys = await generateKeys();
    const secret = token();
    const agent: Agent = {
      id: randomUUID(),
      name,
      customerId,
      active: true,
      scopes: ["catalog:read", "offers:read", "proposals:write", "orders:read"],
      publicKey: keys.publicKey,
      tokenHash: sha256(secret),
      mandate,
      createdAt: this.now().toISOString(),
    };
    await this.db.transaction(async (repo) => {
      await repo.put("agents", agent);
      await repo.put("mandates", {
        id: `${agent.id}:1`,
        customerId,
        agentId: agent.id,
        ...mandate,
      });
      await append(
        repo,
        {
          type: "agent.registered",
          customerId,
          actor: actor("admin", "human"),
          refs: { agentId: agent.id },
          payload: { name, mandate },
        },
        this.now(),
      );
    });
    return {
      agent: publicAgent(agent),
      credentials: {
        token: secret,
        privateKey: keys.privateKey,
        keyId: agent.id,
      },
    };
  }
  async updateAgent(
    id: string,
    change: { active?: boolean; mandate?: Mandate },
    customerId = DEMO_CUSTOMER,
  ) {
    return this.db.transaction(async (repo) => {
      const agent = await repo.get<Agent>("agents", id);
      if (!agent || agent.customerId !== customerId)
        throw new DomainError("NOT_FOUND", "Agent not found.", 404);
      if (change.active !== undefined) agent.active = change.active;
      if (change.mandate) {
        agent.mandate = {
          ...change.mandate,
          version: agent.mandate.version + 1,
        };
        await repo.put("mandates", {
          ...agent.mandate,
          id: `${id}:${agent.mandate.version}`,
          agentId: id,
          customerId,
        });
      }
      await repo.put("agents", agent);
      await append(
        repo,
        {
          type: "agent.updated",
          customerId,
          actor: actor("admin", "human"),
          refs: { agentId: id },
          payload: { active: agent.active, mandate: agent.mandate },
        },
        this.now(),
      );
      return publicAgent(agent);
    });
  }
}
export function priorInput(proposal: Proposal): ProposalInput {
  return {
    requestedDate: proposal.requestedDate,
    deliverySite: proposal.deliverySite,
    lines: proposal.lines,
    idempotencyKey: proposal.idempotencyKey,
    ...(proposal.requirementRef
      ? { requirementRef: proposal.requirementRef }
      : {}),
  };
}

export async function bootstrap(config: Configuration) {
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  let keys: { privateKey: JWK; publicKey: JWK };
  if (process.env.AIMO_SIGNING_KEY) {
    const privateKey = JSON.parse(process.env.AIMO_SIGNING_KEY) as JWK;
    const { d: _d, ...publicKey } = privateKey;
    keys = { privateKey, publicKey };
  } else {
    const path = join(config.stateDir, "signing.json");
    try {
      keys = JSON.parse(await readFile(path, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      keys = await generateKeys();
      await writeFile(path, JSON.stringify(keys), { mode: 0o600, flag: "wx" });
    }
  }
  const catalog = await loadCatalog(config.dataDir);
  const db = await createDatabase(
    config.databaseUrl,
    join(config.stateDir, "db"),
  );
  const scenarios = JSON.parse(
    await readFile(join(config.dataDir, "fixtures/scenarios.json"), "utf8"),
  ) as Record<string, MockScenario>;
  const service = new GatewayService(
    db,
    catalog,
    config.mock
      ? new MockValioClient(scenarios)
      : new LiveValioClient(config.valioBaseUrl, config.valioApiKey),
    new Signer(keys.privateKey, keys.publicKey),
  );
  await db.transaction(async (repo) => {
    const existing = await repo.get<Agent>("agents", DEMO_AGENT);
    if (!existing) {
      const buyerKeys = await generateKeys();
      await writeFile(
        join(config.stateDir, "buyer-key.json"),
        JSON.stringify(buyerKeys.privateKey),
        { mode: 0o600 },
      );
      const agent: Agent = {
        id: DEMO_AGENT,
        customerId: DEMO_CUSTOMER,
        name: "Hotel Haven buyer",
        active: true,
        scopes: [
          "catalog:read",
          "offers:read",
          "proposals:write",
          "orders:read",
        ],
        publicKey: buyerKeys.publicKey,
        tokenHash: sha256(config.agentToken),
        mandate: defaultMandate(["10400", "10412", "10500", "18701"]),
        createdAt: new Date().toISOString(),
      };
      await repo.put("agents", agent);
      await repo.put("mandates", {
        ...agent.mandate,
        id: `${agent.id}:1`,
        customerId: agent.customerId,
        agentId: agent.id,
      });
      await append(repo, {
        type: "agent.registered",
        customerId: agent.customerId,
        actor: actor("bootstrap", "aimo"),
        refs: { agentId: agent.id },
        payload: { name: agent.name },
      });
    } else if (existing.tokenHash !== sha256(config.agentToken)) {
      existing.tokenHash = sha256(config.agentToken);
      await repo.put("agents", existing);
      await append(repo, {
        type: "agent.token_rotated",
        customerId: existing.customerId,
        actor: actor("bootstrap", "aimo"),
        refs: { agentId: existing.id },
        payload: {},
      });
    }
  });
  return service;
}
