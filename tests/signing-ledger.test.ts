import { describe, it, expect } from "vitest";
import {
  canonical,
  generateKeys,
  Signer,
  signRequest,
  verifyRequest,
} from "@aimo/signing";
import { append, events, verifyChain } from "@aimo/ledger";
import { createDatabase } from "@aimo/database";
import { now } from "./helpers.js";
describe("cryptographic boundaries", () => {
  it("signs exact canonical content and rejects tampering and wrong keys", async () => {
    const keys = await generateKeys();
    const other = await generateKeys();
    const signer = new Signer(keys.privateKey, keys.publicKey);
    const payload = { price: 1.18, customer: "haven" };
    const signature = await signer.sign(payload);
    expect(
      await signer.verify({ customer: "haven", price: 1.18 }, signature),
    ).toBe(true);
    expect(await signer.verify({ ...payload, price: 0 }, signature)).toBe(
      false,
    );
    expect(
      await new Signer(other.privateKey, other.publicKey).verify(
        payload,
        signature,
      ),
    ).toBe(false);
  });
  it("binds the HTTP method, whole URI, body, lifetime, and key ID", async () => {
    const keys = await generateKeys();
    const url = "https://aimo.example/v1/offers?a=1";
    const body = '{"products":["464201"]}';
    const headers = await signRequest(
      "POST",
      url,
      body,
      keys.privateKey,
      "buyer",
      now,
    );
    await expect(
      verifyRequest(
        new Request(url, { method: "POST", body, headers }),
        keys.publicKey,
        "buyer",
        now,
      ),
    ).resolves.toHaveProperty("nonce");
    await expect(
      verifyRequest(
        new Request(url.replace("a=1", "a=2"), {
          method: "POST",
          body,
          headers,
        }),
        keys.publicKey,
        "buyer",
        now,
      ),
    ).rejects.toThrow("could not be verified");
    await expect(
      verifyRequest(
        new Request(url, { method: "POST", body: "{}", headers }),
        keys.publicKey,
        "buyer",
        now,
      ),
    ).rejects.toThrow("digest");
    await expect(
      verifyRequest(
        new Request(url, { method: "POST", body, headers }),
        keys.publicKey,
        "buyer",
        new Date(now.getTime() + 301000),
      ),
    ).rejects.toThrow("validity");
  });
  it("canonicalizes nested fields predictably", () =>
    expect(canonical({ b: [1, { z: 2, a: 1 }], a: undefined })).toBe(
      '{"b":[1,{"a":1,"z":2}]}',
    ));
});
describe("transactional ledger", () => {
  it("serializes concurrent appends, rolls back failures, and detects modifications", async () => {
    const db = await createDatabase();
    try {
      const event = {
        type: "test",
        customerId: "haven",
        actor: { kind: "aimo" as const, id: "test" },
        refs: {},
        payload: { total: 10 },
      };
      await Promise.all(
        Array.from({ length: 10 }, () =>
          db.transaction((repo) => append(repo, event, now)),
        ),
      );
      await expect(
        db.transaction(async (repo) => {
          await append(repo, event, now);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      const ledger = await db.transaction((repo) => events(repo));
      expect(verifyChain(ledger)).toMatchObject({ valid: true, count: 10 });
      ledger[4]!.payload.total = 0;
      expect(verifyChain(ledger)).toMatchObject({ valid: false, brokenAt: 5 });
    } finally {
      await db.close();
    }
  });
});
