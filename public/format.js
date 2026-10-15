import { Money } from "./money.js?v=32";
export const $ = (s) => document.querySelector(s),
  money = Money.format,
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
