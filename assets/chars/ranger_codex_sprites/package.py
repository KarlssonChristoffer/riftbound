"""Build small, aligned sprites from the saved ImageGen source images.

Run with a Python installation that has Pillow. This script only crops,
thresholds alpha, resizes with nearest-neighbour, and assembles a preview.
"""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source"
FRAME = (96, 96)
PIVOT = (48, 80)
IDLE_HEIGHT = 60
POSES = ("idle", "run", "aim")


def opaque_bbox(image):
    alpha = image.getchannel("A")
    return alpha.point(lambda value: 255 if value >= 128 else 0).getbbox()


def build_pose(name, scale):
    original = Image.open(SOURCE / f"{name}.png").convert("RGBA")
    bbox = opaque_bbox(original)
    if bbox is None:
        raise ValueError(f"No visible pixels in {name}.png")

    cropped = original.crop(bbox)
    alpha = cropped.getchannel("A").point(lambda value: 255 if value >= 128 else 0)
    cropped.putalpha(alpha)
    size = tuple(max(1, round(dimension * scale)) for dimension in cropped.size)
    sprite = cropped.resize(size, Image.Resampling.NEAREST)

    frame = Image.new("RGBA", FRAME)
    left = PIVOT[0] - sprite.width // 2
    top = PIVOT[1] - sprite.height
    if left < 0 or top < 0 or left + sprite.width > FRAME[0] or top + sprite.height > FRAME[1]:
        raise ValueError(f"{name} exceeds the fixed frame: {sprite.size}")
    frame.alpha_composite(sprite, (left, top))
    frame.save(ROOT / f"{name}.png")
    return frame


def checker(size, cell=8):
    image = Image.new("RGBA", size, (48, 51, 57, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(57, 60, 66, 255))
    return image


def main():
    idle = Image.open(SOURCE / "idle.png").convert("RGBA")
    bbox = opaque_bbox(idle)
    if bbox is None:
        raise ValueError("Idle source has no visible pixels")
    scale = IDLE_HEIGHT / (bbox[3] - bbox[1])
    frames = [build_pose(name, scale) for name in POSES]

    sheet = Image.new("RGBA", (FRAME[0] * len(frames), FRAME[1]))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (index * FRAME[0], 0))
    sheet.save(ROOT / "sheet.png")

    # Visual QA at native game scale and integer 2x enlargement.
    preview = Image.new("RGBA", (576, 270), (31, 35, 42, 255))
    draw = ImageDraw.Draw(preview)
    draw.text((16, 12), "RANGER / 96x96 / foot pivot 48,80", fill=(215, 215, 208))
    for index, (name, frame) in enumerate(zip(POSES, frames)):
        x = 16 + index * 188
        panel = checker((96, 96))
        panel.alpha_composite(frame)
        preview.alpha_composite(panel, (x, 38))
        draw.text((x + 2, 140), name, fill=(215, 215, 208))
        zoom = frame.resize((96 * 2, 96 * 2), Image.Resampling.NEAREST)
        # Cropped 2x close-up keeps preview compact.
        preview.alpha_composite(zoom.crop((32, 32, 160, 128)), (x, 166))
    preview.convert("RGB").save(ROOT / "preview.png")


if __name__ == "__main__":
    main()
