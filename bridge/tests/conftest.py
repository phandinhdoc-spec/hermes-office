import sys
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent.parent
if str(BRIDGE) not in sys.path:
    sys.path.insert(0, str(BRIDGE))
