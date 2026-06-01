const REGION_STATUSES = ["yes", "no", "partial", "unknown"];
const CHECK_STATUSES = ["works", "fails", "partial", "unknown", "manual"];
const ACCESS_TYPES = [
  "free",
  "freemium",
  "trial",
  "paid",
  "open-source",
  "school-access",
  "personal-subscription",
  "unknown",
];
const BOT_STATUSES = [
  "works_without_vpn",
  "partial",
  "vpn_required",
  "not_working",
  "not_checked",
  "manual_review",
  "school_access",
  "has_alternative",
];

const form = document.getElementById("serviceForm");
const serviceList = document.getElementById("serviceList");
const serviceCount = document.getElementById("serviceCount");
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const replyPreview = document.getElementById("replyPreview");
const autoRefreshMeta = document.getElementById("autoRefreshMeta");
const saveStatus = document.getElementById("saveStatus");
const newButton = document.getElementById("newButton");
const regionButtons = [...document.querySelectorAll(".region-button")];
const refreshButton = document.getElementById("refreshButton");

let selectedService = null;
let selectedRegion = "RF";
let services = [];

function populateSelect(name, options) {
  const select = form.elements[name];
  select.innerHTML = options.map((value) => `<option value="${value}">${value}</option>`).join("");
}

function initSelects() {
  populateSelect("rf_without_vpn", REGION_STATUSES);
  populateSelect("rb_without_vpn", REGION_STATUSES);
  populateSelect("registration", CHECK_STATUSES);
  populateSelect("login", CHECK_STATUSES);
  populateSelect("post_login", CHECK_STATUSES);
  populateSelect("free_tier", ACCESS_TYPES);
  populateSelect("bot_status", BOT_STATUSES);
}

function normalizeFormPayload() {
  const data = new FormData(form);
  return {
    name: data.get("name").trim(),
    url: data.get("url").trim(),
    category: data.get("category").trim(),
    last_checked: data.get("last_checked"),
    owner: data.get("owner").trim(),
    refresh_enabled: data.get("refresh_enabled").trim(),
    status_url: data.get("status_url").trim(),
    rf_without_vpn: data.get("rf_without_vpn"),
    rb_without_vpn: data.get("rb_without_vpn"),
    registration: data.get("registration"),
    login: data.get("login"),
    post_login: data.get("post_login"),
    free_tier: data.get("free_tier"),
    phone_required: data.get("phone_required").trim(),
    card_required: data.get("card_required").trim(),
    vpn_required: data.get("vpn_required").trim(),
    official_support: splitCsv(data.get("official_support")),
    sources: splitCsv(data.get("sources")),
    alternatives: splitCsv(data.get("alternatives")),
    response_comment: data.get("response_comment").trim(),
    bot_status: data.get("bot_status"),
  };
}

function splitCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinCsv(value) {
  return (value || []).join(", ");
}

function fillForm(item) {
  selectedService = item;
  form.elements.name.value = item.name || "";
  form.elements.url.value = item.url || "";
  form.elements.category.value = item.category || "";
  form.elements.last_checked.value = item.last_checked || "";
  form.elements.owner.value = item.owner || "";
  form.elements.refresh_enabled.value = item.refresh_enabled || "yes";
  form.elements.status_url.value = item.status_url || "";
  form.elements.rf_without_vpn.value = item.rf_without_vpn || "unknown";
  form.elements.rb_without_vpn.value = item.rb_without_vpn || "unknown";
  form.elements.registration.value = item.registration || "unknown";
  form.elements.login.value = item.login || "unknown";
  form.elements.post_login.value = item.post_login || "manual";
  form.elements.free_tier.value = item.free_tier || "unknown";
  form.elements.phone_required.value = item.phone_required || "";
  form.elements.card_required.value = item.card_required || "";
  form.elements.vpn_required.value = item.vpn_required || "";
  form.elements.official_support.value = joinCsv(item.official_support);
  form.elements.sources.value = joinCsv(item.sources);
  form.elements.alternatives.value = joinCsv(item.alternatives);
  form.elements.response_comment.value = item.response_comment || "";
  form.elements.bot_status.value = item.bot_status || "not_checked";
  autoRefreshMeta.textContent = buildAutoRefreshMeta(item);
  updateReplyPreview(item.name);
}

