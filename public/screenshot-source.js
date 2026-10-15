const identities = new WeakMap();
export function legacyScreenshotSourceId(file) {
  return file.name + ":" + file.size + ":" + file.lastModified;
}
export function screenshotSourceId(file) {
  if (!identities.has(file))
    identities.set(
      file,
      file
        .arrayBuffer()
        .then((buffer) => crypto.subtle.digest("SHA-256", buffer))
        .then(
          (bytes) =>
            "sha256-" +
            [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""),
        ),
    );
  return identities.get(file);
}
