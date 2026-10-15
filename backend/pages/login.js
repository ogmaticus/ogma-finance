const CONSENT_VERSION = "2026-10-15";
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const rawReturn = params.get("return_to") || "/finance";
const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/finance";
let email = "";

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {}
  if (!response.ok) {
    const error = new Error(data.error || "Сервис временно недоступен. Попробуйте позже.");
    error.code = data.code;
    throw error;
  }
  return data;
}

function busy(button, on) {
  button.disabled = on;
  button.dataset.label ??= button.textContent;
  button.textContent = on ? "Подождите…" : button.dataset.label;
}

$("emailstep").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("emailerror").textContent = "";
  if (!$("email").value.trim() || !$("email").checkValidity()) return ($("emailerror").textContent = "Укажите корректный адрес почты");
  if (!$("consent").checked) return ($("emailerror").textContent = "Без согласия на обработку данных создать аккаунт нельзя");
  busy($("sendcode"), true);
  try {
    const result = await post("/api/auth/request-code", { email: $("email").value });
    email = result.email;
    $("sentto").textContent = email;
    $("emailstep").hidden = true;
    $("codestep").hidden = false;
    $("code").focus();
  } catch (error) {
    $("emailerror").textContent = error.message;
  } finally {
    busy($("sendcode"), false);
  }
});

$("codestep").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("codeerror").textContent = "";
  const code = $("code").value.replace(/\D/g, "");
  if (code.length !== 6) return ($("codeerror").textContent = "Введите 6 цифр из письма");
  busy($("verify"), true);
  try {
    await post("/api/auth/verify", { email, code, consent: $("consent").checked ? CONSENT_VERSION : null });
    location.replace(returnTo);
  } catch (error) {
    $("codeerror").textContent = error.message;
    busy($("verify"), false);
  }
});

$("code").addEventListener("input", () => {
  const value = $("code").value.replace(/\D/g, "").slice(0, 6);
  if (value !== $("code").value) $("code").value = value;
  if (value.length === 6) $("codestep").requestSubmit();
});

$("back").addEventListener("click", () => {
  $("codestep").hidden = true;
  $("emailstep").hidden = false;
  $("code").value = "";
  $("email").focus();
});
