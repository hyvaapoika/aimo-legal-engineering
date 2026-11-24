import type { Database, Repository } from "@aimo/database";
import {
  DomainError,
  supplierDeclarationSchema,
  type SupplierDeclaration,
} from "@aimo/schema";
import { canonical } from "@aimo/signing";

export async function currentDeclaration(repo: Repository, productId: string) {
  const row = await repo.get<{ declaration: SupplierDeclaration }>(
    "supplier_declarations",
    productId,
  );
  return row?.declaration;
}

/** Trusted operator import. The purchase API never accepts supplier evidence from a buyer. */
export async function importDeclaration(db: Database, raw: unknown, now: Date) {
  const declaration = supplierDeclarationSchema.parse(raw);
  if (Date.parse(declaration.issuedAt) > now.getTime())
    throw new DomainError(
      "FUTURE_DECLARATION",
      "A declaration cannot take effect before it is issued.",
    );
  return db.transaction(async (repo) => {
    const current = await currentDeclaration(repo, declaration.productId);
    if (current && canonical(current) === canonical(declaration))
      return current;
    if (current && declaration.revision <= current.revision)
      throw new DomainError(
        "DECLARATION_REVISION_CONFLICT",
        "Use a higher revision for a changed supplier declaration.",
        409,
      );
    await repo.put("supplier_declarations", {
      id: declaration.productId,
      declaration,
    });
    return declaration;
  });
}
