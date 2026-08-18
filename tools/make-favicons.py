#!/usr/bin/env python3
"""
Rasterise favicon.svg into the two PNG sizes the HTML asks for.

The SVG is the master; these PNGs exist only because Safari's older
raster paths and the iOS home screen do not take an SVG icon. They are
generated, not hand-drawn, so a palette change means re-running this and
never means an icon that still shows last season's colours.

    python3 tools/make-favicons.py

No third-party libraries on purpose: the icon is a rounded square and
three rounded bars, which is less code to draw than a dependency is to
install. Antialiasing is 4x supersampling, which is what a real
rasteriser would do here anyway.
"""
import struct, zlib, pathlib, re

SVG = pathlib.Path(__file__).resolve().parent.parent / 'favicon.svg'
OUT = {32: 'favicon-32.png', 180: 'favicon-180.png'}
SS = 4                      # supersampling factor
VB = 64.0                   # the SVG's viewBox is 0 0 64 64


def parse_svg(text):
    """Pull the ground colour and the bars straight out of the master."""
    rects = re.findall(
        r'<rect([^>]*)/>', text)
    out = []
    for attrs in rects:
        def num(name, default=0.0):
            m = re.search(rf'\b{name}="([-\d.]+)"', attrs)
            return float(m.group(1)) if m else default
        fill = re.search(r'fill="(#[0-9a-fA-F]{6})"', attrs)
        out.append(dict(x=num('x'), y=num('y'), w=num('width'),
                        h=num('height'), rx=num('rx'),
                        fill=fill.group(1) if fill else '#000000'))
    return out


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def inside(px, py, r):
    """Point-in-rounded-rectangle."""
    x, y, w, h, rad = r['x'], r['y'], r['w'], r['h'], r['rx']
    if not (x <= px <= x + w and y <= py <= y + h):
        return False
    if rad <= 0:
        return True
    cx = min(max(px, x + rad), x + w - rad)
    cy = min(max(py, y + rad), y + h - rad)
    return (px - cx) ** 2 + (py - cy) ** 2 <= rad ** 2 + 1e-9


def render(rects, size):
    hi = size * SS
    acc = [[(0, 0, 0, 0)] * hi for _ in range(hi)]
    for j in range(hi):
        uy = (j + 0.5) / hi * VB
        row = acc[j]
        for i in range(hi):
            ux = (i + 0.5) / hi * VB
            rgba = (0, 0, 0, 0)
            for r in rects:                      # painter's algorithm
                if inside(ux, uy, r):
                    rgba = hex2rgb(r['fill']) + (255,)
            row[i] = rgba
    # box-downsample the supersampled buffer
    px = bytearray()
    for y in range(size):
        px.append(0)                             # PNG filter: none
        for x in range(size):
            rs = gs = bs = as_ = 0
            for dy in range(SS):
                for dx in range(SS):
                    r, g, b, a = acc[y * SS + dy][x * SS + dx]
                    rs += r * a; gs += g * a; bs += b * a; as_ += a
            n = SS * SS
            if as_:
                px += bytes((rs // as_, gs // as_, bs // as_, as_ // n))
            else:
                px += b'\0\0\0\0'
    return bytes(px)


def write_png(path, size, raw):
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    pathlib.Path(path).write_bytes(png)


def main():
    rects = parse_svg(SVG.read_text())
    print(f'{SVG.name}: {len(rects)} shapes ->',
          ', '.join(r['fill'] for r in rects))
    for size, name in OUT.items():
        write_png(SVG.parent / name, size, render(rects, size))
        print(f'  wrote {name} ({size}x{size})')


if __name__ == '__main__':
    main()
