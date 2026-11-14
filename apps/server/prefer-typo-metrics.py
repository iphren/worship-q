"""Marks the Noto CJK fonts to prefer their typographic line metrics (OS/2 USE_TYPO_METRICS).

Noto CJK's default lines are nearly half as tall again as those of the fonts decks are made
with (宋体, 微软雅黑, 等线…), so LibreOffice set Chinese text, and table rows above all, taller
than PowerPoint does, running them off the slide. The fonts also carry lines of the usual
height, which LibreOffice uses once a font is marked this way. Run while building the image.
"""
import glob
import os
import sys

from fontTools.ttLib import TTCollection

USE_TYPO_METRICS = 1 << 7

paths = glob.glob("/usr/share/fonts/opentype/noto/Noto*CJK*.ttc")
if not paths:
    sys.exit("No Noto CJK fonts found to mark.")
for path in paths:
    collection = TTCollection(path)
    for font in collection.fonts:
        font["OS/2"].fsSelection |= USE_TYPO_METRICS
    # Written beside the font first: the original is still being read while saving.
    collection.save(path + ".new")
    os.replace(path + ".new", path)
    print("Marked", path)
