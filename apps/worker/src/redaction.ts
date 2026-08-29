interface RedactEvidenceInput {
  readonly source: string;
  readonly maximumCharacters: number;
}

export const REDACTION_RULESET_VERSION = "sisyphus-local-v1";

export interface RedactedEvidence {
  readonly text: string;
  readonly redactions: number;
  readonly clipped: boolean;
}

const secretPatterns: readonly {
  readonly pattern: RegExp;
  readonly replacement: string;
}[] = [
  {
    pattern:
      /\b((?:OPENAI|ANTHROPIC|GOOGLE|AZURE|AWS|GITHUB|GITLAB)[A-Z0-9_]*_(?:API_)?KEY\s*=\s*)[^\s"']+/giu,
    replacement: "$1[redacted]",
  },
  {
    pattern: /\b(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+/giu,
    replacement: "$1[redacted]",
  },
  {
    pattern: /\b(sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,})\b/gu,
    replacement: "[redacted]",
  },
  {
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu,
    replacement: "[redacted]",
  },
  {
    pattern: /\bAKIA[A-Z0-9]{16}\b/gu,
    replacement: "[redacted]",
  },
  {
    pattern:
      /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/gu,
    replacement: "$1\n[redacted]\n$2",
  },
  {
    pattern:
      /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL)\s*=\s*)(?!\[redacted\])[^\s"']+/gu,
    replacement: "$1[redacted]",
  },
  {
    pattern:
      /(\\?"[A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password|credential)\\?"\s*:\s*\\?")[^"\\]*(\\?")/giu,
    replacement: "$1[redacted]$2",
  },
];

const unsafeCredentialPatterns: readonly RegExp[] = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /Authorization\s*:\s*Bearer\s+(?!\[redacted\])\S+/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*(?!\[redacted\])/u,
  /\\?"[A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password|credential)\\?"\s*:\s*\\?"(?!\[redacted\])[^"\\]+/iu,
];

export class RedactionFailureError extends Error {
  public constructor() {
    super("Evidence still contains a credential-shaped value after redaction.");
    this.name = "RedactionFailureError";
  }
}

export function redactEvidence(input: RedactEvidenceInput): RedactedEvidence {
  if (!Number.isSafeInteger(input.maximumCharacters) || input.maximumCharacters <= 0) {
    throw new Error("maximumCharacters must be a positive integer.");
  }

  let text = input.source;
  let redactions = 0;
  for (const rule of secretPatterns) {
    redactions += Array.from(text.matchAll(rule.pattern)).length;
    text = text.replace(rule.pattern, rule.replacement);
  }

  if (unsafeCredentialPatterns.some((pattern) => pattern.test(text))) {
    throw new RedactionFailureError();
  }

  const characters = Array.from(text);
  if (characters.length <= input.maximumCharacters) {
    return { text, redactions, clipped: false };
  }

  const suffix = " …";
  const suffixLength = Array.from(suffix).length;
  const prefix = characters
    .slice(0, Math.max(0, input.maximumCharacters - suffixLength))
    .join("")
    .trimEnd();
  return {
    text:
      prefix.length === 0
        ? Array.from("…").slice(0, input.maximumCharacters).join("")
        : `${prefix}${suffix}`,
    redactions,
    clipped: true,
  };
}
