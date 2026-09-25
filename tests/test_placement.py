"""Bed placement: the drawing must sit on the machine, top edge at Y home."""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest
import vpype as vp

import export_gcode as eg

PX_TO_MM = eg.PX_TO_MM


def _square_doc(page_mm=(152.4, 101.6), square_mm: float = 50.0) -> vp.Document:
    """A document with one closed square ring, in SVG px units.

    vpype stores a line as a flat array of complex numbers (real = x, imag = y),
    so the ring is built that way — passing an (N, 2) float array instead would
    interleave the coordinates and corrupt the shape.
    """
    size_px = square_mm / PX_TO_MM
    doc = vp.Document(page_size=(page_mm[0] / PX_TO_MM, page_mm[1] / PX_TO_MM))
    ring = np.array(
        [0 + 0j, size_px + 0j, size_px + 1j * size_px, 0 + 1j * size_px, 0 + 0j],
        dtype=complex,
    )
    lc = vp.LineCollection()
    lc.append(ring)
    doc.add(lc, 1)
    return doc


@pytest.fixture
def placement():
    return {
        "bed_width_mm": 200.0,
        "bed_height_mm": 140.0,
        "origin_x_mm": 0.0,
        "origin_y_mm": 140.0,
        "flip_y": True,
        "anchor": "page",
    }


def test_page_anchor_keeps_the_card_margin(placement):
    """`anchor=page` pins the page, so the artwork top lands on the bed's Y home."""
    doc = _square_doc()
    eg.place_document(doc, placement)

    xmin, ymin, xmax, ymax = eg.document_bounds(doc)
    # The square starts at the page origin, so its top edge reaches Y=140.
    assert ymax * PX_TO_MM == pytest.approx(140.0, abs=0.01)
    assert xmin * PX_TO_MM == pytest.approx(0.0, abs=0.01)


def test_placement_never_goes_negative_or_past_the_bed(placement):
    """Whatever the anchor, every point ends up inside the usable bed."""
    for square_mm in (20.0, 50.0, 80.0):
        for anchor in ("page", "content"):
            doc = _square_doc(square_mm=square_mm)
            eg.place_document(doc, dict(placement, anchor=anchor))

            xmin, ymin, xmax, ymax = eg.document_bounds(doc)
            assert xmin * PX_TO_MM >= -1e-3, (square_mm, anchor)
            assert xmax * PX_TO_MM <= placement["bed_width_mm"] + 1e-3, (square_mm, anchor)
            assert ymin * PX_TO_MM >= -1e-3, (square_mm, anchor)
            assert ymax * PX_TO_MM <= placement["bed_height_mm"] + 1e-3, (square_mm, anchor)


def test_a_full_size_card_fits_the_bed(placement):
    """A 6x4 inch card must fit the 200x140 bed with margin to spare."""
    doc = _square_doc(page_mm=(152.4, 101.6), square_mm=101.6)
    eg.place_document(doc, placement)

    xmin, ymin, xmax, ymax = eg.document_bounds(doc)
    assert xmax * PX_TO_MM <= 200.0
    assert ymax * PX_TO_MM == pytest.approx(140.0, abs=0.01)
    assert ymin * PX_TO_MM >= 0


def test_document_bounds_agrees_with_vpype():
    """Our explicit envelope must match vpype's, including for closed rings."""
    for square_mm in (50.0, 101.6):
        doc = _square_doc(square_mm=square_mm)
        naive = doc.bounds()
        true = eg.document_bounds(doc)

        assert true is not None
        assert true == pytest.approx(naive)
        # The ring is a real 2-D shape, not a collapsed line.
        assert (true[3] - true[1]) * PX_TO_MM == pytest.approx(square_mm, abs=0.01)


def test_content_anchor_packs_ink_to_the_origin(placement):
    """`anchor=content` discards the margin: the ink's top edge hits the origin."""
    doc = _square_doc()
    eg.place_document(doc, dict(placement, anchor="content"))

    xmin, ymin, xmax, ymax = eg.document_bounds(doc)
    assert ymax * PX_TO_MM == pytest.approx(140.0, abs=0.01)
    assert xmin * PX_TO_MM == pytest.approx(0.0, abs=0.01)


def test_content_anchor_packs_ink_to_the_origin(placement):
    """`anchor=content` discards the margin: the ink's top edge hits the origin."""
    doc = _square_doc()
    eg.place_document(doc, dict(placement, anchor="content"))

    xmin, ymin, xmax, ymax = eg.document_bounds(doc)
    assert ymax * PX_TO_MM == pytest.approx(140.0, abs=0.01)
    assert xmin * PX_TO_MM == pytest.approx(0.0, abs=0.01)


def test_geometry_larger_than_the_bed_is_rejected(placement):
    """A drawing that cannot fit must fail loudly, not silently crash the machine."""
    doc = _square_doc(page_mm=(400, 400), square_mm=400.0)
    with pytest.raises(SystemExit, match="outside bed"):
        eg.place_document(doc, placement)


def test_unknown_anchor_is_rejected(placement):
    doc = _square_doc()
    with pytest.raises(SystemExit, match="unknown placement.anchor"):
        eg.place_document(doc, dict(placement, anchor="nope"))


def test_empty_document_is_rejected(placement):
    doc = vp.Document(page_size=(100, 100))
    with pytest.raises(SystemExit, match="empty document"):
        eg.place_document(doc, placement)


def test_clean_line_drops_short_segments():
    line = np.array([[0.0, 0.0], [0.01, 0.0], [10.0, 0.0]])
    cleaned = eg.clean_line(line, min_seg=0.15)
    assert cleaned is not None
    assert len(cleaned) == 2
    assert cleaned[-1][0] == 10.0


def test_clean_line_handles_vpype_complex_points():
    """vpype stores x/y as real/imag of a complex number, not [x, y] pairs."""
    line = np.array([0 + 0j, 0.01 + 0j, 10 + 0j], dtype=complex)
    cleaned = eg.clean_line(line, min_seg=0.15)
    assert cleaned is not None
    assert len(cleaned) == 2
    assert cleaned[-1].real == 10.0


def test_clean_line_measures_diagonal_distance():
    """Distance must be Euclidean, not axis-aligned, for complex coordinates."""
    # 0.1mm along both axes is 0.1414mm apart, below a 0.15mm threshold.
    diagonal = np.array([0 + 0j, 0.1 + 0.1j, 5 + 5j], dtype=complex)
    cleaned = eg.clean_line(diagonal, min_seg=0.15)
    assert cleaned is not None
    assert len(cleaned) == 2


def test_clean_line_keeps_intentional_two_point_dabs():
    """Park and building dots are 2-point lines shorter than min_seg."""
    dab = np.array([[0.0, 0.0], [0.05, 0.0]])
    assert eg.clean_line(dab, min_seg=0.15) is not None


def test_clean_line_discards_zero_length_dabs():
    zero = np.array([[5.0, 5.0], [5.0, 5.0]])
    assert eg.clean_line(zero, min_seg=0.15) is None
