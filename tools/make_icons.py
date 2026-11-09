"""Draw the app icons (run once:  uv run python tools/make_icons.py)."""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "assets" / "icons"
BLUE, WHITE = (28, 92, 171), (255, 255, 255)


def draw(size: int) -> Image.Image:
    scale = 4  # draw big, then shrink for smooth edges
    s = size * scale
    img = Image.new("RGB", (s, s), BLUE)  # full-bleed square: also fine as a maskable icon
    d = ImageDraw.Draw(img)
    # a simple plane pointing up-right, kept inside the central 60% (maskable safe zone)
    def p(x, y):
        return (s * (0.2 + 0.6 * x), s * (0.2 + 0.6 * y))
    body = [p(0.95, 0.05), p(0.55, 0.95), p(0.42, 0.58), p(0.05, 0.45)]
    d.polygon(body, fill=WHITE)
    d.line([p(0.42, 0.58), p(0.95, 0.05)], fill=BLUE, width=max(2, s // 60))
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        draw(size).save(OUT / f"icon-{size}.png")
        print("wrote", OUT / f"icon-{size}.png")
