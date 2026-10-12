"""Derive launcher icons from the approved homepage logo without redrawing it.

Requires Pillow: python tools/build-app-icons.py
The transparent source stays unchanged. All installed-app icons use the site's
opaque background; Android gets a separate version with the complete logo and
tagline inside the minimum maskable safe circle (40% of the icon width).
"""

from math import hypot
from pathlib import Path

from PIL import Image


ASSETS = Path(__file__).resolve().parent.parent / "assets"
BACKGROUND = "#161009"
SOURCE = ASSETS / "data-dawgs-site-logo-560.png"


def build_icons():
    logo = Image.open(SOURCE).convert("RGBA")
    assert logo.width == logo.height, "The approved logo must be square"

    def render(size, artwork_size):
        artwork = logo.resize((artwork_size, artwork_size), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (size, size), BACKGROUND)
        inset = (size - artwork_size) // 2
        canvas.alpha_composite(artwork, (inset, inset))
        return canvas.convert("RGB")

    for size in (180, 192, 512):
        render(size, size).save(ASSETS / f"icon-{size}.png", optimize=True)

    # Use the actual alpha silhouette, including the entire wordmark and tagline.
    # A 38% radius leaves room for resampling around the required 40% safe circle.
    center = (logo.width - 1) / 2
    radius = max(
        hypot(x - center, y - center)
        for y in range(logo.height)
        for x in range(logo.width)
        if logo.getpixel((x, y))[3]
    )
    size = 512
    artwork_size = 2 * int(logo.width * (size * 0.38 / radius) / 2)
    render(size, artwork_size).save(ASSETS / "icon-maskable-512.png", optimize=True)
    print(f"Built opaque 180, 192, 512 icons and a 512 maskable icon ({artwork_size}px artwork)")


if __name__ == "__main__":
    build_icons()
