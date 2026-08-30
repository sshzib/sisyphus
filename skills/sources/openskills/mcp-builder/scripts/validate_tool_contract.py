#!/usr/bin/env python3
"""Validate a lightweight JSON inventory before implementing MCP tools."""

import json
import re
import sys
from pathlib import Path

NAME = re.compile(r"^[a-z][a-z0-9_]{2,63}$")


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: validate_tool_contract.py <tools.json>", file=sys.stderr)
        return 2
    tools = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if not isinstance(tools, list):
        raise ValueError("tools.json must contain an array")
    names, errors = set(), []
    for index, tool in enumerate(tools, 1):
        prefix = f"tool {index}"
        if not isinstance(tool, dict):
            errors.append(f"{prefix}: must be an object")
            continue
        name, description = tool.get("name"), tool.get("description")
        if not isinstance(name, str) or not NAME.fullmatch(name):
            errors.append(f"{prefix}: name must be lowercase snake_case (3-64 characters)")
        elif name in names:
            errors.append(f"{prefix}: duplicate name '{name}'")
        else:
            names.add(name)
        if not isinstance(description, str) or len(description.strip()) < 20:
            errors.append(f"{prefix}: description must explain the tool in at least 20 characters")
        if not isinstance(tool.get("inputSchema"), dict):
            errors.append(f"{prefix}: inputSchema must be an object")
        if not isinstance(tool.get("readOnly"), bool):
            errors.append(f"{prefix}: readOnly must be true or false")
        elif not tool["readOnly"] and tool.get("confirmation") is not True:
            errors.append(f"{prefix}: mutating tools require confirmation: true")
    if errors:
        print("Tool contract is invalid:", file=sys.stderr)
        print("\n".join(f"- {error}" for error in errors), file=sys.stderr)
        return 1
    print(f"Valid tool contract: {len(tools)} tool(s)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(2)