function resetForm() {
  selectedService = null;
  form.reset();
  form.elements.rf_without_vpn.value = "unknown";
  form.elements.rb_without_vpn.value = "unknown";
  form.elements.registration.value = "unknown";
  form.elements.login.value = "unknown";
  form.elements.post_login.value = "manual";
  form.elements.free_tier.value = "unknown";
  form.elements.bot_status.value = "not_checked";
  form.elements.refresh_enabled.value = "yes";
  form.elements.status_url.value = "";
  autoRefreshMeta.textContent = "Автопроверка пока не запускалась.";
  replyPreview.textContent = "Новая карточка. После сохранения здесь появится готовый ответ.";
}

async function fetchServices(query = "") {
  const response = await fetch(`/api/services?query=${encodeURIComponent(query)}`);
  const data = await response.json();
  services = data.items;
  renderServiceList();
}

function renderServiceList() {
  serviceCount.textContent = `${services.length} записей`;
  if (!services.length) {
    serviceList.innerHTML = `<div class="service-item">Ничего не найдено.</div>`;
    return;
  }

  serviceList.innerHTML = services
    .map(
      (item) => `
        <article class="service-item ${selectedService?.name === item.name ? "active" : ""}" data-name="${item.name}">
          <strong>${item.name}</strong>
          <small>${item.category} · ${item.bot_status} · manual ${item.last_checked || "без даты"} · auto ${item.last_auto_refresh || "n/a"}</small>
        </article>
      `,
    )
    .join("");

  [...document.querySelectorAll(".service-item[data-name]")].forEach((node) => {
    node.addEventListener("click", () => {
      const item = services.find((service) => service.name === node.dataset.name);
      fillForm(item);
      renderServiceList();
    });
  });
}

async function updateReplyPreview(serviceName) {
  if (!serviceName) {
    replyPreview.textContent = "Выберите сервис слева или создайте новую карточку.";
    return;
  }

  const response = await fetch(
    `/api/check?service=${encodeURIComponent(serviceName)}&region=${encodeURIComponent(selectedRegion)}`,
  );
  const data = await response.json();
  if (data.service) {
    autoRefreshMeta.textContent = buildAutoRefreshMeta(data.service);
  }
  replyPreview.textContent = data.reply || data.message || "Нет данных.";
}

function buildAutoRefreshMeta(item) {
  if (!item?.last_auto_refresh) {
    return "Автопроверка пока не запускалась.";
  }
  const httpCode = item.last_auto_http_code ? `, HTTP ${item.last_auto_http_code}` : "";
  const note = item.last_auto_note ? `, ${item.last_auto_note}` : "";
  return `Автопроверка: ${item.last_auto_refresh}, статус ${item.last_auto_status}${httpCode}${note}`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveStatus.textContent = "Сохраняю...";
  const payload = normalizeFormPayload();
  const response = await fetch("/api/services/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    saveStatus.textContent = data.error || "Ошибка сохранения";
    return;
  }
  saveStatus.textContent = "Карточка сохранена";
  fillForm(data.item);
  await fetchServices(searchInput.value.trim());
});

searchButton.addEventListener("click", () => fetchServices(searchInput.value.trim()));
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    fetchServices(searchInput.value.trim());
  }
});

newButton.addEventListener("click", () => {
  saveStatus.textContent = "";
  resetForm();
  renderServiceList();
});

regionButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    regionButtons.forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    selectedRegion = button.dataset.region;
    await updateReplyPreview(form.elements.name.value);
  });
});

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  refreshButton.textContent = "Обновляю...";
  const response = await fetch("/api/refresh/run?force=1");
  const data = await response.json();
  refreshButton.disabled = false;
  refreshButton.textContent = "Прогнать автообновление";
  saveStatus.textContent = `Автообновление: ${data.refreshed} refreshed, ${data.skipped} skipped`;
  await fetchServices(searchInput.value.trim());
  if (form.elements.name.value) {
    await updateReplyPreview(form.elements.name.value);
  }
});

initSelects();
resetForm();
fetchServices();
