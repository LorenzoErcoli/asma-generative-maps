#!/usr/bin/env python3
"""Rigenera assets/fronte.jpg dal PDF assets/fronte.pdf.

PERCHE' ESISTE QUESTO SCRIPT
----------------------------
Il fronte della carta si stampa come pagina 1 (vedi #front in index.html e
@media print in css/style.css). Era un <embed type="application/pdf">, e in
stampa usciva un foglio BIANCO col solo numero sopra: un <embed> PDF e' un
viewport di plugin, il browser non ne riversa mai il contenuto nel documento
stampato. Nessuna regola CSS puo' rimediare — l'unico modo di stampare quella
grafica e' avere un'immagine vera nel DOM.

Il PDF resta la sorgente di verita' in assets/: quando cambia, si rilancia
questo script e si ricommitta il JPEG accanto.

USO
    python tools/render-fronte.py            # 300 dpi, qualita' 94
    python tools/render-fronte.py --dpi 200  # piu' leggero

Serve PyMuPDF (import fitz). Se manca:  pip install pymupdf
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'fronte.pdf')
DST = os.path.join(ROOT, 'assets', 'fronte.jpg')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    # 300 dpi non e' vezzo: la copertina e' un pieghevole e i pannelli
    # laterali portano testo di corpo piccolo, che a 150 dpi impasta.
    ap.add_argument('--dpi', type=int, default=300)
    ap.add_argument('--quality', type=int, default=94)
    args = ap.parse_args()

    try:
        import fitz
    except ImportError:
        sys.exit("serve PyMuPDF:  pip install pymupdf")
    from PIL import Image

    if not os.path.exists(SRC):
        sys.exit(f"manca {SRC}")

    doc = fitz.open(SRC)
    page = doc[0]
    mm = (round(page.rect.width / 72 * 25.4, 1), round(page.rect.height / 72 * 25.4, 1))
    pix = page.get_pixmap(dpi=args.dpi)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    img.save(DST, "JPEG", quality=args.quality, optimize=True, progressive=True)

    print(f"{os.path.relpath(SRC, ROOT)}  pagina 1  {mm[0]}x{mm[1]} mm")
    print(f"-> {os.path.relpath(DST, ROOT)}  {pix.width}x{pix.height} px @ {args.dpi} dpi  "
          f"{os.path.getsize(DST) / 1024 / 1024:.2f} MB")
    if doc.page_count > 1:
        print(f"NB: il PDF ha {doc.page_count} pagine, ne viene resa solo la prima.")


if __name__ == '__main__':
    main()
