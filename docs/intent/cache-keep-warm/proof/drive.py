"""Drive one interactive Claude Code session in a Windows pseudo-console (ConPTY).

Usage: python -I drive.py <name> <cwd> <outdir> -- <command...>

Keeps a virtual screen (pyte) of what the session draws, and takes commands from
<outdir>/<name>.cmd, one per line, appended by whoever drives it:
  text <words>   type the words (no Enter)
  enter          press Enter
  esc            press Escape
  key <hex>      send raw bytes given as hex, e.g. key 1b5b42 (down arrow)
  snap <label>   write the screen as <name>-<label>.txt and .png
  quit           end the session and this driver
It also writes <name>-latest.txt every 30 s, and holds the machine awake while it runs.
"""
import ctypes
import os
import sys
import threading
import time

import pyte
from PIL import Image, ImageDraw, ImageFont
from winpty import PtyProcess

COLS, ROWS = 140, 48

name, cwd, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
argv = sys.argv[sys.argv.index('--') + 1:]
os.makedirs(outdir, exist_ok=True)

# ES_CONTINUOUS | ES_SYSTEM_REQUIRED: no idle sleep while this process runs.
ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)

screen = pyte.Screen(COLS, ROWS)
stream = pyte.Stream(screen)
lock = threading.Lock()
# A session of its own: nothing of the session that started this driver (its id, messaging socket, entrypoint, modes).
env = {key: value for key, value in os.environ.items() if not key.upper().startswith(('CLAUDE', 'ANTHROPIC'))}
proc = PtyProcess.spawn(argv, cwd=cwd, dimensions=(ROWS, COLS), env=env)
raw = open(os.path.join(outdir, f'{name}-raw.log'), 'a', encoding='utf-8')
log = open(os.path.join(outdir, f'{name}-driver.log'), 'a', encoding='utf-8')


def note(text):
    log.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")} {text}\n')
    log.flush()


def reader():
    while proc.isalive():
        try:
            data = proc.read(65536)
        except EOFError:
            break
        except Exception as error:  # a read can fail as the process ends
            note(f'read failed: {error!r}')
            break
        if data:
            raw.write(data)
            raw.flush()
            with lock:
                stream.feed(data)
    note('session ended')


def screen_text():
    with lock:
        return '\n'.join(line.rstrip() for line in screen.display)


PALETTE = {
    'black': (12, 12, 12), 'red': (197, 15, 31), 'green': (19, 161, 14), 'brown': (193, 156, 0),
    'yellow': (193, 156, 0), 'blue': (0, 55, 218), 'magenta': (136, 23, 152), 'cyan': (58, 150, 221),
    'white': (204, 204, 204), 'lightgray': (204, 204, 204), 'grey': (118, 118, 118), 'gray': (118, 118, 118),
    'brightblack': (118, 118, 118), 'brightred': (231, 72, 86), 'brightgreen': (22, 198, 12),
    'brightyellow': (249, 241, 165), 'brightblue': (59, 120, 255), 'brightmagenta': (180, 0, 158),
    'brightcyan': (97, 214, 214), 'brightwhite': (242, 242, 242),
}
BG, FG = (24, 24, 27), (220, 220, 220)
FONT = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 16)
SYMBOLS = ImageFont.truetype('C:/Windows/Fonts/seguisym.ttf', 15)
CW, CH = 9, 19


def colour(value, default):
    if value in ('default', None, ''):
        return default
    if value in PALETTE:
        return PALETTE[value]
    if len(value) == 6:
        try:
            return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            pass
    return default


def snap(label):
    text = screen_text()
    stamp = time.strftime('%Y-%m-%d %H:%M:%S')
    with open(os.path.join(outdir, f'{name}-{label}.txt'), 'w', encoding='utf-8') as f:
        f.write(f'# {name} {label} at {stamp}\n{text}\n')
    image = Image.new('RGB', (COLS * CW + 20, ROWS * CH + 44), BG)
    draw = ImageDraw.Draw(image)
    draw.text((10, 8), f'{name} · {label} · {stamp} (ConPTY screen of the live session)', font=FONT, fill=(150, 150, 160))
    with lock:
        buffer = {y: dict(screen.buffer[y]) for y in range(ROWS)}
    for y in range(ROWS):
        for x, char in buffer[y].items():
            if x >= COLS:
                continue
            fg, bg = colour(char.fg, FG), colour(char.bg, BG)
            if char.reverse:
                fg, bg = bg, fg
            left, top = 10 + x * CW, 34 + y * CH
            if bg != BG:
                draw.rectangle([left, top, left + CW, top + CH], fill=bg)
            if char.data.strip():
                font = FONT if ord(char.data[0]) < 0x2500 else SYMBOLS
                draw.text((left, top), char.data, font=font, fill=fg)
    image.save(os.path.join(outdir, f'{name}-{label}.png'))
    note(f'snap {label}')


threading.Thread(target=reader, daemon=True).start()
note(f'started: {argv} in {cwd}')
commands = os.path.join(outdir, f'{name}.cmd')
open(commands, 'a').close()
done = 0
last_latest = 0.0
while True:
    with open(commands, encoding='utf-8') as f:
        lines = f.read().splitlines()
    for line in lines[done:]:
        done += 1
        verb, _, rest = line.partition(' ')
        note(f'cmd {line}')
        if verb == 'text':
            proc.write(rest)
        elif verb == 'enter':
            proc.write('\r')
        elif verb == 'esc':
            proc.write('\x1b')
        elif verb == 'key':
            proc.write(bytes.fromhex(rest).decode('latin-1'))
        elif verb == 'snap':
            snap(rest or 'snap')
        elif verb == 'quit':
            snap('final')
            proc.terminate(force=True)
            note('quit')
            sys.exit(0)
        time.sleep(0.3)
    if time.time() - last_latest > 30:
        last_latest = time.time()
        with open(os.path.join(outdir, f'{name}-latest.txt'), 'w', encoding='utf-8') as f:
            f.write(f'# {time.strftime("%Y-%m-%d %H:%M:%S")}\n{screen_text()}\n')
    if not proc.isalive():
        snap('ended')
        sys.exit(0)
    time.sleep(0.5)
