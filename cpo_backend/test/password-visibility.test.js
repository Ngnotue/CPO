import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../../cpo_frontend/password-visibility.js", import.meta.url), "utf8");

function setup() {
  const listeners = {};
  const button = { hidden: true, textContent: "", addEventListener: (event, handler) => { listeners[`button:${event}`] = handler; } };
  const form = { querySelector: () => button, addEventListener: (event, handler) => { listeners[`form:${event}`] = handler; } };
  const inputs = {
    "staff-new-password": { type: "password", value: "test-value-one" },
    "staff-confirm-password": { type: "password", value: "test-value-two" }
  };
  const document = { querySelector: () => form, getElementById: (id) => inputs[id] };
  const window = { addEventListener: (event, handler) => { listeners[`window:${event}`] = handler; } };
  runInNewContext(source, { document, window });
  return { listeners, button, inputs: Object.values(inputs) };
}

test("password visibility toggles both fields without changing their values", () => {
  const { listeners, button, inputs } = setup();
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, "Afficher les mots de passe");
  listeners["button:click"]();
  assert.deepEqual(inputs.map((input) => input.type), ["text", "text"]);
  assert.equal(button.textContent, "Masquer les mots de passe");
  assert.deepEqual(inputs.map((input) => input.value), ["test-value-one", "test-value-two"]);
  listeners["button:click"]();
  assert.deepEqual(inputs.map((input) => input.type), ["password", "password"]);
});

test("password fields are masked on reset and when leaving the page", () => {
  const { listeners, button, inputs } = setup();
  for (const event of ["form:reset", "window:pagehide"]) {
    listeners["button:click"]();
    listeners[event]();
    assert.deepEqual(inputs.map((input) => input.type), ["password", "password"]);
    assert.equal(button.textContent, "Afficher les mots de passe");
  }
});
