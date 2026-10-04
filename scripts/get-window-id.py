# /// script
# requires-python = ">=3.13"
# dependencies = [
#   "pyobjc-framework-Quartz>=12.0",
# ]
# ///
"""Get Chrome/Chromium window info (macOS only).

The block above is the whole Python setup for this repo: `uv run --script` reads it, builds a
cached environment with that dependency and runs the file. There is no pyproject.toml; the
versions are pinned by get-window-id.py.lock next to this file (`uv lock --script` refreshes it).

Usage:
  uv run --script get-window-id.py          # prints window ID
  uv run --script get-window-id.py --bounds # prints JSON: {"id", "x", "y", "width", "height"}
"""

import json
import sys

import Quartz


def main():
    windows = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID
    )

    for w in windows:
        name = w.get("kCGWindowOwnerName", "")
        layer = w.get("kCGWindowLayer", 999)
        if layer == 0 and ("Chrome" in str(name) or "Chromium" in str(name)):
            wid = int(w["kCGWindowNumber"])
            if "--bounds" in sys.argv:
                bounds = w.get("kCGWindowBounds", {})
                print(
                    json.dumps(
                        {
                            "id": wid,
                            "x": int(bounds.get("X", 0)),
                            "y": int(bounds.get("Y", 0)),
                            "width": int(bounds.get("Width", 0)),
                            "height": int(bounds.get("Height", 0)),
                        }
                    )
                )
            else:
                print(wid)
            sys.exit(0)

    print("Window not found", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
