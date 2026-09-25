"""Allow ``python -m postcards``."""

from postcards.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
