"""Builds preview/index.html, a clickable mock of the Cassin AI Hub, from content/*.json.

The preview reads the same content files the deploy script loads, so it always shows
what the site will contain. It is a design preview only: nothing in it talks to
SharePoint, and the forms don't save anything.

    python3 preview/build_preview.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
SITE_URL = "https://cassinllp.sharepoint.com/sites/AIHub"


def load(name):
    return json.loads((CONTENT / name).read_text(encoding="utf-8"))


def main():
    data = {
        "prompts": load("prompts.json"),
        "tips": load("friday-tips.json"),
        "videos": load("videos.json"),
        "agents": load("agents.json"),
        "faq": load("faq.json"),
        "news": load("news.json"),
        "pages": load("pages.json"),
        "siteUrl": SITE_URL,
    }
    blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    logo = (ROOT / "assets" / "cassin-logo-white.svg").read_text(encoding="utf-8")
    template = (Path(__file__).parent / "template.html").read_text(encoding="utf-8")
    out = template.replace("/*__DATA__*/null", blob).replace("<!--__LOGO__-->", logo)
    (Path(__file__).parent / "index.html").write_text(out, encoding="utf-8")
    print(f"wrote preview/index.html ({len(out):,} bytes)")


if __name__ == "__main__":
    main()
