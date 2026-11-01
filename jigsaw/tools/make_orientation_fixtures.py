"""Create small JPEGs with the same displayed red-top, blue-bottom image."""

import sys
from pathlib import Path

from PIL import Image, ImageDraw


def main(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    upright = Image.new("RGB", (2400, 1200))
    draw = ImageDraw.Draw(upright)
    draw.rectangle((0, 0, 2399, 599), fill="red")
    draw.rectangle((0, 600, 2399, 1199), fill="blue")
    upright_exif = Image.Exif()
    upright_exif[274] = 1
    upright.save(directory / "orientation-1.jpg", quality=95, exif=upright_exif)

    rotated = Image.new("RGB", (1200, 2400))
    draw = ImageDraw.Draw(rotated)
    draw.rectangle((0, 0, 599, 2399), fill="red")
    draw.rectangle((600, 0, 1199, 2399), fill="blue")
    exif = Image.Exif()
    exif[274] = 6
    rotated.save(directory / "orientation-6.jpg", quality=95, exif=exif)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
