import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storage = new Map([["finance-user-example", '{"ops":[]}']]);
let failStorage = false;
globalThis.localStorage = {
  getItem(key) { if (failStorage) throw Error("blocked"); return storage.get(key) ?? null; },
  setItem(key, value) { if (failStorage) throw Error("blocked"); storage.set(key, value); },
};
const element = () => ({ dataset: {}, attributes: {}, textContent: "", innerHTML: "", setAttribute(k,v) { this.attributes[k]=v; } });
const root = element(), meta = element(), manifest = element(), toggle = element(), status = element();
const buttons = ["light", "dark", "system"].map(mode => ({ ...element(), dataset: {themeMode:mode} }));
const listeners = new Map();
const media = { matches: true, addEventListener(type, fn) { listeners.set("media-"+type, fn); } };
globalThis.window = {
  matchMedia(query) { assert.equal(query,"(prefers-color-scheme: dark)"); return media; },
  addEventListener(type, fn) { listeners.set(type, fn); },
};
globalThis.document = {
  documentElement: root,
  querySelector(selector) { return selector.startsWith("meta") ? meta : manifest; },
  querySelectorAll() { return buttons; },
  getElementById(id) { return id === "theme-toggle" ? toggle : status; },
};
const theme = await import("../public/appearance.js");
theme.initializeTheme();
theme.initializeTheme();
assert.equal(listeners.size,2);
assert.equal(root.dataset.theme,"dark");
assert.equal(root.dataset.themeMode,"system");
assert.equal(meta.attributes.content,"#0d1320");
assert.equal(manifest.attributes.href,"/manifest-dark.webmanifest");
media.matches=false;listeners.get("media-change")();
assert.equal(root.dataset.theme,"light");
theme.selectTheme(null,buttons[1]);
assert.equal(storage.get("finance-theme-mode"),"dark");
assert.equal(root.dataset.theme,"dark");
media.matches=false;listeners.get("media-change")();
assert.equal(root.dataset.theme,"dark","manual mode must ignore OS changes");
assert.equal(buttons[1].attributes["aria-pressed"],"true");
theme.toggleTheme();
assert.equal(root.dataset.theme,"light");
assert.equal(storage.get("finance-theme-mode"),"light");
assert.match(toggle.innerHTML,/Светлая/);
assert.equal(manifest.attributes.href,"/manifest-light.webmanifest");
const reload = await import("../public/appearance.js?reload-test");
reload.initializeTheme();
assert.equal(root.dataset.themeMode,"light","reopening must retain the choice");
storage.set("finance-theme-mode","system");media.matches=true;
listeners.get("storage")({key:"finance-theme-mode"});
assert.equal(root.dataset.theme,"dark");
assert.equal(root.dataset.themeMode,"system");
storage.set("finance-theme-mode","invalid");listeners.get("storage")({key:"finance-theme-mode"});
assert.equal(root.dataset.themeMode,"system");
assert.throws(()=>reload.setTheme("invalid"),/режим/);
assert.equal(root.dataset.themeMode,"system");
failStorage=true;reload.setTheme("light");
assert.equal(root.dataset.theme,"light","blocked storage must not block switching");
assert.match(status.textContent,/не разрешил сохранить/);
assert.equal(storage.get("finance-user-example"),'{"ops":[]}',"changing theme must not touch budgets");
assert.match(reload.themeControls(),/Оформление/);
assert.equal((reload.themeControls().match(/data-action="selectTheme"/g)||[]).length,3);
for(const mode of ["light","dark"]) {
 const m=JSON.parse(readFileSync(`public/manifest-${mode}.webmanifest`,"utf8"));
 assert.equal(m.id,"/");assert.equal(m.start_url,"/finance?source=installed");
 assert.equal(m.theme_color,mode==="dark"?"#0d1320":"#f6f8fb");
}
console.log("PASS: light/dark/system, OS changes, persistence/reopen, cross-tab changes, accessible selection, blocked storage, theme metadata and budget preservation");
const css = readFileSync("public/design-tokens.css", "utf8");
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g)].map(m => [m[1],m[2]]));
const light=tokens(css.match(/:root\s*\{([^}]+)\}/)[1]);
const dark={...light,...tokens(css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)[1])};
const luminance = hex => {
 const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
 return .2126*r+.7152*g+.0722*b;
};
for(const palette of [light,dark]) for(const [fg,bg] of [["ink","surface"],["muted","surface"],["muted","raised"],["accent","accent-soft"],["accent-ink","accent"],["success","success-soft"],["warning","warning-soft"],["danger","danger-soft"],["hero-ink","hero"],["success","surface"],["danger","surface"],["warning","surface"],["accent","surface"],["muted","bg"]]) {
 const [low,high]=[luminance(palette[fg]),luminance(palette[bg])].sort((a,b)=>a-b);
 assert.ok((high+.05)/(low+.05)>=4.5,`${fg}/${bg}: text contrast`);
}
console.log("PASS: 28 text contrast combinations in light and dark palettes meet 4.5:1");

assert.notEqual(dark.hero, light.hero, "dark hero must have its own muted background");
assert.notEqual(dark["hero-ink"], light["hero-ink"]);
