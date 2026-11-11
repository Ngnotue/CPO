import { uploadPublicationFiles } from "./publication-upload.js";

const loginPanel = document.querySelector("[data-login-panel]");
const workspace = document.querySelector("[data-staff-workspace]");
const dashboard = document.querySelector("[data-dashboard]");
const passwordPanel = document.querySelector("[data-password-panel]");
const adminPanels = document.querySelectorAll("[data-admin-panel]");
const staffNotice = document.querySelector("[data-staff-notice]");
let currentProfile = null;
let editingPublicationId = "";
let editingFiles = [];
let completedUploadFiles = new WeakSet();
let publicationOffset = 0;
let publicationListVersion = 0;
const STAFF_PUBLICATION_PAGE_SIZE = 50;

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "La demande n'a pas abouti.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function feedback(selector, message, isError = false) {
  const element = document.querySelector(selector);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

function addText(parent, tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value || "";
  parent.append(element);
  return element;
}

function dateLabel(value) {
  if (!value) return "Brouillon";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date inconnue" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function toLocalDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localDateTimeToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function setAuthenticated(profile) {
  currentProfile = profile;
  loginPanel.hidden = true;
  workspace.hidden = false;
  document.querySelector("[data-staff-name]").textContent = profile.full_name;
  document.querySelector("[data-staff-role]").textContent = profile.role === "admin" ? "Administration CPO" : `Professeur${profile.subject ? ` · ${profile.subject}` : ""}`;
  const forceChange = profile.must_change_password === true;
  passwordPanel.hidden = !forceChange;
  dashboard.hidden = forceChange;
  adminPanels.forEach((panel) => { panel.hidden = forceChange || profile.role !== "admin"; });
  staffNotice.textContent = forceChange ? "Pour protéger votre compte, définissez votre mot de passe personnel avant de continuer." : "Les contenus publics ne sont visibles sur l'accueil qu'après publication.";
  if (!forceChange) refreshDashboard();
}

async function loadSession() {
  try {
    const data = await request("/api/staff/session");
    if (!data.configured) {
      loginPanel.hidden = false;
      feedback("[data-login-feedback]", "Supabase n'est pas encore configuré sur le serveur.", true);
      return;
    }
    if (data.authenticated) setAuthenticated(data.profile);
  } catch (error) {
    if (error.status !== 401) feedback("[data-login-feedback]", error.message, true);
  }
}

async function refreshDashboard() {
  await loadPublicationsForStaff();
  if (currentProfile?.role !== "admin") return;
  await Promise.all([loadTeachers(), loadPrivateResults(), loadAuditLog()]);
}

