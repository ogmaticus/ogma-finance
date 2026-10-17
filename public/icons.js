const paths = {
  "chevron-left": '<path d="m15 5-7 7 7 7"/>',
  search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
  overview: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/>',
  operations: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
  budget: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M4 10h16M9 4v17M14 15h3"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  more: '<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
  accounts: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20M5 15h4"/>',
  goals: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 21 3"/>',
  analytics: '<path d="M4 3v18h17M8 16l4-5 4 2 5-7"/>',
  categories:
    '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.9M12 17.2v.1"/>',
  profile: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  settings:
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="7" cy="18" r="2"/>',
  screenshot:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  edit: '<path d="m15 4 5 5M4 20l1-5L17 3l4 4L9 19l-5 1Z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  cloud: '<path d="M5 18a5 5 0 0 1-1-10 7 7 0 0 1 13-2 6 6 0 0 1 2 12"/>',
  "cloud-check": '<path d="M5 18a5 5 0 0 1-1-10 7 7 0 0 1 13-2 6 6 0 0 1 2 12M8 17l3 3 6-6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 2M4 17l2 2a8 8 0 0 0 13-2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17v.1"/>',
  cart: '<path d="M2 4h3l3 11h11l3-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  coffee: '<path d="M4 5h13v10l-2 3H6l-2-3V5ZM17 7h4v5h-4M3 22h16"/>',
  transfer: '<path d="M3 7h17l-4-4M21 17H4l4 4"/>',
  shopping: '<path d="M4 8h16v13H4V8ZM8 8V4h8v4"/>',
  transport:
    '<rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 10h16M7 19v3M17 19v3M8 15h1M15 15h1"/>',
  health: '<path d="M12 21 3 12V6l4-3 5 4 5-4 4 3v6l-9 9Z"/>',
  entertainment: '<path d="m6 3 15 9-15 9V3Z"/>',
  income: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
};
export function icon(name, className = "ui-icon") {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.more}</svg>`;
}
export function categoryVisual(category, type) {
  if (type === "transfer") return { icon: "transfer", tone: "neutral" };
  if (type === "income") return { icon: "income", tone: "mint" };
  const key = (category || "").toLowerCase();
  if (/зарплат|доход/.test(key)) return { icon: "income", tone: "mint" };
  if (/другое/.test(key)) return { icon: "categories", tone: "neutral" };
  if (/продукт|супермаркет/.test(key)) return { icon: "cart", tone: "mint" };
  if (/кафе|фастфуд|ресторан/.test(key)) return { icon: "coffee", tone: "amber" };
  if (/транспорт|проезд/.test(key)) return { icon: "transport", tone: "blue" };
  if (/жиль|коммун/.test(key)) return { icon: "overview", tone: "amber" };
  if (/здоров|аптек/.test(key)) return { icon: "health", tone: "rose" };
  if (/развлеч|подпис/.test(key)) return { icon: "entertainment", tone: "purple" };
  return { icon: "shopping", tone: "purple" };
}
