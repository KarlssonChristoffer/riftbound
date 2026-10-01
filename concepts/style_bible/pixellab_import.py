# PixelLab test: downloads the PixelLab-generated frames and writes sheets + pixellab/frames.json for index.html.
#   python concepts/style_bible/pixellab_import.py
# Two variants per hero: "text" = create_character (side view, text prompt only, PixelLab's own style) and
# "styled" = create_image_pro_flash with our hand-made bible frame as style reference, animated with animate_image.
import io, json, os, urllib.request
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'pixellab')
CH = 'https://backblaze.pixellab.ai/file/pixellab-characters/0a1d5c2c-293a-46ed-b939-30a3b801a118/'
IM = 'https://api.pixellab.ai/mcp/images/'


def char_anim(char, anim, n):
    return [f'{CH}{char}/animations/{anim}/east/{i}.png' for i in range(n)]


def job(jid, n):
    return [f'{IM}{jid}/download?index={i}' for i in range(n)]


# attack timing: 9 frames (frame 0 = rest pose), hold the release/impact frames a little longer
ATK = [100, 90, 90, 110, 70, 140, 120, 110, 160]
FIGS = [
    ('ranger_text', 'Ranger (PixelLab, text only)', 'create_character side view + template idle + v3 custom attack',
     {'idle': char_anim('05fa814b-8867-499e-9189-4b76d155b32c', 'f23df25e-dab7-495b-85e7-a63495b07b34', 4),
      'attack': char_anim('05fa814b-8867-499e-9189-4b76d155b32c', '6d10f8a2-e319-4781-b34e-304c27aa475e', 9)}),
    ('warden_text', 'Warden (PixelLab, text only)', 'create_character side view + template idle + v3 custom attack',
     {'idle': char_anim('84ba4805-e81b-406d-9ada-c28cdf4ed2ca', '2229426a-722d-4ca5-881a-b94c6caafcf6', 4),
      'attack': char_anim('84ba4805-e81b-406d-9ada-c28cdf4ed2ca', '35f0cd4f-8fd0-477a-bcda-1de1b985f976', 9)}),
    ('pyro_text', 'Pyromancer (PixelLab, text only)', 'create_character side view + template idle + v3 custom attack',
     {'idle': char_anim('ab2226d7-4bee-4c29-8894-39ef29874885', '8b23a17d-fcc7-49fb-9cf4-27ce21f9c257', 4),
      'attack': char_anim('ab2226d7-4bee-4c29-8894-39ef29874885', 'd98cbb4c-d8e5-4f87-9287-fc0efc5b543b', 9)}),
    ('ranger_styled', 'Ranger (PixelLab, our frame as style ref)', 'pro flash + style image, animate_image idle/attack',
     {'idle': job('7db5f9b6-3f7d-439c-bd9c-20e42d74c51a', 5), 'attack': job('cd117108-d174-46eb-a0f1-91aa7ebf4ea1', 9)}),
    ('warden_styled', 'Warden (PixelLab, our frame as style ref)', 'pro flash + style image, animate_image idle/attack',
     {'idle': job('342bb15c-2eec-4b31-97df-c9f6f141a435', 5), 'attack': job('630a8216-846e-47ff-99a7-7b5a5fb665e1', 9)}),
    ('pyro_styled', 'Pyromancer (PixelLab, our frame as style ref)', 'pro flash + style image, animate_image idle/attack',
     {'idle': job('fa092d08-1855-4534-b509-e530cc9f0324', 5), 'attack': job('078380c5-efef-495f-87fd-38a6b999f811', 9)}),
]


def fetch(url):
    cache = os.path.join(OUT, 'cache', url.split('//')[1].replace('/', '_').replace('?', '_') + ('' if url.endswith('.png') else '.png'))
    if not os.path.exists(cache):
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        data = urllib.request.urlopen(req, timeout=60).read()
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        open(cache, 'wb').write(data)
    return Image.open(cache).convert('RGBA')


def union(boxes):
    boxes = [b for b in boxes if b]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def main():
    os.makedirs(OUT, exist_ok=True)
    out = []
    for key, name, note, anims in FIGS:
        frames, spec = [], {}
        # the animate_image idle loop echoes the input as frame 0; keep it, it closes the loop
        for aname, urls in anims.items():
            imgs = [fetch(u) for u in urls]
            dur = ATK if aname == 'attack' else [220] * len(imgs)
            spec[aname] = [[len(frames) + i, dur[i % len(dur)]] for i in range(len(imgs))]
            frames += imgs
        box = union([f.getbbox() for f in frames])
        box = (max(0, box[0] - 1), max(0, box[1] - 1), box[2] + 1, box[3] + 1)
        w, h = box[2] - box[0], box[3] - box[1]
        sheet = Image.new('RGBA', (w * len(frames), h))
        for i, f in enumerate(frames):
            sheet.alpha_composite(f.crop(box), (i * w, 0))
        sheet.save(os.path.join(OUT, key + '.png'))
        fig = frames[0].getbbox()
        out.append({'name': name, 'note': f'{note}; figure {fig[3] - fig[1]} px tall', 'w': w, 'h': h,
                    'sheet': 'pixellab/' + key + '.png', 'anims': spec})
        print(key, len(frames), 'frames', (w, h), 'figure h', fig[3] - fig[1])
    json.dump(out, open(os.path.join(OUT, 'frames.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
