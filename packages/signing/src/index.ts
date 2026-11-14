import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  generateKeyPair,
  exportJWK,
  importJWK,
  CompactSign,
  compactVerify,
  type JWK,
} from "jose";
import { DomainError } from "@aimo/schema";

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`)
    .join(",")}}`;
}
export const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export function constantEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function generateKeys() {
  const pair = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const privateKey = await exportJWK(pair.privateKey);
  const publicKey = await exportJWK(pair.publicKey);
  const kid = sha256(canonical(publicKey)).slice(0, 24);
  return {
    privateKey: { ...privateKey, kid },
    publicKey: { ...publicKey, kid, use: "sig", alg: "EdDSA" },
  };
}
export class Signer {
  constructor(
    readonly privateKey: JWK,
    readonly publicKey: JWK,
  ) {}
  async sign(payload: unknown) {
    return new CompactSign(new TextEncoder().encode(canonical(payload)))
      .setProtectedHeader({
        alg: "EdDSA",
        kid: this.publicKey.kid,
        typ: "JOSE",
      })
      .sign(await importJWK(this.privateKey, "EdDSA"));
  }
  async verify(payload: unknown, signature: string): Promise<boolean> {
    try {
      const verified = await compactVerify(
        signature,
        await importJWK(this.publicKey, "EdDSA"),
        { algorithms: ["EdDSA"] },
      );
      return constantEqual(
        new TextDecoder().decode(verified.payload),
        canonical(payload),
      );
    } catch {
      return false;
    }
  }
}
const digest = (body: string) =>
  `sha-256=:${createHash("sha256").update(body).digest("base64")}:`;
function signatureBase(
  method: string,
  url: URL,
  bodyDigest: string,
  parameters: string,
) {
  return `"@method": ${method.toUpperCase()}\n"@target-uri": ${url.href}\n"content-digest": ${bodyDigest}\n"@signature-params": ${parameters}`;
}
// Restricted RFC 9421 profile: a single sig1 label, Ed25519, fixed covered components.
// @target-uri binds query parameters and host in addition to the path.
export async function signRequest(
  method: string,
  url: string,
  body: string,
  privateKey: JWK,
  keyId: string,
  now = new Date(),
) {
  const created = Math.floor(now.getTime() / 1000);
  const parameters = `("@method" "@target-uri" "content-digest");created=${created};expires=${created + 300};nonce="${token()}";keyid="${keyId}";alg="ed25519"`;
  const contentDigest = digest(body);
  const key = await importJWK(privateKey, "EdDSA");
  const { sign } = await import("node:crypto");
  const { KeyObject } = await import("node:crypto");
  const signature = sign(
    null,
    Buffer.from(signatureBase(method, new URL(url), contentDigest, parameters)),
    key instanceof Uint8Array
      ? Buffer.from(key)
      : KeyObject.from(key as CryptoKey),
  );
  return {
    "Content-Digest": contentDigest,
    "Signature-Input": `sig1=${parameters}`,
    Signature: `sig1=:${signature.toString("base64")}:`,
  };
}
export async function verifyRequest(
  request: Request,
  publicKey: JWK,
  expectedKeyId: string,
  now = new Date(),
) {
  const input = request.headers.get("signature-input") ?? "";
  const match =
    /^sig1=(\("@method" "@target-uri" "content-digest"\);created=(\d+);expires=(\d+);nonce="([A-Za-z0-9_-]{20,100})";keyid="([A-Za-z0-9_-]+)";alg="ed25519")$/.exec(
      input,
    );
  const signature = /^sig1=:([A-Za-z0-9+/=]+):$/.exec(
    request.headers.get("signature") ?? "",
  );
  if (!match || !signature || match[5] !== expectedKeyId)
    throw new DomainError(
      "INVALID_SIGNATURE",
      "The signed-request profile is invalid.",
      401,
    );
  const created = Number(match[2]);
  const expires = Number(match[3]);
  const time = now.getTime() / 1000;
  if (
    created > time + 30 ||
    created < time - 300 ||
    expires <= time ||
    expires > created + 300 ||
    expires <= created
  )
    throw new DomainError(
      "EXPIRED_SIGNATURE",
      "Request signature is outside its validity window.",
      401,
    );
  const bodyDigest = digest(await request.clone().text());
  if (!constantEqual(bodyDigest, request.headers.get("content-digest") ?? ""))
    throw new DomainError(
      "INVALID_DIGEST",
      "Request body digest does not match.",
      401,
    );
  const { verify, createPublicKey } = await import("node:crypto");
  const valid = verify(
    null,
    Buffer.from(
      signatureBase(
        request.method,
        new URL(request.url),
        bodyDigest,
        match[1]!,
      ),
    ),
    createPublicKey({ key: publicKey, format: "jwk" }),
    Buffer.from(signature[1]!, "base64"),
  );
  if (!valid)
    throw new DomainError(
      "INVALID_SIGNATURE",
      "Request signature could not be verified.",
      401,
    );
  return {
    nonce: match[4]!,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}
