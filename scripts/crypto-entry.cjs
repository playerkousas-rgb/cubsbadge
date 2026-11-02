// Entry for the vendored @noble/hashes PBKDF2/SHA-256 bundle embedded in Code.gs.
const { pbkdf2 } = require('@noble/hashes/pbkdf2');
const { sha256 } = require('@noble/hashes/sha256');
exports.derive = (password, salt, iterations) => pbkdf2(
  sha256, Uint8Array.from(password, x => x & 255), Uint8Array.from(salt, x => x & 255),
  { c: iterations, dkLen: 32 }
);
