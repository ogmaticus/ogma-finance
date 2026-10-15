// Lets Node load server/*.ts with extensionless relative imports ("./request-body").
// Start with: node --experimental-transform-types --import ./backend/register.mjs backend/main.mjs
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\\.[a-z]+$/i.test(specifier) && context.parentURL?.startsWith("file:")) {
    const candidate = new URL(specifier + ".ts", context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
  }
  return next(specifier, context);
}`),
  import.meta.url,
);
