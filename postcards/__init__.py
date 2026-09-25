"""Postcard generation pipeline.

Three stages, each usable on its own:

``make_map``
    OpenStreetMap data -> a layered ``map.svg``. This is the project's own work.
``optimize``
    ``map.svg`` -> ``opt.svg``, using vpype pipelines declared in the config.
``export_gcode``
    ``opt.svg`` -> ``part_*.gcode``, via vpype-gcode plus FluidNC-specific
    part splitting and chaining.

The division of responsibility is deliberate: this package decides *what* is
drawn, vpype decides how paths are cleaned up, and vpype-gcode emits machine
code. See ``docs/pipeline.md``.
"""

__version__ = "1.0.0"
