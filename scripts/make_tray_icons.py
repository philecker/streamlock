"""Draws the menu bar "Play lock" template icons (black + alpha) at 1x and 2x.

macOS tints template images for light/dark menu bars, so only alpha matters.

The icon is 18 pt square (18 px @1x, 36 px @2x). Geometry is laid out on the
36 px grid so every stroke edge lands on a whole pixel at both scales: strokes
are 4 px @2x and 2 px @1x, which keeps lines crisp instead of half-covered and
fuzzy. Shapes are drawn 16x oversized and averaged down with a box filter, so
diagonals and curves are smooth with no halo around the hard edges.

Run: python3 scripts/make_tray_icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "resources"
GRID = 36  # layout grid = the @2x pixel grid
SS = 16  # oversampling per output pixel
STROKE = 4  # on the 36 grid -> 4 px @2x, 2 px @1x

# Layout on the 36 px grid (all edges even, so they halve cleanly to @1x).
BODY = (2, 16, 34, 36)  # outer edge of the body outline: x0, y0, x1, y1
BODY_RADIUS = 5
SHACKLE_CX, SHACKLE_CY, SHACKLE_R = 18, 10, 10  # outer radius; top edge at y=0
LEG_LEFT_X, LEG_RIGHT_X = 8, 24  # outer-left edge of each 4 px leg
TRIANGLE = [(15, 22), (15, 30), (22, 26)]
DOT_CX, DOT_CY, DOT_R, DOT_GAP = 30, 6, 5.5, 2.5


def draw(state: str, px: int) -> Image.Image:
    k = px * SS / GRID  # grid units -> oversampled pixels
    size = px * SS
    img = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(img)
    w = round(STROKE * k)

    def box(x0, y0, x1, y1):
        # PIL boxes are inclusive; subtract one oversampled pixel so an edge at
        # grid x1 ends exactly on that pixel boundary.
        return [round(x0 * k), round(y0 * k), round(x1 * k) - 1, round(y1 * k) - 1]

    d.rounded_rectangle(box(*BODY), radius=round(BODY_RADIUS * k), outline=255, width=w)

    r = SHACKLE_R
    arc_box = box(SHACKLE_CX - r, SHACKLE_CY - r, SHACKLE_CX + r, SHACKLE_CY + r)
    leg_top, leg_bottom = SHACKLE_CY, BODY[1] + STROKE / 2
    if state == "locked":
        d.arc(arc_box, 180, 360, fill=255, width=w)
        d.rectangle(box(LEG_LEFT_X, leg_top, LEG_LEFT_X + STROKE, leg_bottom), fill=255)
        d.rectangle(box(LEG_RIGHT_X, leg_top, LEG_RIGHT_X + STROKE, leg_bottom), fill=255)
    else:
        # Open: the arc stops short and the right leg is gone.
        d.arc(arc_box, 180, 325, fill=255, width=w)
        d.rectangle(box(LEG_LEFT_X, leg_top, LEG_LEFT_X + STROKE, leg_bottom), fill=255)

    d.polygon([(x * k, y * k) for x, y in TRIANGLE], fill=255)

    if state == "attention":
        cx, cy = DOT_CX * k, DOT_CY * k
        outer = (DOT_R + DOT_GAP) * k
        d.ellipse([cx - outer, cy - outer, cx + outer, cy + outer], fill=0)  # clear a ring
        rd = DOT_R * k
        d.ellipse([cx - rd, cy - rd, cx + rd, cy + rd], fill=255)

    alpha = img.resize((px, px), Image.BOX)  # exact area coverage, no ringing
    out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    out.putalpha(alpha)
    return out


def main() -> None:
    OUT.mkdir(exist_ok=True)
    names = {"locked": "trayTemplate", "open": "trayOpenTemplate", "attention": "trayAttentionTemplate"}
    for state, name in names.items():
        draw(state, GRID // 2).save(OUT / f"{name}.png")
        draw(state, GRID).save(OUT / f"{name}@2x.png")
    print("wrote", ", ".join(sorted(p.name for p in OUT.glob("tray*.png"))))


if __name__ == "__main__":
    main()
