(() => {
  const form = document.querySelector("[data-password-form]");
  const button = form?.querySelector("[data-password-visibility]");
  const inputs = [
    document.getElementById("staff-new-password"),
    document.getElementById("staff-confirm-password")
  ];
  if (!form || !button || inputs.some((input) => !input)) return;

  function setVisible(visible) {
    inputs.forEach((input) => { input.type = visible ? "text" : "password"; });
    button.textContent = visible ? "Masquer les mots de passe" : "Afficher les mots de passe";
  }

  button.addEventListener("click", () => setVisible(inputs[0].type === "password"));
  form.addEventListener("reset", () => setVisible(false));
  window.addEventListener("pagehide", () => setVisible(false));
  setVisible(false);
  button.hidden = false;
})();
