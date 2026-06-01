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
const exportButton = document.getElementById("exportButton");
const regionButtons = [...document.querySelectorAll(".region-button")];
const dataEndpoint = document.getElementById("dataEndpoint");

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

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinCsv(value) {
  return (value || []).join(", ");
}

function normalizeFormPayload() {
  const data = new FormData(form);
  return {
    id: selectedService?.id || crypto.randomUUID(),
    name: data.get("name").trim(),
    url: data.get("url").trim(),
    category: data.get("category").trim() || "unknown",
    last_checked: data.get("last_checked"),
    owner: data.get("owner").trim(),
    refresh_enabled: data.get("refresh_enabled").trim() || "yes",
    status_url: data.get("status_url").trim(),
    rf_without_vpn: data.get("rf_without_vpn"),
    rb_without_vpn: data.get("rb_without_vpn"),
    registration: data.get("registration"),
    login: data.get("login"),
    post_login: data.get("post_login"),
    free_tier: data.get("free_tier"),
    phone_required: data.get("phone_required").trim() || "unknown",
    card_required: data.get("card_required").trim() || "unknown",
    vpn_required: data.get("vpn_required").trim() || "unknown",
    official_support: splitCsv(data.get("official_support")),
    sources: splitCsv(data.get("sources")),
    alternatives: splitCsv(data.get("alternatives")),
    response_comment: data.get("response_comment").trim(),
    bot_status: data.get("bot_status"),
    last_auto_refresh: selectedService?.last_auto_refresh || "",
    last_auto_status: selectedService?.last_auto_status || "unknown",
    last_auto_http_code: selectedService?.last_auto_http_code || 0,
    last_auto_note: selectedService?.last_auto_note || "",
  };
}

function buildChecksSummary(item) {
  const checked = ["сайт"];
  if (["works", "partial", "fails"].includes(item.registration)) checked.push("регистрация");
  if (["works", "partial", "fails"].includes(item.login)) checked.push("вход");
  if (["works", "partial", "fails"].includes(item.post_login)) checked.push("основная функция");
  if (item.free_tier !== "unknown") checked.push("бесплатный тариф");
  return checked.join(" / ");
}

function humanRegion(region) {
  return region === "RF" ? "РФ" : "РБ";
}

function humanRegionStatus(status) {
  return {
    yes: "да",
    no: "нет",
    partial: "частично",
    unknown: "не проверено",
  }[status] || "не проверено";
}

function buildAutoRefreshNote(item) {
  if (!item?.last_auto_refresh) {
    return "";
  }
  if (item.last_auto_status === "ok") {
    return ` Автопроверка сайта от ${item.last_auto_refresh}: главная страница отвечает (HTTP ${item.last_auto_http_code}).`;
  }
  if (item.last_auto_status === "partial") {
    return ` Автопроверка от ${item.last_auto_refresh}: сайт отвечает частично. ${item.last_auto_note || ""}`.trim();
  }
  if (item.last_auto_status === "error") {
    return ` Автопроверка от ${item.last_auto_refresh}: есть ошибка доступа к сайту или status URL. ${item.last_auto_note || ""}`.trim();
  }
  return "";
}

function buildReply(item, region) {
  const regionName = humanRegion(region);
  const regionStatus = region === "RF" ? item.rf_without_vpn : item.rb_without_vpn;
  const checkedAt = item.last_checked || "без даты";
  const checks = buildChecksSummary(item);
  const alternatives = (item.alternatives || []).slice(0, 3).join(", ");
  const comment = item.response_comment ? ` ${item.response_comment}` : "";
  const autoNote = buildAutoRefreshNote(item);

  if (item.bot_status === "works_without_vpn" && regionStatus === "yes") {
    return `По последней проверке от ${checkedAt} сервис ${item.name} открывается в ${regionName} без VPN. Проверено: ${checks}.${autoNote}${comment}`;
  }
  if (item.bot_status === "partial" || regionStatus === "partial") {
    const suffix = alternatives
      ? ` Для стабильной работы можно использовать VPN или альтернативы: ${alternatives}.`
      : "";
    return `По последней проверке сервис ${item.name} частично доступен в ${regionName}: статус без VPN — ${humanRegionStatus(regionStatus)}. Проверено: ${checks}. Работу после входа и ключевые функции стоит перепроверить вручную.${suffix}${autoNote}${comment}`;
  }
  if (item.bot_status === "vpn_required" || item.vpn_required === "yes") {
    const suffix = alternatives ? ` Альтернатива: ${alternatives}.` : "";
    return `По последней проверке для стабильной работы ${item.name} в ${regionName} может понадобиться VPN. Сайт или часть функций могут не работать без него.${suffix}${autoNote}${comment}`;
  }
  if (item.bot_status === "not_working" || regionStatus === "no") {
    const suffix = alternatives ? ` Можно использовать аналоги: ${alternatives}.` : "";
    return `По последней проверке сервис ${item.name} в ${regionName} без VPN не работает или недоступен для стабильного использования.${suffix}${autoNote}${comment}`;
  }
  if (item.bot_status === "school_access") {
    return `По сервису ${item.name} есть школьный доступ. По последней проверке от ${checkedAt} стоит ориентироваться на внутренние инструкции и аккаунты школы.${autoNote}${comment}`;
  }
  if (item.bot_status === "manual_review") {
    return `У сервиса ${item.name} нужна ручная проверка. Сайт может открываться, но нужно отдельно проверить регистрацию, вход, запуск основной функции и экспорт результата в ${regionName}.${autoNote}${comment}`;
  }
  return `У меня нет свежей проверки по сервису ${item.name} для ${regionName}. Нужно проверить: открывается ли сайт без VPN, работает ли вход, запускается ли основная функция, есть ли бесплатный тариф и нужны ли карта или телефон.${autoNote}${comment}`;
}

