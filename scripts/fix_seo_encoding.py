"""Fix double-encoded UTF-8 mojibake in SYNAPSE HTML files."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

# Sequences produced when UTF-8 punctuation was mis-decoded as Windows-1252
# then re-saved as UTF-8 (e.g. em dash — becomes â€").
REPLACEMENTS = [
    ("\u00e2\u20ac\u201d", " - "),  # â€"  (em dash variant)
    ("\u00e2\u20ac\u201c", " - "),  # â€"  (em dash / left-dq variant)
    ("\u00e2\u20ac\u2013", " - "),  # â€"  (en dash)
    ("\u00e2\u20ac\u2122", "'"),    # â€™  (right single quote)
    ("\u00e2\u20ac\u02dc", "'"),    # â€˜  (left single quote)
    ("\u00e2\u20ac\u00a6", "..."),  # â€¦  (ellipsis)
    ("\u00c2\u00b7", " · "),        # Â·   (middle dot)
    ("\u00c2\u00a0", " "),          # Â    (nbsp)
    ("\u00e2\u2020\u2019", "\u2192"),  # right arrow mojibake -> →
    ("\u00e2\u2020\u0090", "\u2190"),  # left arrow mojibake -> ←
    ("\u00c3\u00a6", "\u00e6"),        # æ mojibake
]


def fix_text(text: str) -> str:
    for bad, good in REPLACEMENTS:
        text = text.replace(bad, good)
    # tidy spacing around middle dots after replacement
    text = text.replace("  ·  ", " · ")
    text = text.replace(" ·  ", " · ")
    text = text.replace("  · ", " · ")
    text = re.sub(r" -  - ", " - ", text)
    return text


def main() -> None:
    files = [ROOT / "index.html"]
    files += list((ROOT / "public").rglob("*.html"))
    changed = 0
    for path in files:
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        original = raw.decode("utf-8")
        fixed = fix_text(original)
        if fixed != original:
            path.write_bytes(fixed.encode("utf-8"))
            print(f"fixed  {path.relative_to(ROOT)}")
            changed += 1
        else:
            print(f"ok     {path.relative_to(ROOT)}")
    print(f"DONE — {changed} file(s) changed")


if __name__ == "__main__":
    main()