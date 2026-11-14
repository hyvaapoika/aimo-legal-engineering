import { configuration } from "../apps/gateway/src/config.js";
import { bootstrap } from "../apps/gateway/src/service.js";
const service = await bootstrap(configuration());
try {
  await service.db.transaction(async (repo) => {
    for (let i = 0; i < service.catalog.products.length; i += 500) {
      const products = service.catalog.products.slice(i, i + 500);
      await repo.sql.query(
        `INSERT INTO catalog_products (id,data,search) SELECT value->>'id', value, to_tsvector('simple', coalesce(value->'names'->>'fi','') || ' ' || coalesce(value->'names'->>'en','')) FROM jsonb_array_elements($1::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data,search=excluded.search`,
        [JSON.stringify(products)],
      );
    }
  });
  console.log(
    `Ingested ${service.catalog.products.length} products with PostgreSQL full-text index.`,
  );
  console.log(
    `Net content known: ${service.catalog.products.filter((p) => p.netContent).length}; inferred: ${service.catalog.products.filter((p) => p.netContent?.inferred).length}.`,
  );
} finally {
  await service.db.close();
}
