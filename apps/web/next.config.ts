import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve("../../.env"), quiet: true });
export default {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  transpilePackages: ["@aimo/schema"],
  poweredByHeader: false,
  devIndicators: false,
};