async function loadPublicationsForStaff({ append = false } = {}) {
  const list = document.querySelector("[data-publication-list]");
  const more = document.querySelector("[data-publication-more]");
  const version = ++publicationListVersion;
  if (!append) {
    publicationOffset = 0;
    list.replaceChildren();
    more.hidden = true;
  } else {
    more.disabled = true;
  }
  try {
    const state = document.querySelector("[data-publication-state]")?.value || "all";
    const { items = [], hasMore = false } = await request(`/api/staff/publications?state=${encodeURIComponent(state)}&offset=${publicationOffset}`);
    if (version !== publicationListVersion) return;
    if (!items.length && !append) {
      addText(list, "p", "staff-list-empty", "Aucun contenu pour l'instant.");
      return;
    }
    for (const item of items) {
      const row = document.createElement("article");
      row.className = "staff-list-row";
      const copy = document.createElement("div");
      addText(copy, "p", "staff-list-meta", `${item.kind} · ${item.locale.toUpperCase()} · ${item.status} · ${dateLabel(item.published_at || item.updated_at)}${item.expires_at ? ` · Expire le ${dateLabel(item.expires_at)}` : ""}`);
      addText(copy, "h3", "", item.title);
      const isExpired = item.status === "published" && item.expires_at && new Date(item.expires_at) <= new Date();
      if (isExpired) addText(copy, "p", "staff-expired-badge", "Expirée · non visible sur le site public");
      addText(copy, "p", "staff-list-summary", item.summary);
      if (item.body?.trim()) addText(copy, "p", "staff-list-body", item.body);
      for (const file of item.files || []) {
        if (!file.url) continue;
        const link = addText(copy, "a", "staff-file-link", `↳ ${file.name}`);
        link.href = file.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      const actions = document.createElement("div");
      actions.className = "staff-list-actions";
      const edit = addText(actions, "button", "staff-secondary", "Modifier");
      edit.type = "button";
      edit.addEventListener("click", () => editPublication(item));
      if (item.status === "archived") {
        const restore = addText(actions, "button", "staff-secondary", "Restaurer comme brouillon");
        restore.type = "button";
        restore.addEventListener("click", () => restorePublicationAsDraft(item.id));
      }
      if (isExpired) {
        const renew = addText(actions, "button", "staff-secondary", "Renouveler");
        renew.type = "button";
        renew.addEventListener("click", () => {
          editPublication(item);
          const form = document.querySelector("[data-publication-form]");
          form.elements.expires_at.value = "";
          validatePublicationExpiry();
          feedback("[data-publication-feedback]", "Choisissez une nouvelle date future, ou laissez le champ vide pour ne pas définir d’expiration.");
        });
      }
      if (item.status !== "archived") {
        const archive = addText(actions, "button", "staff-secondary", "Archiver");
        archive.type = "button";
        archive.addEventListener("click", () => archivePublication(item.id));
      }
      row.append(copy, actions);
      list.append(row);
    }
    publicationOffset += items.length;
    more.hidden = !hasMore;
    more.textContent = "Voir plus";
  } catch (error) {
    if (version !== publicationListVersion) return;
    if (append) {
      more.hidden = false;
      more.textContent = "Réessayer";
      feedback("[data-publication-feedback]", error.message, true);
    } else addText(list, "p", "staff-list-empty is-error", error.message);
  } finally {
    if (version === publicationListVersion) more.disabled = false;
  }
}

function editPublication(item) {
  const form = document.querySelector("[data-publication-form]");
  editingPublicationId = item.id;
  completedUploadFiles = new WeakSet();
  form.elements.id.value = item.id;
  for (const field of ["title", "kind", "locale", "category", "summary", "body", "status", "visibility"]) {
    if (form.elements[field]) form.elements[field].value = item[field] ?? (field === "locale" ? "fr" : "");
  }
  form.elements.expires_at.value = toLocalDateTimeValue(item.expires_at);
  validatePublicationExpiry();
  form.elements.is_important.checked = item.is_important === true;
  editingFiles = [...(item.files || [])];
  renderAttachmentList(form.querySelector("[data-publication-files]").files);
  document.querySelector("[data-editor-heading]").textContent = "Modifier une publication";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetEditor() {
  editingPublicationId = "";
  editingFiles = [];
  completedUploadFiles = new WeakSet();
  document.querySelector("[data-publication-form]").reset();
  document.querySelector("[data-publication-form]").elements.id.value = "";
  document.querySelector("[data-attachment-list]").replaceChildren();
  document.querySelector("[data-editor-heading]").textContent = "Nouvelle publication";
  feedback("[data-expiry-hint]", "");
  feedback("[data-publication-feedback]", "");
}

function validatePublicationExpiry() {
  const form = document.querySelector("[data-publication-form]");
  const input = form.elements.expires_at;
  const hint = document.querySelector("[data-expiry-hint]");
  const expiry = input.value ? new Date(input.value) : null;
  const publishDate = new Date();
  input.setCustomValidity("");
  hint.hidden = true;
  if (form.elements.status.value === "published") {
    publishDate.setSeconds(0, 0);
    if (expiry && expiry <= publishDate) {
      input.setCustomValidity("La date d’expiration doit être future.");
      hint.textContent = "La date d’expiration doit être postérieure à la date actuelle.";
      hint.hidden = false;
    }
    return;
  }
  if (expiry && expiry <= new Date()) {
    input.setCustomValidity("La date d’expiration doit être future.");
    hint.textContent = "La date d’expiration doit être postérieure à la date actuelle.";
    hint.hidden = false;
  }
}

document.querySelector('[data-publication-form] [data-publication-expiry]').addEventListener("input", validatePublicationExpiry);
document.querySelector('[data-publication-form] select[name="status"]').addEventListener("change", validatePublicationExpiry);

async function archivePublication(id) {
  if (!window.confirm("Archiver ce contenu ? Il ne sera plus visible sur le site public.")) return;
  try {
    await request(`/api/staff/publications/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadPublicationsForStaff();
  } catch (error) {
    feedback("[data-publication-feedback]", error.message, true);
  }
}

async function restorePublicationAsDraft(id) {
  if (!window.confirm("Restaurer ce contenu comme brouillon ? Il restera privé jusqu’à sa republication.")) return;
  try {
    await request(`/api/staff/publications/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: "draft" }) });
    feedback("[data-publication-feedback]", "Contenu restauré comme brouillon. Il restera masqué du site public.");
    await loadPublicationsForStaff();
  } catch (error) {
    feedback("[data-publication-feedback]", error.message, true);
  }
}

