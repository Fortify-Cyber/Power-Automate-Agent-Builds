#!/usr/bin/env python3
"""Package filing-skill/ as a Microsoft 365 Copilot plugin (skills only) and check it.

    python3 build/build_skill_plugin.py   # -> out/fortify-email-filing-plugin_<version>.zip

Layout (Microsoft "Build plugins for Copilot Cowork"): manifest.json (v1.28), color.png 192x192,
outline.png 32x32 and skills/<name>/SKILL.md, all at the zip root. Admins upload it in the
Microsoft 365 admin center; it then works in Copilot Chat and Copilot Cowork.
"""
import json, pathlib, re, sys, zipfile, io
import yaml
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "filing-skill"
manifest = json.loads((SRC / "plugin" / "manifest.json").read_text(encoding="utf-8"))

def fail(msg):
    sys.exit(f"plugin check failed: {msg}")

# Icons from the Filing Assistant icon.
base = Image.open(ROOT / "filing-agent" / "icon.png").convert("RGBA")
color = base.resize((192, 192), Image.LANCZOS)
alpha = base.resize((32, 32), Image.LANCZOS).split()[-1]
outline = Image.new("RGBA", (32, 32), (255, 255, 255, 0))
outline.putalpha(alpha.point(lambda a: 255 if a > 128 else 0))

files = {}
for entry in manifest.get("agentSkills", []):
    folder = entry["folder"].removeprefix("./")
    name = folder.split("/")[-1]
    skill = SRC / name / "SKILL.md"
    if not skill.exists():
        fail(f"{folder}: no SKILL.md (ASKILL-P002)")
    text = skill.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        fail(f"{folder}: front matter missing (ASKILL-P003)")
    fm = yaml.safe_load(m.group(1))
    if fm.get("name") != name:
        fail(f"{folder}: name {fm.get('name')!r} must match folder (ASKILL-P006)")
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", name) or len(name) > 64:
        fail(f"{folder}: name must be kebab-case, 1-64 chars (ASKILL-P007)")
    if not 1 <= len(fm.get("description", "")) <= 1024:
        fail(f"{folder}: description must be 1-1024 chars (ASKILL-P005)")
    files[f"{folder}/SKILL.md"] = text.encode("utf-8")
if len(manifest["agentSkills"]) > 20:
    fail("more than 20 skills (ASKILL-M002)")
if len({e["folder"] for e in manifest["agentSkills"]}) != len(manifest["agentSkills"]):
    fail("duplicate skill folders (ASKILL-P008)")

def png(img):
    b = io.BytesIO(); img.save(b, "PNG"); return b.getvalue()
files["manifest.json"] = json.dumps(manifest, indent=2).encode("utf-8")
files["color.png"] = png(color)
files["outline.png"] = png(outline)

out = ROOT / "out" / f"fortify-email-filing-plugin_{manifest['version'].replace('.', '_')}.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for path in sorted(files):
        z.writestr(path, files[path])
print(f"Built {out.relative_to(ROOT)}: {len(manifest['agentSkills'])} skill(s): "
      + ", ".join(e['folder'] for e in manifest['agentSkills']))
