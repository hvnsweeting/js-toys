"""Download the twenty default jigsaw pictures from Wikimedia Commons.

Each file is fetched as a Commons thumbnail, checked for a public-domain
licence tag, then decoded and re-encoded with Pillow so the published JPEG
holds only pixels (no metadata from the source file).

Run from the jigsaw directory:  python3 tools/fetch_pictures.py
"""

import io
import json
import os
import shutil
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

USER_AGENT = "js-toys-jigsaw/0.1 (https://github.com/hvnsweeting/js-toys)"
API = "https://commons.wikimedia.org/w/api.php"
FULL_LONG_SIDE = 1600
THUMB_LONG_SIDE = 360

PICTURES = [
    (
        "great-wave", "The Great Wave", "Katsushika Hokusai", "c. 1831",
        "File:Tsunami by hokusai 19th century.jpg",
    ),
    ("starry-night", "The Starry Night", "Vincent van Gogh", "1889",
     "File:Van Gogh - Starry Night - Google Art Project.jpg"),
    ("sunflowers", "Sunflowers", "Vincent van Gogh", "1888",
     "File:Vincent van Gogh - Sunflowers (1888, National Gallery London).jpg"),
    ("parasol", "Woman with a Parasol", "Claude Monet", "1875",
     "File:Claude Monet - Woman with a Parasol - Madame Monet and Her Son - Google Art Project.jpg"),
    ("irises", "Irises", "Vincent van Gogh", "1889",
     "File:Vincent van Gogh - Irises (1889).jpg"),
    ("hunters", "Hunters in the Snow", "Pieter Bruegel the Elder", "1565",
     "File:Pieter Bruegel the Elder - Hunters in the Snow (Winter) - Google Art Project.jpg"),
    (
        "blue-horses", "The Large Blue Horses", "Franz Marc", "1911",
        "File:Franz Marc - Die großen blauen Pferde 1911.jpg",
    ),
    ("plum-garden", "Plum Garden at Kameido", "Utagawa Hiroshige", "1857",
     "File:De pruimenboomgaard te Kameido-Rijksmuseum RP-P-1956-743.jpeg"),
    ("grande-jatte", "A Sunday on La Grande Jatte", "Georges Seurat", "1884",
     "File:Georges Seurat - A Sunday on La Grande Jatte -- 1884 - Google Art Project.jpg"),
    (
        "the-kiss", "The Kiss", "Gustav Klimt", "1908",
        "File:The Kiss - Gustav Klimt - Google Cultural Institute.jpg",
    ),
    ("cafe-terrace", "Café Terrace at Night", "Vincent van Gogh", "1888",
     "File:Van Gogh - Terrasse des Cafés an der Place du Forum in Arles am Abend1.jpeg"),
    ("water-lilies", "Bridge over a Pond of Water Lilies", "Claude Monet", "1899",
     "File:Bridge over a Pond of Water Lilies MET DT1854.jpg"),
    ("red-fuji", "Fine Wind, Clear Morning (Red Fuji)", "Katsushika Hokusai", "c. 1831",
     "File:Katsushika Hokusai - Fine Wind, Clear Morning (Gaifū kaisei) - Google Art Project.jpg"),
    ("gris-picasso", "Portrait of Pablo Picasso", "Juan Gris", "1912",
     "File:Juan Gris - Portrait of Pablo Picasso - Google Art Project.jpg"),
    ("tower-of-babel", "The Tower of Babel", "Pieter Bruegel the Elder", "1563",
     "File:Pieter Bruegel the Elder - The Tower of Babel (Vienna) - Google Art Project - edited.jpg"),
    ("sudden-shower", "Sudden Shower over Shin-Ōhashi Bridge", "Utagawa Hiroshige", "1857",
     "File:Hiroshige, Sudden shower over Shin-Ōhashi bridge and Atake, 1857.jpg"),
    ("temeraire", "The Fighting Temeraire", "J. M. W. Turner", "1839",
     "File:The Fighting Temeraire, JMW Turner, National Gallery.jpg"),
    ("composition-vii", "Composition VII", "Wassily Kandinsky", "1913",
     "File:Composition VII - Wassily Kandinsky, GAC.jpg"),
    ("van-gogh-self-portrait", "Self-Portrait", "Vincent van Gogh", "1889",
     "File:Vincent van Gogh - Self-Portrait - Google Art Project.jpg"),
    ("sierra-nevada", "Among the Sierra Nevada, California", "Albert Bierstadt", "1868",
     "File:Albert Bierstadt - Among the Sierra Nevada, California - Google Art Project.jpg"),
]


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def image_info(title: str) -> dict:
    query = urllib.parse.urlencode({
        "action": "query", "titles": title, "prop": "imageinfo", "format": "json",
        "iiprop": "url|extmetadata", "iiurlwidth": FULL_LONG_SIDE,
    })
    pages = json.loads(fetch(f"{API}?{query}"))["query"]["pages"]
    page = next(iter(pages.values()))
    if "imageinfo" not in page:
        raise SystemExit(f"not found on Commons: {title}")
    return page["imageinfo"][0]


