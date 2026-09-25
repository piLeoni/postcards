"""Emitted G-code must be safe for the machine.

These assertions mirror docs/fluidnc_limits.md: correct preamble, pen only at
Z4/Z0, no coordinate outside the bed, and no duplicate crumbs.
"""

from __future__ import annotations

import re

import pytest

import export_gcode as eg

REQUIRED_PREAMBLE = ["G21", "G90", "G94", "G10 L2 P1 X0 Y0 Z0", "G92.1", "$HZ", "$H"]
XY = re.compile(r"([XY])(-?\d+\.?\d*)")
Z_MOVE = re.compile(r"G0?1?\s*Z(-?\d+\.?\d*)", re.I)


@pytest.fixture
def sample_gcode(tmp_path):
    """A part file assembled the way `assemble_job` writes them."""
    body = [
        "G0 X10.0000 Y130.0000 F8000",
        "G1 Z0 F2000",
        "G1 X20.0000 Y120.0000 F3500",
        "G1 Z4 F2000",
    ]
    raw = tmp_path / "_raw.gcode"
    raw.write_text("\n".join(["G21", "G90", "G94"] + body) + "\n")

    paths = eg.assemble_job(
        raw_paths=[raw],
        job_dir=tmp_path / "job",
        document_start="G21\nG90\nG94\nG10 L2 P1 X0 Y0 Z0\nG92.1\n$HZ\n$H\nG1 Z4 F2000",
        document_end="G1 Z4 F2000\nG10 L2 P1 X0 Y0 Z0\nG92.1\n$HZ\n$H\nG1 Z4 F2000",
        continue_start="G21\nG90\nG94\nG1 Z4 F2000",
        pen_up_line="G1 Z4 F2000",
        pen_up_re=eg._pen_up_re(4),
        max_lines=0,
        chain=False,
    )
    return paths[0]


def test_preamble_matches_the_machine_spec(sample_gcode):
    head = sample_gcode.read_text().splitlines()[: len(REQUIRED_PREAMBLE)]
    assert head == REQUIRED_PREAMBLE


def test_pen_moves_only_between_z0_and_z4(sample_gcode):
    zs = {float(z) for z in Z_MOVE.findall(sample_gcode.read_text())}
    assert zs <= {0.0, 4.0}, f"unexpected pen heights: {zs}"


def test_no_marling_homing(sample_gcode):
    """G28 means "go to park" on FluidNC, not "home the machine"."""
    assert "G28" not in sample_gcode.read_text()


def test_validate_gcode_accepts_an_in_bounds_file(sample_gcode):
    eg.validate_gcode(
        sample_gcode,
        {"bed_width_mm": 200.0, "bed_height_mm": 140.0},
    )


def test_validate_gcode_rejects_out_of_bounds_x(sample_gcode):
    text = sample_gcode.read_text().replace("X20.0000", "X250.0000")
    sample_gcode.write_text(text)
    with pytest.raises(SystemExit, match="X out of bed"):
        eg.validate_gcode(sample_gcode, {"bed_width_mm": 200.0, "bed_height_mm": 140.0})


def test_validate_gcode_rejects_negative_y(sample_gcode):
    text = sample_gcode.read_text().replace("Y120.0000", "Y-5.0000")
    sample_gcode.write_text(text)
    with pytest.raises(SystemExit, match="Y out of bed"):
        eg.validate_gcode(sample_gcode, {"bed_width_mm": 200.0, "bed_height_mm": 140.0})


def test_scrub_removes_duplicate_consecutive_moves(tmp_path):
    path = tmp_path / "dupes.gcode"
    path.write_text(
        "\n".join(
            [
                "G21",
                "G0 X0 Y0 F8000",
                "G1 Z0 F2000",
                "G1 X10 Y0 F3500",
                "G1 X10 Y0 F3500",  # exact duplicate
                "G1 X10.05 Y0 F3500",  # below scrub_min_mm
                "G1 X20 Y0 F3500",
                "G1 Z4 F2000",
            ]
        )
        + "\n"
    )
    eg.scrub_gcode(path, min_mm=0.15)
    text = path.read_text()

    assert text.count("G1 X10 Y0 F3500") == 1
    assert "X10.05" not in text
    assert "G1 X20 Y0 F3500" in text


def test_scrub_keeps_a_dab_after_pen_up(tmp_path):
    """A G0 then G1 pair is an intentional dot and must survive scrubbing."""
    path = tmp_path / "dab.gcode"
    path.write_text(
        "\n".join(
            [
                "G0 X5 Y5 F8000",
                "G1 Z0 F2000",
                "G1 X5.05 Y5 F3500",
                "G1 Z4 F2000",
            ]
        )
        + "\n"
    )
    eg.scrub_gcode(path, min_mm=0.15)
    assert "X5.05" in path.read_text()
