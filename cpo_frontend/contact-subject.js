const CONTACT_SUBJECTS = Object.freeze({
  general: "Question générale",
  application: "Demande d'admission",
  "follow-up": "Suivi de dossier"
});

export function formatContactSubject(value) {
  return Object.hasOwn(CONTACT_SUBJECTS, value) ? CONTACT_SUBJECTS[value] : CONTACT_SUBJECTS.general;
}