def licence_of(info: dict) -> str:
    meta = info.get("extmetadata", {})
    return meta.get("LicenseShortName", {}).get("value", "")


def save_jpeg(image: Image.Image, long_side: int, path: Path, quality: int) -> "tuple[int, int]":
    scale = min(1.0, long_side / max(image.size))
    size = (round(image.width * scale), round(image.height * scale))
    resized = image.resize(size, Image.LANCZOS)
    resized.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    return size


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    refresh_picture_set(root / "pictures", root / ".scratch")


def refresh_picture_set(out_dir: Path, scratch: Path) -> None:
    scratch.mkdir(parents=True, exist_ok=True)
    backup = scratch / "pictures-previous"
    if backup.exists():
        if out_dir.exists():
            shutil.rmtree(backup)
        else:
            os.replace(backup, out_dir)
    stage = Path(tempfile.mkdtemp(prefix="pictures-stage-", dir=str(scratch)))
    try:
        build_picture_set(stage)
        had_pictures = out_dir.exists()
        if had_pictures:
            os.replace(out_dir, backup)
        try:
            os.replace(stage, out_dir)
        except BaseException:
            if had_pictures and not out_dir.exists() and backup.exists():
                os.replace(backup, out_dir)
            raise
        if had_pictures:
            shutil.rmtree(backup)
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def build_picture_set(out_dir: Path) -> None:
    manifest = []
    credits = ["# Picture credits", "",
               "All twenty default pictures are in the public domain. They were downloaded from",
               "Wikimedia Commons by `tools/fetch_pictures.py` and re-encoded.", ""]
    for slug, title, artist, year, commons_title in PICTURES:
        info = image_info(commons_title)
        licence = licence_of(info)
        # CC0 is the Metropolitan Museum's public-domain dedication for its own photographs.
        lowered = licence.lower()
        is_public_domain = "public domain" in lowered or "pd" in lowered or lowered == "cc0"
        if not is_public_domain:
            raise SystemExit(f"{commons_title}: licence is {licence!r}, not public domain")
        raw = fetch(info["thumburl"])
        image = Image.open(io.BytesIO(raw)).convert("RGB")
        width, height = save_jpeg(image, FULL_LONG_SIDE, out_dir / f"{slug}.jpg", 84)
        save_jpeg(image, THUMB_LONG_SIDE, out_dir / f"{slug}-thumb.jpg", 78)
        manifest.append({"id": slug, "title": title, "artist": artist, "year": year,
                         "file": f"pictures/{slug}.jpg", "thumb": f"pictures/{slug}-thumb.jpg",
                         "width": width, "height": height})
        credits.append(f"- **{title}**, {artist}, {year}. {licence}. Source: {info['descriptionurl']}")
        print(f"{slug}\t{width}x{height}\t{licence}")
        time.sleep(1)  # Commons asks clients not to hammer the API.
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (out_dir / "CREDITS.md").write_text("\n".join(credits) + "\n")


if __name__ == "__main__":
    main()
