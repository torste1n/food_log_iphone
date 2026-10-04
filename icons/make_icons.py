"""Draws the home-screen icons: a plate with a fork and a knife. Run once; the PNGs are
kept in the repository. Needs Pillow.

    python make_icons.py
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
BACKGROUND = (27, 175, 122)     # the app's green
WHITE = (255, 255, 255)
SCALE = 4                       # draw large, then shrink, for smooth edges


def draw_icon(size):
    s = size * SCALE
    img = Image.new("RGB", (s, s), BACKGROUND)
    d = ImageDraw.Draw(img)
    u = s / 100                 # the design is laid out on a 100 x 100 grid

    # plate: a ring, kept inside the central 60% so a round or rounded mask never clips it
    d.ellipse([34 * u, 31 * u, 72 * u, 69 * u], outline=WHITE, width=round(4.5 * u))

    # fork, left of the plate: three tines, a neck and a handle
    for x in (20.5, 24.5, 28.5):
        d.rounded_rectangle([(x - 1.1) * u, 27 * u, (x + 1.1) * u, 43 * u], radius=1.1 * u, fill=WHITE)
    d.rounded_rectangle([19.4 * u, 40 * u, 29.6 * u, 46 * u], radius=3 * u, fill=WHITE)
    d.rounded_rectangle([22.7 * u, 43 * u, 26.3 * u, 73 * u], radius=1.8 * u, fill=WHITE)

    # knife, right of the plate: a blade and a handle
    d.pieslice([77 * u, 27 * u, 91 * u, 71 * u], start=90, end=270, fill=WHITE)
    d.rounded_rectangle([82.2 * u, 47 * u, 85.8 * u, 73 * u], radius=1.8 * u, fill=WHITE)

    return img.resize((size, size), Image.LANCZOS)


for size in (180, 192, 512):
    path = os.path.join(HERE, f"icon-{size}.png")
    draw_icon(size).save(path, optimize=True)
    print("wrote", path)
