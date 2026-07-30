"""Generate PWA app icons for the AAC Conversation Assistant.
Brand color #2c3e50 (header). Regenerable on request: python icons/generate_icons.py

icon-192/512/maskable land here in icons/; apple-touch-icon.png goes to the
app root (the conventional location browsers probe by default).
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.dirname(HERE)

BRAND = (44, 62, 80)        # #2c3e50
ACCENT = (236, 240, 241)    # near-white bubble
DOT = (44, 62, 80)

def rounded(size, radius_frac=0.22):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_frac)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BRAND)
    return img, d

def draw_bubble(img, d, size, pad_frac):
    pad = int(size * pad_frac)
    bx0, by0 = pad, pad
    bx1, by1 = size - pad, int(size - pad * 1.35)
    br = int((by1 - by0) * 0.30)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=br, fill=ACCENT)
    # tail
    tw = int(size * 0.11)
    tx = bx0 + int((bx1 - bx0) * 0.28)
    ty = by1 - 2
    d.polygon([(tx, ty), (tx + tw, ty), (tx, ty + int(size * 0.13))], fill=ACCENT)
    # three dots (conversation)
    cy = (by0 + by1) // 2
    rdot = max(2, int(size * 0.045))
    gap = int(size * 0.16)
    cx = (bx0 + bx1) // 2
    for off in (-gap, 0, gap):
        d.ellipse([cx + off - rdot, cy - rdot, cx + off + rdot, cy + rdot], fill=DOT)

def make(size, pad_frac, name):
    img, d = rounded(size)
    draw_bubble(img, d, size, pad_frac)
    img.save(name)
    print("wrote", name)

# Standard icons (modest internal padding)
make(192, 0.20, os.path.join(HERE, "icon-192.png"))
make(512, 0.20, os.path.join(HERE, "icon-512.png"))
# Apple touch icon lives at the app root by convention.
make(180, 0.18, os.path.join(APP_ROOT, "apple-touch-icon.png"))

# Maskable: extra safe-zone padding so platform masks don't clip content
img, d = rounded(512, radius_frac=0.0)  # full-bleed bg for maskable
d.rectangle([0, 0, 511, 511], fill=BRAND)
draw_bubble(img, d, 512, 0.30)
img.save(os.path.join(HERE, "icon-maskable-512.png"))
print("wrote icon-maskable-512.png")
