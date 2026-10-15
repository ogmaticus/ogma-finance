import { format } from "prettier";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const release = JSON.parse(readFileSync("release.json", "utf8"));
writeFileSync(
  "public/release-info.js",
  `export const APP_VERSION = ${JSON.stringify(release.display)};\n`,
);
const modules = readdirSync("public").filter((name) => name.endsWith(".js") && name !== "sw.js");
for (const name of modules) {
  const path = "public/" + name;
  writeFileSync(path, readFileSync(path, "utf8").replace(/\.js\?v=\d+/g, ".js?v=" + release.shell));
}
const path = "public/app.html";
writeFileSync(
  path,
  readFileSync(path, "utf8")
    .replace(/\?v=\d+/g, "?v=" + release.shell)
    .replace(/прототип · v[\d.]+/i, "прототип · v" + release.display),
);
const core = [
  "/finance",
  "/manifest.webmanifest",
  "/manifest-light.webmanifest",
  "/manifest-dark.webmanifest",
  "/brand.svg",
  "/icons/icon-180.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/base.css?v=" + release.shell,
  "/design-tokens.css?v=" + release.shell,
  "/theme.css?v=" + release.shell,
  "/appearance.css?v=" + release.shell,
  "/shell.css?v=" + release.shell,
  ...modules.map((name) => "/" + name + "?v=" + release.shell),
];
writeFileSync(
  "public/sw.js",
  await format(
    readFileSync("scripts/sw-template.js", "utf8")
      .replace("__RELEASE__", JSON.stringify(String(release.shell)))
      .replace("__OCR_VERSION__", JSON.stringify(String(release.ocr)))
      .replace("__CORE__", JSON.stringify(core)),
    { parser: "babel", ...JSON.parse(readFileSync(".prettierrc.json", "utf8")) },
  ),
);
