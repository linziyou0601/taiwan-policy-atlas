#!/usr/bin/env python3
"""
Quick validation script for skills and evals.json format.

Usage:
    python -m scripts.quick_validate <skill_directory>
    python -m scripts.quick_validate --evals <evals.json_path>
    python -m scripts.quick_validate --structure <skill_directory>

--structure runs three checks against the design-time authorities:
  1. required chapters per skill type, in order (type signals: SKILL.md 類型與骨架;
     skeletons: references/*-skill-skeleton.md). Optional chapters may sit between them.
  2. reference filenames against the 檔名慣例 table in references/section-dictionary.md
  3. style blocklist (migration narration, code-switching verb phrases, and the
     buzzwords catalogued in rule-writing references/writing/prose-buzzword.md)
"""

import json
import re
import sys
from pathlib import Path

import yaml

# --- structure check data (machine copy; md files above are the authority) ---

REQUIRED_CHAPTERS = {
    "harness": ["用途", "輸入", "執行步驟", "停止條件", "委派", "產出", "完整性檢查", "參考型錄"],
    "command": ["用途", "輸入", "執行指引", "輸出格式", "完整性檢查"],
    "rule": ["目的", "適用範圍", "審查掛鉤"],
}
# Rule 的最後一章是邊界類章節（rule-skill-skeleton 章節約定）
RULE_CLOSING_CHAPTERS = {"邊界", "作業邊界", "紀律"}

REFERENCE_NAME_PATTERNS = [
    r".+-catalog\.md$",
    r".+-policy\.md$",
    r".+-protocol\.md$",
    r".+-contract\.md$",
    r".+-template\.md$",
    r"^source-to-submode\.md$",
    r"^anti-patterns\.md$",
    r"^article-templates\.md$",
    r"^page-types\.md$",
    # studio design-time authorities
    r"^section-dictionary\.md$",
    r".+-skill-skeleton\.md$",
    r"^schemas\.md$",
    r"^output-templates\.md$",
    r"^trigger-tuning-guide\.md$",
]
REFERENCE_DIR_WHITELIST = {"component-templates", "collectors"}

STYLE_BLOCKLIST = [
    (r"不再需要|已移除|已改為|已更名|原本的|改版後|新版的|舊版的|遷移自|取代了原", "遷移殘影：改寫為現況陳述"),
    (r"[去來][ ]?(ensure|align|check|review|handle|verify|clean)", "晶晶體動詞片語：改用中文動詞"),
    (r"做[ ]?(alignment|mapping|review|check)\b", "晶晶體動詞片語：改用中文動詞"),
    (r"收斂|賦能|打通(?!器)|抓手|閉環|落地(?!頁)", "空話詞（rule-writing prose-buzzword）：改寫為具體描述"),
]


def _chapters_of(md_text: str) -> list[str]:
    """H2 titles outside fenced code blocks."""
    chapters, in_fence = [], False
    for line in md_text.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if not in_fence and line.startswith("## "):
            chapters.append(line[3:].strip())
    return chapters


def _skill_type(skill_path: Path, frontmatter: dict, chapters: list[str]) -> str:
    """類型依 SKILL.md「類型與骨架」的判定訊號：名稱前綴與章節骨架，與觸發類別無關。"""
    name = str(frontmatter.get("name", skill_path.name))
    if name.startswith("rule-"):
        return "rule"
    if "執行步驟" in chapters:
        return "harness"
    if all(c in chapters for c in REQUIRED_CHAPTERS["command"]):
        return "command"
    return "other"


def validate_structure(skill_path: Path, declared_type: str | None = None) -> tuple[bool, list[str]]:
    errors = []
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return False, ["SKILL.md not found"]
    content = skill_md.read_text()
    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    frontmatter = yaml.safe_load(match.group(1)) if match else {}
    chapters = _chapters_of(content)
    skill_type = declared_type or _skill_type(skill_path, frontmatter or {}, chapters)

    # 1. chapter skeleton：必要章節依序出現，選用章節可穿插
    required = REQUIRED_CHAPTERS.get(skill_type, [])
    missing = [c for c in required if c not in chapters]
    if missing:
        errors.append(f"{skill_type} 必要章節缺漏：{missing}")
    else:
        positions = [chapters.index(c) for c in required]
        if positions != sorted(positions):
            errors.append(f"{skill_type} 必要章節順序錯誤：{chapters}")
    if skill_type == "rule" and (not chapters or chapters[-1] not in RULE_CLOSING_CHAPTERS):
        errors.append(f"rule 最後一章應為邊界、作業邊界或紀律：{chapters[-1:]}")

    # 2. reference filenames
    refs_dir = skill_path / "references"
    if refs_dir.exists():
        for f in sorted(refs_dir.rglob("*.md")):
            rel = f.relative_to(refs_dir)
            top = rel.parts[0]
            if len(rel.parts) > 1:
                catalog_dir_ok = (refs_dir / f"{top}-catalog.md").exists() or top in REFERENCE_DIR_WHITELIST
                if not catalog_dir_ok:
                    errors.append(f"references 子目錄 {top}/ 缺同名 {top}-catalog.md 索引（{rel}）")
                continue
            if not any(re.match(p, f.name) for p in REFERENCE_NAME_PATTERNS):
                errors.append(f"references 檔名不在檔名慣例表：{rel}")

    # 3. style blocklist (prose lines only; fenced code blocks, 「」 and code spans may quote scan targets,
    #    scripts/ holds code and test fixtures)
    style_patterns = STYLE_BLOCKLIST
    for f in sorted(skill_path.rglob("*.md")):
        if f.relative_to(skill_path).parts[0] == "scripts":
            continue
        in_fence = False
        for lineno, line in enumerate(f.read_text().splitlines(), 1):
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            prose = re.sub(r"`+[^`]*`+|「[^」]*」", "", line)
            for pattern, hint in style_patterns:
                if re.search(pattern, prose):
                    errors.append(f"{f.relative_to(skill_path)}:{lineno} 命中「{pattern}」（{hint}）")

    return len(errors) == 0, errors


