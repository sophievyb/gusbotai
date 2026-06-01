const topicGrid = document.getElementById("topicGrid");
const replyPreview = document.getElementById("replyPreview");
const autoRefreshMeta = document.getElementById("autoRefreshMeta");
const askForm = document.getElementById("askForm");
const searchInput = document.getElementById("searchInput");
const questionBubble = document.getElementById("questionBubble");
const bubbleTime = document.getElementById("bubbleTime");
const dataEndpoint = document.getElementById("dataEndpoint");
const regionButtons = [...document.querySelectorAll(".region-button")];

let services = [];
let selectedRegion = "RF";

const topicThemes = [
  { key: "directions", icon: "🧭", tone: "green", title: "Про направления" },
  { key: "ai", icon: "🤖", tone: "violet", title: "Про нейросети и сервисы" },
  { key: "lessons", icon: "🖥️", tone: "blue", title: "Про уроки и материалы" },
  { key: "situations", icon: "🧡", tone: "orange", title: "Про сложные ситуации" },
  { key: "process", icon: "👥", tone: "orange", title: "Про тренеров и процессы" },
  { key: "docs", icon: "🧾", tone: "teal", title: "Про качество и документы" },
];

function humanRegion(region) {
  return region === "RF" ? "РФ" : "РБ";
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s.-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

function humanRegionStatus(status) {
  return {
    yes: "да",
    no: "нет",
    partial: "частично",
    unknown: "не проверено",
  }[status] || "не проверено";
}

function buildChecksSummary(item) {
  const checked = ["сайт"];
  if (["works", "partial", "fails"].includes(item.registration)) checked.push("регистрация");
  if (["works", "partial", "fails"].includes(item.login)) checked.push("вход");
  if (["works", "partial", "fails"].includes(item.post_login)) checked.push("основная функция");
  if (item.free_tier && item.free_tier !== "unknown") checked.push("бесплатный тариф");
  return checked.join(" / ");
}

function buildAutoRefreshNote(item) {
  if (!item?.last_auto_refresh) {
    return "";
  }
  if (item.last_auto_status === "ok") {
    return `Автопроверка сайта от ${item.last_auto_refresh}: главная страница отвечает (HTTP ${item.last_auto_http_code}).`;
  }
  if (item.last_auto_status === "partial") {
    return `Автопроверка от ${item.last_auto_refresh}: сайт отвечает частично. ${item.last_auto_note || ""}`.trim();
  }
  if (item.last_auto_status === "error") {
    return `Автопроверка от ${item.last_auto_refresh}: есть ошибка доступа к сайту или status URL. ${item.last_auto_note || ""}`.trim();
  }
  return "Автопроверка пока не запускалась.";
}

function buildReply(item, region) {
  const regionName = humanRegion(region);
  const regionStatus = region === "RF" ? item.rf_without_vpn : item.rb_without_vpn;
  const checkedAt = item.last_checked || "без даты";
  const checks = buildChecksSummary(item);
  const alternatives = (item.alternatives || []).slice(0, 3).join(", ");
  const comment = item.response_comment || "";
  const introByStatus = {
    works_without_vpn: `Сейчас ${item.name}, скорее всего, работает в ${regionName} без VPN.`,
    partial: `Сейчас ${item.name} в ${regionName} работает не идеально.`,
    vpn_required: `Для ${item.name} в ${regionName}, скорее всего, понадобится VPN.`,
    not_working: `Сейчас ${item.name} в ${regionName}, похоже, не работает без VPN.`,
    school_access: `По ${item.name} есть школьный доступ.`,
    manual_review: `По ${item.name} нужна ручная проверка.`,
    not_checked: `По ${item.name} у меня пока нет свежей проверки.`,
  };

  let intro = introByStatus[item.bot_status] || `По ${item.name} у меня нет уверенного статуса.`;
  if (regionStatus === "partial" && item.bot_status !== "vpn_required") {
    intro = `Сейчас ${item.name} в ${regionName} доступен только частично.`;
  }
  if (regionStatus === "yes" && item.bot_status === "works_without_vpn") {
    intro = `Сейчас ${item.name} в ${regionName} открывается без VPN.`;
  }
  if (regionStatus === "no") {
    intro = `Сейчас ${item.name} в ${regionName} без VPN не открывается или работает нестабильно.`;
  }

  const parts = [intro];

  if (item.bot_status === "manual_review") {
    parts.push("Сайт может открываться, но вход, запуск функции и экспорт лучше проверить руками.");
  } else if (item.bot_status === "school_access") {
    parts.push("Лучше ориентироваться на внутренние инструкции и школьные аккаунты.");
  } else {
    parts.push(`По базе от ${checkedAt} проверяли: ${checks}.`);
  }

  if (regionStatus === "partial") {
    parts.push("Обычно проблема не в самом сайте, а во входе, генерации, экспорте или отдельных AI-функциях.");
  }

  if (item.vpn_required === "yes" || item.bot_status === "vpn_required") {
    parts.push("Если сервис нужен прямо сейчас, лучше сразу пробовать через VPN.");
  }

  if (alternatives) {
    parts.push(`Если не заработает, можно взять альтернативы: ${alternatives}.`);
  }

  if (comment) {
    parts.push(comment);
  }

  return parts.join(" ");
}

function detectTopic(item, index) {
  if (item.category === "text") return topicThemes[1];
  if (item.category === "design") return topicThemes[index % topicThemes.length];
  return topicThemes[index % topicThemes.length];
}

function buildSearchIndex(item) {
  const aliases = item.aliases || [];
  const parts = [item.name, item.category, ...aliases, ...(item.alternatives || [])];
  return normalizeText(parts.join(" "));
}

function buildTopicDescription(item) {
  const regionText = `РФ: ${humanRegionStatus(item.rf_without_vpn)}, РБ: ${humanRegionStatus(item.rb_without_vpn)}.`;
  const altText = (item.alternatives || []).length
    ? ` Аналоги: ${(item.alternatives || []).slice(0, 2).join(", ")}.`
    : "";
  return `${regionText} ${item.free_tier !== "unknown" ? `Доступ: ${item.free_tier}.` : ""}${altText}`.trim();
}

function renderTopics() {
  const items = services.slice(0, 6).map((item, index) => {
    const theme = detectTopic(item, index);
    return `
      <article class="topic-card ${theme.tone}" data-service="${item.name}">
        <div class="topic-icon ${theme.tone}">${theme.icon}</div>
        <div>
          <h3>${theme.title}</h3>
          <p>${buildTopicDescription(item)}</p>
        </div>
      </article>
    `;
  });

  topicGrid.innerHTML = items.join("");
  [...document.querySelectorAll(".topic-card[data-service]")].forEach((card) => {
    card.addEventListener("click", () => {
      const service = services.find((item) => item.name === card.dataset.service);
      if (!service) return;
      searchInput.value = `Проверь ${service.name}: работает ли в ${humanRegion(selectedRegion)} и нужен ли VPN?`;
      submitService(service);
    });
  });
}

function findServiceByQuery(query) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = new Set(tokenize(query));
  let bestMatch = null;
  let bestScore = 0;

  for (const item of services) {
    const aliases = [item.name, ...(item.aliases || [])];
    const haystack = buildSearchIndex(item);
    let score = 0;

    for (const alias of aliases) {
      const normalizedAlias = normalizeText(alias);
      if (!normalizedAlias) continue;
      if (normalizedQuery === normalizedAlias) {
        score += 120;
      }
      if (normalizedQuery.includes(normalizedAlias)) {
        score += Math.max(80, normalizedAlias.length * 2);
      }
      if (normalizedAlias.includes(normalizedQuery) && normalizedQuery.length >= 4) {
        score += 30;
      }
    }

    const aliasTokens = new Set(tokenize(haystack));
    for (const token of queryTokens) {
      if (aliasTokens.has(token)) {
        score += token.length >= 5 ? 18 : 10;
      } else {
        for (const aliasToken of aliasTokens) {
          if (aliasToken.startsWith(token) || token.startsWith(aliasToken)) {
            score += 6;
            break;
          }
        }
      }
    }

    if (normalizedQuery.includes(normalizeText(item.category))) {
      score += 8;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  return bestScore >= 18 ? bestMatch : null;
}

function updateQuestionBubble(text) {
  questionBubble.textContent = text;
  const now = new Date();
  bubbleTime.textContent = now.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function submitService(service) {
  updateQuestionBubble(searchInput.value.trim() || `Проверь ${service.name}`);
  replyPreview.textContent = buildReply(service, selectedRegion);
  autoRefreshMeta.textContent = buildAutoRefreshNote(service);
}

async function loadServices() {
  const response = await fetch("./data/services.json", { cache: "no-store" });
  const data = await response.json();
  services = data.items || [];
  renderTopics();
  dataEndpoint.href = `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, "/")}data/services.json`;
  dataEndpoint.textContent = "источники";
  const initial = findServiceByQuery(questionBubble.textContent);
  if (initial) {
    replyPreview.textContent = buildReply(initial, selectedRegion);
    autoRefreshMeta.textContent = buildAutoRefreshNote(initial);
  } else {
    replyPreview.textContent = "В JSON-базе пока нет сервисов.";
    autoRefreshMeta.textContent = "Нет данных для автопроверки.";
  }
}

askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  const service = findServiceByQuery(query);
  if (!service) {
    updateQuestionBubble(query);
    replyPreview.textContent =
      "Не нашёл точного совпадения в базе. Добавьте сервис в services.json или уточните название.";
    autoRefreshMeta.textContent = "Автопроверка недоступна: сервис не найден.";
    return;
  }
  submitService(service);
});

regionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    regionButtons.forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    selectedRegion = button.dataset.region;
    const service = findServiceByQuery(questionBubble.textContent);
    if (service) {
      replyPreview.textContent = buildReply(service, selectedRegion);
      autoRefreshMeta.textContent = buildAutoRefreshNote(service);
    }
  });
});

loadServices();
