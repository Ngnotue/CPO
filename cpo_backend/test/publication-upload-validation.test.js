import test from "node:test";
import assert from "node:assert/strict";
import { uploadPublicationFiles } from "../../cpo_frontend/publication-upload.js";

const validFile = () => ({ name: "cours.pdf", type: "application/pdf", size: 1024 });

for (const invalid of [
  { name: "script.exe", type: "application/x-msdownload", size: 10 },
  { name: "vide.pdf", type: "application/pdf", size: 0 },
  { name: "trop-grand.pdf", type: "application/pdf", size: 100 * 1024 * 1024 + 1 },
  { name: "taille-invalide.pdf", type: "application/pdf", size: NaN }
]) {
  test(`invalid file ${invalid.name} prevents the entire pending batch from starting`, async () => {
    let requests = 0;
    await assert.rejects(uploadPublicationFiles("publication-1", [validFile(), invalid], {
      request: async () => { requests++; return {}; },
      fetchImpl: async () => { requests++; return { ok: true }; }
    }), /Format ou taille non autorisé/);
    assert.equal(requests, 0);
  });
}

test("prevalidation skips previously finalized files and permits the maximum file size", async () => {
  const completed = validFile();
  const pending = { name: "maximum.pdf", type: "application/pdf", size: 100 * 1024 * 1024 };
  const completedFiles = new WeakSet([completed]);
  const requests = [];
  await uploadPublicationFiles("publication-1", [completed, pending], {
    completedFiles,
    request: async (path, options) => {
      requests.push({ path, payload: JSON.parse(options.body) });
      return path.endsWith("/sign") ? { upload_url: "https://example.test/upload", object_path: "file-path" } : {};
    },
    fetchImpl: async (_url, options) => {
      assert.equal(options.body, pending);
      return { ok: true };
    }
  });
  assert.deepEqual(requests.map(({ path }) => path), ["/api/staff/uploads/sign", "/api/staff/uploads/finalize"]);
  assert.equal(requests[0].payload.original_name, "maximum.pdf");
  assert.equal(completedFiles.has(pending), true);
});
