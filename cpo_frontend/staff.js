const loginPanel = document.querySelector("[data-login-panel]");
const workspace = document.querySelector("[data-staff-workspace]");
const dashboard = document.querySelector("[data-dashboard]");
const passwordPanel = document.querySelector("[data-password-panel]");
const adminPanels = document.querySelectorAll("[data-admin-panel]");
const staffNotice = document.querySelector("[data-staff-notice]");
let currentProfile = null;
let editingPublicationId = "";

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
  await Promise.all([loadTeachers(), loadPrivateResults()]);
}

async function loadPublicationsForStaff() {
  const list = document.querySelector("[data-publication-list]");
  list.replaceChildren();
  try {
    const { items = [] } = await request("/api/staff/publications");
    if (!items.length) {
      addText(list, "p", "staff-list-empty", "Aucun contenu pour l'instant.");
      return;
    }
    for (const item of items) {
      const row = document.createElement("article");
      row.className = "staff-list-row";
      const copy = document.createElement("div");
      addText(copy, "p", "staff-list-meta", `${item.kind} · ${item.locale.toUpperCase()} · ${item.status} · ${dateLabel(item.published_at || item.updated_at)}`);
      addText(copy, "h3", "", item.title);
      addText(copy, "p", "staff-list-summary", item.summary);
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
      if (item.status !== "archived") {
        const archive = addText(actions, "button", "staff-secondary", "Archiver");
        archive.type = "button";
        archive.addEventListener("click", () => archivePublication(item.id));
      }
      row.append(copy, actions);
      list.append(row);
    }
  } catch (error) {
    addText(list, "p", "staff-list-empty is-error", error.message);
  }
}

function editPublication(item) {
  const form = document.querySelector("[data-publication-form]");
  editingPublicationId = item.id;
  form.elements.id.value = item.id;
  for (const field of ["title", "kind", "locale", "category", "summary", "body", "status", "visibility"]) {
    if (form.elements[field]) form.elements[field].value = item[field] ?? (field === "locale" ? "fr" : "");
  }
  form.elements.is_important.checked = item.is_important === true;
  document.querySelector("[data-attachment-list]").replaceChildren();
  for (const file of item.files || []) {
    const row = document.createElement("p");
    row.className = "staff-file-current";
    if (file.url) {
      const link = addText(row, "a", "", file.name);
      link.href = file.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else addText(row, "span", "", file.name);
    document.querySelector("[data-attachment-list]").append(row);
  }
  document.querySelector("[data-editor-heading]").textContent = "Modifier une publication";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetEditor() {
  editingPublicationId = "";
  document.querySelector("[data-publication-form]").reset();
  document.querySelector("[data-publication-form]").elements.id.value = "";
  document.querySelector("[data-attachment-list]").replaceChildren();
  document.querySelector("[data-editor-heading]").textContent = "Nouvelle publication";
  feedback("[data-publication-feedback]", "");
}

async function archivePublication(id) {
  if (!window.confirm("Archiver ce contenu ? Il ne sera plus visible sur le site public.")) return;
  try {
    await request(`/api/staff/publications/${encodeURIComponent(id)}`, { method: "DELETE" });
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

function safeUploadName(value) {
  return String(value || "fichier").split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, "").trim();
}

async function uploadPublicationFiles(publicationId, files) {
  const allowed = new Set(["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "image/jpeg", "image/png"]);
  for (const file of files) {
    if (!allowed.has(file.type) || file.size < 1 || file.size > 100 * 1024 * 1024) {
      throw new Error(`Format ou taille non autorisé : ${safeUploadName(file.name)}`);
    }
    const metadata = { publication_id: publicationId, original_name: safeUploadName(file.name), content_type: file.type, size_bytes: file.size };
    const signed = await request("/api/staff/uploads/sign", { method: "POST", body: JSON.stringify(metadata) });
    const uploaded = await fetch(signed.upload_url, { method: "PUT", headers: { "Content-Type": file.type, "x-upsert": "false" }, body: file });
    if (!uploaded.ok) throw new Error(`L'envoi de ${metadata.original_name} a échoué.`);
    await request("/api/staff/uploads/finalize", { method: "POST", body: JSON.stringify({ ...metadata, object_path: signed.object_path }) });
  }
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
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const saved = await request(id ? `/api/staff/publications/${encodeURIComponent(id)}` : "/api/staff/publications", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    const publicationId = id || saved.item?.id;
    if (!publicationId) throw new Error("La publication a été enregistrée sans identifiant retourné.");
    if (files.length) {
      feedback("[data-publication-feedback]", `Envoi de ${files.length} fichier(s)…`);
      await uploadPublicationFiles(publicationId, files);
    }
    feedback("[data-publication-feedback]", id ? "Publication mise à jour." : "Publication enregistrée.");
    resetEditor();
    await loadPublicationsForStaff();
  } catch (error) { feedback("[data-publication-feedback]", error.message, true); }
  finally { submit.disabled = false; }
});

document.querySelector('[data-publication-form] [data-publication-files]').addEventListener("change", (event) => {
  const list = document.querySelector("[data-attachment-list]");
  list.replaceChildren();
  for (const file of event.currentTarget.files) addText(list, "p", "staff-file-current", `${safeUploadName(file.name)} · ${(file.size / (1024 * 1024)).toFixed(1)} Mo`);
});

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
