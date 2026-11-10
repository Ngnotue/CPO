const PAGE_SIZE = 12;
const RESOURCE_KINDS = ["course", "exercise", "resource"];
const list = document.querySelector("[data-resources-list]");
const loading = document.querySelector("[data-resources-loading]");
const empty = document.querySelector("[data-resources-empty]");
const error = document.querySelector("[data-resources-error]");
const unavailable = document.querySelector("[data-resources-unavailable]");
const more = document.querySelector("[data-resources-more]");
const filter = document.querySelector("[data-resource-filter]");
const clearFilter = document.querySelector("[data-resources-clear-filter]");
let offset = 0;
let requestVersion = 0;
let activeController = null;
const MAX_OFFSET = 10_000;

function t(key) {
  const language = document.documentElement.lang === "en" ? "en" : "fr";
  return window.CPO_TRANSLATIONS?.[language]?.[key] || key;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const locale = document.documentElement.lang === "en" ? "en-GB" : "fr-FR";
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date);
}

function createCard(item) {
  const card = document.createElement("article");
  card.className = "resource-card";
  const meta = document.createElement("p");
  meta.className = "resource-meta";
  meta.textContent = `${t(`resources.kind.${item.kind}`)}${item.published_at ? ` · ${formatDate(item.published_at)}` : ""}`;
  const title = document.createElement("h2");
  title.textContent = item.title || "";
  card.append(meta, title);
  if (item.summary?.trim()) {
    const summary = document.createElement("p");
    summary.className = "resource-summary";
    summary.textContent = item.summary;
    card.append(summary);
  }
  if (item.body?.trim()) {
    const body = document.createElement("p");
    body.className = "resource-body";
    body.textContent = item.body;
    card.append(body);
  }
  for (const file of item.files || []) {
    if (!file.url) continue;
    const link = document.createElement("a");
    link.className = "button button-dark resource-download";
    link.href = file.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${t("resources.download")}: ${file.name || "PDF"} ↗`;
    card.append(link);
  }
  return card;
}

async function loadResources({ append = false } = {}) {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const timeout = setTimeout(() => controller.abort(), 12_000);
  filter.disabled = true;
  const version = ++requestVersion;
  const language = document.documentElement.lang === "en" ? "en" : "fr";
  const kinds = filter.value === "all" ? RESOURCE_KINDS : [filter.value];
  more.textContent = t("resources.more");
  if (!append) {
    offset = 0;
    list.replaceChildren();
    empty.hidden = true;
    error.hidden = true;
    unavailable.hidden = true;
    clearFilter.hidden = true;
    more.hidden = true;
    loading.hidden = false;
  } else {
    more.disabled = true;
  }

  try {
    const query = new URLSearchParams({ kind: kinds.join(","), locale: language, limit: String(PAGE_SIZE), offset: String(append ? offset : 0) });
    const response = await fetch(`/api/publications?${query}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("Resources unavailable");
    const payload = await response.json();
    if (version !== requestVersion) return;
    if (payload.configured === false) {
      loading.hidden = true;
      unavailable.hidden = false;
      return;
    }
    const items = Array.isArray(payload.items) ? payload.items : [];
    const fragment = document.createDocumentFragment();
    items.forEach((item) => fragment.append(createCard(item)));
    list.append(fragment);
    offset = append ? offset + items.length : items.length;
    empty.hidden = list.childElementCount > 0;
    if (!list.childElementCount && filter.value !== "all") {
      empty.querySelector("h3").textContent = t("resources.empty.filtered.title");
      empty.querySelector("p").textContent = t("resources.empty.filtered.copy");
      clearFilter.hidden = false;
    } else {
      empty.querySelector("h3").textContent = t("resources.empty.title");
      empty.querySelector("p").textContent = t("resources.empty.copy");
      clearFilter.hidden = true;
    }
    more.hidden = items.length < PAGE_SIZE || offset >= MAX_OFFSET;
  } catch {
    if (version !== requestVersion) return;
    if (append && list.childElementCount) {
      more.hidden = false;
      more.textContent = t("resources.retry");
    } else {
      error.hidden = false;
    }
  } finally {
    clearTimeout(timeout);
    if (version === requestVersion) {
      loading.hidden = true;
      filter.disabled = false;
      more.disabled = false;
      activeController = null;
    }
  }
}

filter.addEventListener("change", () => {
  loadResources();
});
clearFilter.addEventListener("click", () => {
  filter.value = "all";
  loadResources();
});
more.addEventListener("click", () => loadResources({ append: true }));
document.querySelector("[data-resources-retry]").addEventListener("click", () => loadResources());
document.querySelector("[data-language-toggle]")?.addEventListener("click", () => loadResources());
loadResources();
