import re
import subprocess
import sys
from pathlib import Path

# Config
BLOCK_SIZE = 10  # consecutive lines to consider as duplication (standard SonarCloud limit)
MAX_DUPLICATION_PERCENT = 3.0

EXCLUDE_DIRS = [
    "migrations",
    "tests",
    "node_modules",
    ".venv",
    ".git",
    "dist",
    "build",
    "staticfiles",
    "media",
]

EXCLUDE_FILE_PATTERNS = [
    r"\.test\.(ts|tsx)$",
    r"\.spec\.(ts|tsx)$",
    r"tests\.py$",
    r"__init__\.py$",
]


def should_exclude(path: Path) -> bool:
    for part in path.parts:
        if part in EXCLUDE_DIRS:
            return True

    filename = path.name
    for pattern in EXCLUDE_FILE_PATTERNS:
        if re.search(pattern, filename):
            return True

    return False


def clean_line(line: str) -> str:
    line = line.strip()
    if line.startswith("#") or line.startswith("//"):
        return ""
    return line


def load_file_lines_with_meta(path: Path) -> list[tuple[int, str]]:
    """Returns list of (original_1_indexed_line_number, cleaned_content)"""
    try:
        with open(path, encoding="utf-8") as f:
            lines = []
            for i, line in enumerate(f, 1):
                cleaned = clean_line(line)
                if cleaned:
                    lines.append((i, cleaned))
            return lines
    except Exception:
        return []


def get_git_modified_lines(root_dir: Path) -> dict[Path, set[int]]:
    # Maps file path to set of 1-indexed line numbers that are modified/added
    modified_lines = {}
    try:
        res = subprocess.run(
            ["git", "diff", "-U0"], cwd=root_dir, capture_output=True, text=True, check=True
        )
        current_file = None
        for line in res.stdout.splitlines():
            if line.startswith("+++ b/"):
                rel_path = line[6:]
                current_file = (root_dir / rel_path).resolve()
                modified_lines.setdefault(current_file, set())
            elif line.startswith("@@ ") and current_file:
                match = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", line)
                if match:
                    start = int(match.group(1))
                    count = int(match.group(2)) if match.group(2) else 1
                    for line_no in range(start, start + count):
                        modified_lines[current_file].add(line_no)
    except Exception as e:
        print(f"Warning parsing git diff: {e}")
    return modified_lines


def get_git_untracked_files(root_dir: Path) -> set[Path]:
    untracked = set()
    try:
        res = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=root_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        for line in res.stdout.splitlines():
            if line.startswith("??") or line.startswith("A "):
                rel_path = line[3:].strip()
                path = (root_dir / rel_path).resolve()
                if path.is_dir():
                    for sub in path.rglob("*"):
                        if sub.is_file():
                            untracked.add(sub.resolve())
                else:
                    untracked.add(path)
    except Exception as e:
        print(f"Warning parsing git status: {e}")
    return untracked


def main():
    root_dir = Path(__file__).resolve().parent.parent.parent

    analyze_all = "--all" in sys.argv

    # Collect git changes
    modified_lines = {}
    untracked_files = set()
    if not analyze_all:
        modified_lines = get_git_modified_lines(root_dir)
        untracked_files = get_git_untracked_files(root_dir)
        print(f"Git: {len(modified_lines)} modified files, {len(untracked_files)} untracked files.")

    # Index all source files in repository
    all_files = []

    # Backend files
    backend_dir = root_dir / "backend" / "apps"
    if backend_dir.exists():
        for p in backend_dir.rglob("*.py"):
            if not should_exclude(p):
                all_files.append(p.resolve())

    # Frontend files
    frontend_dir = root_dir / "frontend" / "src"
    if frontend_dir.exists():
        for ext in ["*.ts", "*.tsx"]:
            for p in frontend_dir.rglob(ext):
                if not should_exclude(p):
                    all_files.append(p.resolve())

    print(f"Indexing all {len(all_files)} files in repository...")

    # Load all cleaned lines and track metadata
    all_lines = []
    # List of (file_path, original_line_no, line_content)
    line_meta = []

    for p in all_files:
        lines_with_meta = load_file_lines_with_meta(p)
        for original_line_no, line_content in lines_with_meta:
            line_meta.append((p, original_line_no, line_content))
            all_lines.append(line_content)

    total_lines = len(all_lines)
    if total_lines == 0:
        print("No source lines found to analyze.")
        sys.exit(0)

    # Index blocks
    block_map = {}
    for i in range(total_lines - BLOCK_SIZE + 1):
        block = tuple(all_lines[i : i + BLOCK_SIZE])
        block_map.setdefault(block, []).append(i)

    # Find duplicate line indices
    duplicated_indices = set()
    for _block, start_indices in block_map.items():
        if len(start_indices) > 1:
            for start_idx in start_indices:
                for offset in range(BLOCK_SIZE):
                    duplicated_indices.add(start_idx + offset)

    # Calculate duplication percentage on target lines
    target_total_lines = 0
    target_dup_lines = 0

    for idx, (p, original_line_no, _line_content) in enumerate(line_meta):
        is_target = analyze_all
        if not analyze_all:
            if p in untracked_files:
                is_target = True
            elif p in modified_lines and original_line_no in modified_lines[p]:
                is_target = True

        if is_target:
            target_total_lines += 1
            if idx in duplicated_indices:
                target_dup_lines += 1

    if target_total_lines == 0:
        print(
            "\nNo new or modified lines found in git to analyze "
            "(use --all to scan the whole repository)."
        )
        sys.exit(0)

    dup_percent = (target_dup_lines / target_total_lines) * 100

    print("\n--- Duplication Report ---")
    scope_str = "Whole Repository" if analyze_all else "New/Modified Code (PR changes)"
    print(f"Scope:            {scope_str}")
    print(f"Total lines:      {target_total_lines}")
    print(f"Duplicated lines: {target_dup_lines}")
    print(f"Duplication rate: {dup_percent:.2f}%")
    print(f"Limit:            {MAX_DUPLICATION_PERCENT}%")

    if target_dup_lines > 0:
        print("\nDuplicated blocks touching new/modified lines:")
        shown = 0
        for block, start_indices in block_map.items():
            if len(start_indices) > 1 and shown < 5:
                # Check if any index in start_indices corresponds to a target line
                has_target = False
                for start_idx in start_indices:
                    p, original_line_no, _ = line_meta[start_idx]
                    if analyze_all:
                        has_target = True
                        break
                    if p in untracked_files:
                        has_target = True
                        break
                    if p in modified_lines and original_line_no in modified_lines[p]:
                        has_target = True
                        break

                if has_target:
                    print(f"\nDuplicate block found in {len(start_indices)} locations:")
                    print("  Snippet:")
                    for line in block[:3]:
                        print(f"    {line}")
                    for idx in start_indices:
                        p, original_line_no, _ = line_meta[idx]
                        rel = p.relative_to(root_dir)
                        print(f"  - File: {rel}, Line: {original_line_no}")
                    shown += 1

    if dup_percent > MAX_DUPLICATION_PERCENT:
        print(
            f"\n[FAIL] Duplication rate of {dup_percent:.2f}% "
            f"exceeds the limit of {MAX_DUPLICATION_PERCENT}%!"
        )
        sys.exit(1)
    else:
        print("\n[SUCCESS] Code duplication is within acceptable limits.")
        sys.exit(0)


if __name__ == "__main__":
    main()