async function loadTeachers() {
  const list = document.querySelector("[data-teacher-list]");
  list.replaceChildren();
  try {
    const { teachers = [] } = await request("/api/staff/teachers");
    for (const teacher of teachers.filter((entry) => entry.role === "teacher")) {
      const row = document.createElement("article");
      row.className = "staff-list-row";
      const copy = document.createElement("div");
      addText(copy, "h3", "", teacher.full_name);
      addText(copy, "p", "staff-list-meta", `${teacher.teacher_code || "Sans identifiant"} · ${teacher.subject || "Sans matière"} · ${teacher.is_active ? "Actif" : "Suspendu"}`);
      const toggle = addText(row, "button", "staff-secondary", teacher.is_active ? "Suspendre" : "Activer");
      toggle.type = "button";
      toggle.addEventListener("click", async () => {
        try {
          await request(`/api/staff/teachers/${encodeURIComponent(teacher.id)}`, { method: "PATCH", body: JSON.stringify({ is_active: !teacher.is_active }) });
          await loadTeachers();
        } catch (error) { feedback("[data-teacher-feedback]", error.message, true); }
      });
      row.prepend(copy);
      list.append(row);
    }
    if (!teachers.some((entry) => entry.role === "teacher")) addText(list, "p", "staff-list-empty", "Aucun compte professeur.");
  } catch (error) {
    addText(list, "p", "staff-list-empty is-error", error.message);
  }
}

async function loadPrivateResults() {
  const list = document.querySelector("[data-result-list]");
  list.replaceChildren();
  try {
    const { results = [] } = await request("/api/staff/results");
    for (const result of results) {
      const row = document.createElement("article");
      row.className = "staff-list-row staff-private-result";
      addText(row, "div", "staff-list-meta", `${result.exam_name} · ${dateLabel(result.published_at || result.created_at)}`);
      addText(row, "strong", "", result.student_name);
      addText(row, "span", "", result.result_value);
      list.append(row);
    }
    if (!results.length) addText(list, "p", "staff-list-empty", "Aucun résultat enregistré.");
  } catch (error) {
    addText(list, "p", "staff-list-empty is-error", error.message);
  }
}

async function loadAuditLog() {
  const list = document.querySelector("[data-audit-list]");
  if (!list) return;
  list.replaceChildren();
  try {
    const { events = [] } = await request("/api/staff/audit");
    for (const event of events) {
      const row = document.createElement("article");
      row.className = "staff-list-row staff-audit-row";
      const copy = document.createElement("div");
      addText(copy, "p", "staff-list-meta", `${dateLabel(event.created_at)} · ${event.target_type}`);
      addText(copy, "h3", "", event.action.replaceAll(".", " · "));
      if (event.target_id) addText(copy, "p", "staff-list-meta", `Référence : ${event.target_id}`);
      row.append(copy);
      list.append(row);
    }
    if (!events.length) addText(list, "p", "staff-list-empty", "Aucune action enregistrée.");
  } catch (error) {
    addText(list, "p", "staff-list-empty is-error", error.message);
  }
}

document.querySelector("[data-login-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  feedback("[data-login-feedback]", "Connexion en cours…");
  try {
    const data = await request("/api/staff/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    setAuthenticated(data.profile);
  } catch (error) {
    feedback("[data-login-feedback]", error.message, true);
  } finally { submit.disabled = false; }
});

document.querySelector("[data-password-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  if (values.password !== values.confirmation) return feedback("[data-password-feedback]", "Les deux mots de passe ne correspondent pas.", true);
  try {
    await request("/api/staff/password", { method: "POST", body: JSON.stringify({ password: values.password }) });
    feedback("[data-password-feedback]", "Mot de passe mis à jour.");
    await loadSession();
  } catch (error) { feedback("[data-password-feedback]", error.message, true); }
});

document.querySelector("[data-logout]").addEventListener("click", async () => {
  try { await request("/api/staff/logout", { method: "POST", body: "{}" }); } finally { window.location.reload(); }
});
document.querySelector("[data-reset-editor]").addEventListener("click", resetEditor);
document.querySelector("[data-publication-state]").addEventListener("change", () => loadPublicationsForStaff());
document.querySelector("[data-publication-more]").addEventListener("click", () => loadPublicationsForStaff({ append: true }));