function updateReplyPreview(serviceName) {
  if (!serviceName) {
    autoRefreshMeta.textContent = "Автопроверка пока не запускалась.";
    replyPreview.textContent = "Выберите сервис слева или создайте новую карточку.";
    return;
  }
  const item = services.find((service) => service.name === serviceName);
  if (!item) {
    replyPreview.textContent = "Сервис не найден в JSON-базе.";
    return;
  }
  autoRefreshMeta.textContent = buildAutoRefreshMetaLine(item);
  replyPreview.textContent = buildReply(item, selectedRegion);
}

function buildAutoRefreshMetaLine(item) {
  if (!item?.last_auto_refresh) {
    return "Автопроверка пока не запускалась.";
  }
  const httpCode = item.last_auto_http_code ? `, HTTP ${item.last_auto_http_code}` : "";
  const note = item.last_auto_note ? `, ${item.last_auto_note}` : "";
  return `Автопроверка: ${item.last_auto_refresh}, статус ${item.last_auto_status}${httpCode}${note}`;
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
  form.elements.phone_required.value = item.phone_required || "unknown";
  form.elements.card_required.value = item.card_required || "unknown";
  form.elements.vpn_required.value = item.vpn_required || "unknown";
  form.elements.official_support.value = joinCsv(item.official_support);
  form.elements.sources.value = joinCsv(item.sources);
  form.elements.alternatives.value = joinCsv(item.alternatives);
  form.elements.response_comment.value = item.response_comment || "";
  form.elements.bot_status.value = item.bot_status || "not_checked";
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
  replyPreview.textContent = "Новая карточка. После редактирования экспортируйте JSON и загрузите его в GitHub.";
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
        <article class="service-item ${selectedService?.id === item.id ? "active" : ""}" data-id="${item.id}">
          <strong>${item.name}</strong>
          <small>${item.category} · ${item.bot_status} · manual ${item.last_checked || "без даты"} · auto ${item.last_auto_refresh || "n/a"}</small>
        </article>
      `,
    )
    .join("");

  [...document.querySelectorAll(".service-item[data-id]")].forEach((node) => {
    node.addEventListener("click", () => {
      const item = services.find((service) => service.id === node.dataset.id);
      fillForm(item);
      renderServiceList();
    });
  });
}

function filterServices(query = "") {
  const normalized = query.trim().toLowerCase();
  const items = normalized
    ? services.filter(
        (item) =>
          item.name.toLowerCase().includes(normalized) ||
          item.category.toLowerCase().includes(normalized),
      )
    : services;

  serviceCount.textContent = `${items.length} записей`;
  if (!items.length) {
    serviceList.innerHTML = `<div class="service-item">Ничего не найдено.</div>`;
    return;
  }

  serviceList.innerHTML = items
    .map(
      (item) => `
        <article class="service-item ${selectedService?.id === item.id ? "active" : ""}" data-id="${item.id}">
          <strong>${item.name}</strong>
          <small>${item.category} · ${item.bot_status} · manual ${item.last_checked || "без даты"} · auto ${item.last_auto_refresh || "n/a"}</small>
        </article>
      `,
    )
    .join("");

  [...document.querySelectorAll(".service-item[data-id]")].forEach((node) => {
    node.addEventListener("click", () => {
      const item = services.find((service) => service.id === node.dataset.id);
      fillForm(item);
      filterServices(searchInput.value.trim());
    });
  });
}

function upsertLocalService(item) {
  const index = services.findIndex((service) => service.id === item.id);
  if (index >= 0) {
    services[index] = item;
  } else {
    services.unshift(item);
  }
  selectedService = item;
}

function exportJson() {
  const payload = {
    updated_at: new Date().toISOString(),
    source: "github-pages-json",
    items: services,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "services.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

async function loadServices() {
  const response = await fetch("./data/services.json", { cache: "no-store" });
  const data = await response.json();
  services = data.items || [];
  services.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  renderServiceList();
  dataEndpoint.textContent = `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, "/")}data/services.json`;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = normalizeFormPayload();
  upsertLocalService(payload);
  saveStatus.textContent = "Локально обновлено. Нажмите Export JSON и загрузите файл в GitHub.";
  fillForm(payload);
  filterServices(searchInput.value.trim());
});

searchButton.addEventListener("click", () => filterServices(searchInput.value.trim()));
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    filterServices(searchInput.value.trim());
  }
});

newButton.addEventListener("click", () => {
  saveStatus.textContent = "";
  resetForm();
  filterServices(searchInput.value.trim());
});

exportButton.addEventListener("click", () => {
  exportJson();
  saveStatus.textContent = "services.json скачан. Загрузите его в репозиторий.";
});

regionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    regionButtons.forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    selectedRegion = button.dataset.region;
    updateReplyPreview(form.elements.name.value);
  });
});

initSelects();
resetForm();
loadServices();
