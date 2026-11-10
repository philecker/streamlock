"""Draws the StreamLock app icon: build/icon.png (1024 x 1024).

electron-builder turns this PNG into the .icns that Finder, Applications,
Launchpad and Spotlight show. Layout follows Apple's macOS icon grid: an
824 px rounded square centered on a 1024 canvas with a soft drop shadow.
Run: python3 scripts/make_app_icon.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "build" / "icon.png"
SIZE = 1024
SS = 4  # oversampling
TILE, RADIUS = 824, 185
AMBER = (242, 184, 75, 255)


def main() -> None:
    S = SIZE * SS
    k = SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Drop shadow under the tile.
    off = (SIZE - TILE) // 2
    shadow = Image.new("L", (S, S), 0)
    ImageDraw.Draw(shadow).rounded_rectangle(
        [off * k, (off + 12) * k, (off + TILE) * k, (off + TILE + 12) * k], radius=RADIUS * k, fill=110
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(18 * k))
    img.paste((0, 0, 0, 255), mask=shadow)

    # Tile: dark vertical gradient, clipped to the rounded square.
    grad = Image.new("RGBA", (S, S))
    top, bottom = (52, 55, 63), (20, 21, 25)
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / (S - 1)
        gd.line([(0, y), (S, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([off * k, off * k, (off + TILE) * k, (off + TILE) * k], radius=RADIUS * k, fill=255)
    img.paste(grad, mask=mask)

    # Faint top highlight on the tile edge.
    rim = Image.new("L", (S, S), 0)
    ImageDraw.Draw(rim).rounded_rectangle(
        [off * k, off * k, (off + TILE) * k, (off + TILE) * k], radius=RADIUS * k, outline=60, width=3 * k
    )
    img.paste((255, 255, 255, 255), mask=Image.composite(rim, Image.new("L", (S, S), 0), mask))

    # Glyph: the same play-lock as the menu bar icon, on a 24-unit grid.
    # Its extent incl. stroke is x 3..21, y 2..22 (20 units) -> 500 px tall.
    u = 25 * k
    cx, cy = SIZE / 2 * k, SIZE / 2 * k
    X = lambda v: cx + (v - 12) * u  # noqa: E731
    Y = lambda v: cy + (v - 12) * u  # noqa: E731
    d = ImageDraw.Draw(img)
    w = round(2 * u)

    # Body with a soft amber wash, outlined.
    body = [X(4), Y(10), X(20), Y(21)]
    wash = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(wash).rounded_rectangle(body, radius=2.5 * u, fill=(242, 184, 75, 46))
    img.alpha_composite(wash)
    d.rounded_rectangle(body, radius=2.5 * u, outline=AMBER, width=w)

    # Shackle.
    r = 4 * u
    d.arc([X(12) - r - w / 2, Y(7) - r - w / 2, X(12) + r + w / 2, Y(7) + r + w / 2], 180, 360, fill=AMBER, width=w)
    for x in (8, 16):
        d.rectangle([X(x) - w / 2, Y(7), X(x) + w / 2, Y(10) + w / 2], fill=AMBER)

    # Play triangle.
    d.polygon([(X(10.2), Y(12.8)), (X(10.2), Y(18.2)), (X(14.9), Y(15.5))], fill=AMBER)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.resize((SIZE, SIZE), Image.LANCZOS).save(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
