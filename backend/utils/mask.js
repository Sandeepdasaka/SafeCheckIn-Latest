// utils/mask.js
// Shared masking for identity-document numbers (Aadhaar, passport, etc.)
// shown to any audience that isn't police - UIDAI's own display convention
// is "show only the last 4 digits", which is what this mirrors.

const maskIdNumber = (idNumber, idType) => {
  if (!idNumber) return idNumber;
  const str = String(idNumber).trim();
  if (str.length <= 4) return "*".repeat(str.length);

  const last4 = str.slice(-4);

  // idType isn't always available to the caller (e.g. Suspect.suspectData
  // stores a bare ID number with no type alongside it) - a 12-digit
  // all-numeric ID is, in practice, always an Aadhaar number in this app,
  // so treat that shape as Aadhaar-style even without the type. Both
  // branches are equally safe; this only affects display format.
  if ((idType === "Aadhar Card" || !idType) && /^\d{12}$/.test(str)) {
    return `XXXX-XXXX-${last4}`;
  }

  return "*".repeat(str.length - 4) + last4;
};

module.exports = { maskIdNumber };
