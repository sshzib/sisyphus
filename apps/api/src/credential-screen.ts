import { z } from "zod";

const UnknownObjectSchema = z.record(z.string(), z.unknown());
const credentialPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /\bBearer\s+[A-Za-z0-9._~-]{20,}\b/iu,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:/]+:[^\s@]+@/iu,
  /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*(?!\[REDACTED\])\S{8,}/iu,
];

function stringLooksLikeCredential(value: string): boolean {
  return credentialPatterns.some((pattern) => pattern.test(value));
}

export function containsCredentialShapedString(input: unknown): boolean {
  if (typeof input === "string") {
    return stringLooksLikeCredential(input);
  }
  if (Array.isArray(input)) {
    return input.some((entry) => containsCredentialShapedString(entry));
  }
  if (input === null || typeof input !== "object") {
    return false;
  }
  const object = UnknownObjectSchema.safeParse(input);
  if (!object.success) {
    return false;
  }
  return Object.values(object.data).some((entry) =>
    containsCredentialShapedString(entry),
  );
}
