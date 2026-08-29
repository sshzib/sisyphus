function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      }
      const members = Object.entries(value)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
      return `{${members.join(",")}}`;
    }
    case "bigint":
      return JSON.stringify(value.toString());
    case "undefined":
    case "symbol":
    case "function":
    default:
      return "null";
  }
}
