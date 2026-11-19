#!/usr/bin/env python3
"""
Build the PII-free PDF fixture used by test/pdf.test.cjs.

Why this file exists: the reader must be tested against a PDF that looks like the
M-Pesa export (two pages, a summary block, a receipt table, wrapped Details lines,
signed amounts) without shipping anybody's real statement. The content below is
invented; the layout numbers are copied from a real statement.

The plain PDF is written by hand so it has no third-party dependency, then pypdf
(dev-only, never shipped) applies the same encryption Safaricom uses: Standard
handler, V2/R3, RC4-128, password "chama".

Run:
    python projects/chama-ledger/importer/test/make-pdf-fixture.py

Only regenerate when the fixture layout or the reader's expectations change.
"""

from pathlib import Path

OUT = Path(__file__).resolve().parent / "fixtures" / "mpesa-mini-encrypted.pdf"
PASSWORD = "chama"


def esc(text):
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def page_stream(items):
    lines = ["BT", "/F1 8 Tf"]
    for x, y, text in items:
        lines.append("1 0 0 1 %s %s Tm (%s) Tj" % (x, y, esc(text)))
    lines.append("ET")
    return "\n".join(lines)


PAGE_1 = [
    (525, 804, "Page 1 of 2"),
    (227, 770, "M-PESA STATEMENT"),
    (38, 748, "Customer Name: CHAMA TEST GROUP"),
    (38, 731, "Mobile Number: 254700***000"),
    (38, 714, "Statement Period: 01 Nov 2026 - 30 Nov 2026"),
    (38, 697, "Request Date: 30 Nov 2026"),
    (270, 672, "SUMMARY"),
    (38, 655, "TRANSACTION TYPE"),
    (389, 655, "PAID IN"),
    (490, 655, "PAID OUT"),
    (38, 640, "RECEIVED MONEY:"),
    (389, 640, "2,000.00"),
    (490, 640, "0.00"),
    (38, 625, "PAY BILL:"),
    (389, 625, "0.00"),
    (490, 625, "523.00"),
    (38, 605, "TOTAL:"),
    (389, 605, "2,000.00"),
    (490, 605, "523.00"),
    (235, 580, "DETAILED STATEMENT"),
    (51, 560, "Receipt No."),
    (111, 560, "Completion Time"),
    (216, 560, "Details"),
    (282, 560, "Transaction Status"),
    (373, 560, "Paid In"),
    (436, 560, "Withdrawn"),
    (510, 560, "Balance"),
    (38, 548, "AAA0000001"),
    (108, 548, "2026-11-02 09:15:00"),
    (178, 548, "Funds received from -"),
    (282, 548, "Completed"),
    (400, 548, "2,000.00"),
    (510, 548, "12,000.00"),
    (178, 542, "254700***001 MARY WANJIKU"),
    (38, 530, "AAA0000002"),
    (108, 530, "2026-11-03 10:00:00"),
    (178, 530, "Pay Bill Online to 400200 -"),
    (282, 530, "Completed"),
    (465, 530, "-500.00"),
    (510, 530, "11,500.00"),
    (178, 524, "KPLC PREPAID"),
    (178, 518, "Acc. 12345678"),
    (38, 496, "Disclaimer: Any personal information shared with you should be handled"),
    (38, 490, "in accordance with the Data Protection Act."),
]

PAGE_2 = [
    (525, 804, "Page 2 of 2"),
    (51, 785, "Receipt No."),
    (111, 785, "Completion Time"),
    (216, 785, "Details"),
    (282, 785, "Transaction Status"),
    (373, 785, "Paid In"),
    (436, 785, "Withdrawn"),
    (510, 785, "Balance"),
    (38, 773, "AAA0000003"),
    (108, 773, "2026-11-05 18:30:00"),
    (178, 773, "Customer Transfer of Funds"),
    (282, 773, "Completed"),
    (468, 773, "-23.00"),
    (510, 773, "11,477.00"),
    (178, 767, "Charge"),
    (38, 740, "Statement Verification: QWERTY123"),
]


def build_plain():
    streams = [page_stream(PAGE_1), page_stream(PAGE_2)]
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            b"/Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>"
        ),
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            b"/Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>"
        ),
        b"<< /Length %d >>\nstream\n" % len(streams[0]) + streams[0].encode("latin-1") + b"\nendstream",
        b"<< /Length %d >>\nstream\n" % len(streams[1]) + streams[1].encode("latin-1") + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"

    xref_at = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1)
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref_at)
    return bytes(out)


def main():
    from pypdf import PdfReader, PdfWriter

    plain = build_plain()
    reader = PdfReader(__import__("io").BytesIO(plain))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt(user_password=PASSWORD, owner_password="chama-owner", algorithm="RC4-128")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("wb") as handle:
        writer.write(handle)
    print("wrote %s (%d bytes), password %r" % (OUT, OUT.stat().st_size, PASSWORD))


if __name__ == "__main__":
    main()