function safeUploadName(value) {
  return String(value || "fichier").split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, "").trim();
}

document.querySelector("[data-publication-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const files = [...form.querySelector('[data-publication-files]').files];
  const id = editingPublicationId;
  delete data.id;
  delete data.files;
  data.is_important = form.elements.is_important.checked;
  data.expires_at = localDateTimeToIso(form.elements.expires_at.value);
  validatePublicationExpiry();
  if (!form.reportValidity()) return;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  let publicationSaved = false;
  try {
    const saved = await request(id ? `/api/staff/publications/${encodeURIComponent(id)}` : "/api/staff/publications", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    const publicationId = id || saved.item?.id;
    if (!publicationId) throw new Error("La publication a été enregistrée sans identifiant retourné.");
    publicationSaved = true;
    editingPublicationId = publicationId;
    form.elements.id.value = publicationId;
    if (files.length) {
      feedback("[data-publication-feedback]", `Envoi de ${files.length} fichier(s)…`);
      await uploadPublicationFiles(publicationId, files, {
        request,
        completedFiles: completedUploadFiles,
        onFileComplete: () => renderAttachmentList(files)
      });
    }
    feedback("[data-publication-feedback]", id ? "Publication mise à jour." : "Publication enregistrée.");
    resetEditor();
    await loadPublicationsForStaff();
  } catch (error) {
    if (files.length) renderAttachmentList(files);
    const message = publicationSaved
      ? `Le contenu est enregistré. ${error.message} Corrigez le problème puis réessayez : les fichiers déjà envoyés seront ignorés.`
      : error.message;
    feedback("[data-publication-feedback]", message, true);
  }
  finally { submit.disabled = false; }
});

document.querySelector('[data-publication-form] [data-publication-files]').addEventListener("change", (event) => {
  renderAttachmentList(event.currentTarget.files);
});

function renderAttachmentList(pendingFiles = []) {
  const list = document.querySelector("[data-attachment-list]");
  list.replaceChildren();
  for (const file of editingFiles) {
    const row = document.createElement("div");
    row.className = "staff-attachment-row";
    if (file.url) {
      const link = addText(row, "a", "staff-file-current", file.name);
      link.href = file.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else addText(row, "span", "staff-file-current", file.name);
    const remove = addText(row, "button", "staff-secondary staff-attachment-remove", "Supprimer");
    remove.type = "button";
    remove.setAttribute("aria-label", `Supprimer la pièce jointe ${file.name}`);
    remove.addEventListener("click", () => removePublicationFile(file, remove));
    list.append(row);
  }
  for (const file of pendingFiles) {
    const state = completedUploadFiles.has(file) ? "Envoyé" : "À ajouter";
    addText(list, "p", "staff-file-current staff-file-pending", `${safeUploadName(file.name)} · ${(file.size / (1024 * 1024)).toFixed(1)} Mo · ${state}`);
  }
}

async function removePublicationFile(file, button) {
  if (!window.confirm(`Supprimer définitivement la pièce jointe « ${file.name} » ?`)) return;
  button.disabled = true;
  try {
    await request(`/api/staff/publication-files/${encodeURIComponent(file.id)}`, { method: "DELETE" });
    editingFiles = editingFiles.filter((entry) => entry.id !== file.id);
    renderAttachmentList(document.querySelector("[data-publication-files]").files);
    feedback("[data-publication-feedback]", "Pièce jointe supprimée.");
    await loadPublicationsForStaff();
  } catch (error) {
    button.disabled = false;
    feedback("[data-publication-feedback]", error.message, true);
  }
}

document.querySelector("[data-teacher-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await request("/api/staff/teachers", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset();
    feedback("[data-teacher-feedback]", `Compte créé pour ${result.teacher?.full_name || "le professeur"}. Transmettez l'accès temporaire par un canal sécurisé.`);
    await loadTeachers();
  } catch (error) { feedback("[data-teacher-feedback]", error.message, true); }
});

document.querySelector("[data-result-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await request("/api/staff/results", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset();
    feedback("[data-result-feedback]", "Résultat enregistré dans l'espace privé administrateur.");
    await loadPrivateResults();
  } catch (error) { feedback("[data-result-feedback]", error.message, true); }
});

loadSession();
