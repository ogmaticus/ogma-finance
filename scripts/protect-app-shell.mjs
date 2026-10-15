import { writeFileSync } from "node:fs";
// Sites serves asset files before Worker routes. Keep the source in public/,
// but serve the deployed document through the routes that set security headers.
// Dotted asset paths do not fall through to Worker routes on Sites. Keep a
// compatibility document for installed apps that still start at /app.html.
writeFileSync("dist/client/app.html", '<!doctype html><html lang="ru"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/finance"><title>Финансы</title><a href="/finance">Открыть приложение</a></html>');
