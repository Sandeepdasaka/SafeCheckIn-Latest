// utils/otp.js
// Login 2FA one-time-passcode helpers. This is deliberately demo-grade
// delivery: no SMS/email provider is wired up (that needs real credentials
// this project doesn't have yet). Swap `deliverOtp` for a real provider
// (SMS gateway, SES, etc.) before using this outside a demo/pilot.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_OTP_ATTEMPTS = 5;

const generateOtp = () => {
  // crypto.randomInt is uniform and CSPRNG-backed, unlike Math.random().
  return crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
};

const hashOtp = (otp) => bcrypt.hash(otp, 10);

const verifyOtpHash = (otp, hash) => bcrypt.compare(otp, hash);

// Demo-mode delivery: logs the OTP server-side so whoever is running the
// demo can read it off the terminal, instead of needing a real SMS/email
// integration. This must never run in production - callers gate the actual
// OTP value out of any HTTP response themselves based on NODE_ENV.
const deliverOtp = async (police, otp) => {
  console.log(
    `\n🔐 [DEMO OTP] Login OTP for ${police.email} (${police.name}, badge #${police.badgeNumber}): ${otp}` +
      `\n   Valid for ${OTP_TTL_MS / 60000} minutes. In production this would be sent by SMS/email, not logged.\n`,
  );
};

module.exports = {
  OTP_LENGTH,
  OTP_TTL_MS,
  MAX_OTP_ATTEMPTS,
  generateOtp,
  hashOtp,
  verifyOtpHash,
  deliverOtp,
};
