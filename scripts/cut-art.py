"""Cut the painted creatures and heroes out of their grey studio background, locally: BiRefNet-lite (MIT) via onnxruntime.
   python scripts/cut-art.py SRC.webp OUT.webp [SRC OUT ...]
The model (224 MB) is fetched once from huggingface.co/onnx-community/BiRefNet_lite-ONNX into ~/.cache/junglee/.
Trims the transparent margin (feet on the bottom edge) and caps the height at 720 px; WebP with alpha."""
import os
import sys

MAXH = int(os.environ.get('MAXH', '720'))

import numpy as np
import onnxruntime as ort
from PIL import Image

MODEL = os.path.expanduser("~/.cache/junglee/birefnet_lite.onnx")
sess = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
inp = sess.get_inputs()[0].name
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

args = sys.argv[1:]
for src, out in zip(args[0::2], args[1::2]):
    img = Image.open(src).convert("RGB")
    x = np.asarray(img.resize((1024, 1024), Image.BILINEAR), dtype=np.float32) / 255.0
    x = ((x - MEAN) / STD).transpose(2, 0, 1)[None]
    y = sess.run(None, {inp: x})[-1][0, 0]
    m = 1 / (1 + np.exp(-y))
    mask = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8)).resize(img.size, Image.BILINEAR)
    cut = img.copy()
    cut.putalpha(mask)
    box = mask.point(lambda a: 255 if a > 16 else 0).getbbox()
    if box:
        cut = cut.crop(box)
    if cut.height > MAXH:
        cut = cut.resize((round(cut.width * MAXH / cut.height), MAXH), Image.LANCZOS)
    cut.save(out, "WEBP", quality=84, alpha_quality=92, method=6)
    print("cut", out, cut.size, flush=True)
