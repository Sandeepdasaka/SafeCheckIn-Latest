// utils/mask.js
// Shared masking for identity-document numbers (Aadhaar, passport, etc.)
// shown to any audience that isn't police - UIDAI's own display convention
// is "show only the last 4 digits", which is what this mirrors.

const maskIdNumber = (idNumber, idType) => {
  if (!idNumber) return idNumber;
  const str = String(idNumber).trim();
  if (str.length <= 4) return "*".repeat(str.length);

  const last4 = str.slice(-4);

  if (idType === "Aadhar Card" && /^\d{12}$/.test(str)) {
    return `XXXX-XXXX-${last4}`;
  }

  return "*".repeat(str.length - 4) + last4;
};

module.exports = { maskIdNumber };
