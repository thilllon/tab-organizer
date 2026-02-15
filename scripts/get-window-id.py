"""Get Chrome/Chromium window info (macOS only).

Usage:
  python get-window-id.py          # prints window ID
  python get-window-id.py --bounds # prints JSON: {"id", "x", "y", "width", "height"}
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
