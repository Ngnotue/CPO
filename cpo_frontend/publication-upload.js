const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png"
]);
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function safeUploadName(value) {
  return String(value || "fichier").split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, "").trim();
}

export async function uploadPublicationFiles(publicationId, files, {
  request,
  fetchImpl = globalThis.fetch,
  completedFiles = new WeakSet(),
  onFileComplete = () => {}
} = {}) {
  if (typeof request !== "function") throw new TypeError("Une fonction request est requise.");

  // Validate the entire pending batch before uploading any file.
  const pendingFiles = Array.from(files).filter((file) => !completedFiles.has(file));
  for (const file of pendingFiles) {
    if (!file || !ALLOWED_FILE_TYPES.has(file.type) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`Format ou taille non autorisé : ${safeUploadName(file?.name)}`);
    }
  }

  for (const file of pendingFiles) {
    const metadata = { publication_id: publicationId, original_name: safeUploadName(file.name), content_type: file.type, size_bytes: file.size };
    const signed = await request("/api/staff/uploads/sign", { method: "POST", body: JSON.stringify(metadata) });
    const uploaded = await fetchImpl(signed.upload_url, { method: "PUT", headers: { "Content-Type": file.type, "x-upsert": "false" }, body: file });
    if (!uploaded.ok) throw new Error(`L'envoi de ${metadata.original_name} a échoué.`);
    await request("/api/staff/uploads/finalize", { method: "POST", body: JSON.stringify({ ...metadata, object_path: signed.object_path }) });
    completedFiles.add(file);
    onFileComplete(file);
  }

  return completedFiles;
}