def validate_skill(skill_path: Path) -> tuple[bool, str]:
    """Validate a skill directory has correct structure and frontmatter."""
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return False, "SKILL.md not found"

    content = skill_md.read_text()
    if not content.startswith("---"):
        return False, "No YAML frontmatter found"

    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return False, "Invalid frontmatter format"

    try:
        frontmatter = yaml.safe_load(match.group(1))
        if not isinstance(frontmatter, dict):
            return False, "Frontmatter must be a YAML dictionary"
    except yaml.YAMLError as e:
        return False, f"Invalid YAML in frontmatter: {e}"

    if "name" not in frontmatter:
        return False, "Missing 'name' in frontmatter"
    if "description" not in frontmatter:
        return False, "Missing 'description' in frontmatter"

    name = str(frontmatter.get("name", "")).strip()
    if name and not re.match(r"^[a-z0-9-]+$", name):
        return False, f"Name '{name}' should be kebab-case (lowercase letters, digits, and hyphens)"
    if name and (name.startswith("-") or name.endswith("-") or "--" in name):
        return False, f"Name '{name}' cannot start/end with hyphen or contain consecutive hyphens"
    if name and len(name) > 64:
        return False, f"Name is too long ({len(name)} characters). Maximum is 64."

    description = str(frontmatter.get("description", "")).strip()
    if description and len(description) > 1024:
        return False, f"Description is too long ({len(description)} characters). Maximum is 1024."

    return True, "Skill is valid"


def validate_evals(evals_path: Path) -> tuple[bool, list[str]]:
    """Validate an evals.json file has correct structure."""
    errors = []

    try:
        data = json.loads(evals_path.read_text())
    except json.JSONDecodeError as e:
        return False, [f"Invalid JSON: {e}"]

    if not isinstance(data, dict):
        return False, ["Root must be a JSON object"]

    if "skill_name" not in data:
        errors.append("Missing 'skill_name' field")

    if "evals" not in data:
        errors.append("Missing 'evals' array")
        return len(errors) == 0, errors

    if not isinstance(data["evals"], list):
        errors.append("'evals' must be an array")
        return False, errors

    ids_seen = set()
    for i, eval_item in enumerate(data["evals"]):
        prefix = f"evals[{i}]"

        if "id" not in eval_item:
            errors.append(f"{prefix}: missing 'id'")
        else:
            eid = eval_item["id"]
            if eid in ids_seen:
                errors.append(f"{prefix}: duplicate id {eid}")
            ids_seen.add(eid)

        if "prompt" not in eval_item:
            errors.append(f"{prefix}: missing 'prompt'")

        if "expectations" not in eval_item:
            errors.append(f"{prefix}: missing 'expectations'")
        elif not isinstance(eval_item["expectations"], list):
            errors.append(f"{prefix}: 'expectations' must be an array")
        elif len(eval_item["expectations"]) == 0:
            errors.append(f"{prefix}: 'expectations' is empty")

        # Warn if using wrong field name
        if "assertions" in eval_item:
            errors.append(f"{prefix}: uses 'assertions' instead of 'expectations' (wrong field name)")

    return len(errors) == 0, errors


def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python -m scripts.quick_validate <skill_directory>")
        print("  python -m scripts.quick_validate --evals <evals.json_path>")
        sys.exit(1)

    if sys.argv[1] == "--evals":
        if len(sys.argv) < 3:
            print("Usage: python -m scripts.quick_validate --evals <evals.json_path>")
            sys.exit(1)
        evals_path = Path(sys.argv[2])
        valid, errors = validate_evals(evals_path)
        if valid:
            print(f"evals.json is valid ({evals_path})")
        else:
            print(f"evals.json validation failed ({evals_path}):")
            for err in errors:
                print(f"  - {err}")
        sys.exit(0 if valid else 1)
    elif sys.argv[1] == "--structure":
        if len(sys.argv) < 3:
            print("Usage: python -m scripts.quick_validate --structure <skill_directory> [--type harness|command|rule|other]")
            sys.exit(1)
        skill_path = Path(sys.argv[2])
        declared_type = None
        if len(sys.argv) >= 5 and sys.argv[3] == "--type":
            declared_type = sys.argv[4]
        valid, errors = validate_structure(skill_path, declared_type)
        if valid:
            print(f"structure ok ({skill_path.name})")
        else:
            print(f"structure check failed ({skill_path.name}):")
            for err in errors:
                print(f"  - {err}")
        sys.exit(0 if valid else 1)
    else:
        skill_path = Path(sys.argv[1])
        valid, message = validate_skill(skill_path)
        print(message)
        sys.exit(0 if valid else 1)


if __name__ == "__main__":
    main()
