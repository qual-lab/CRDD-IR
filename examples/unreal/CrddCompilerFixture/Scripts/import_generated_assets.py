"""Run the distributable CRDD-IR Unreal importer in the repository fixture."""

from pathlib import Path
import runpy


runpy.run_path(
    str(
        Path(__file__).resolve().parents[4]
        / "templates"
        / "unreal"
        / "import_generated_assets.py"
    ),
    run_name="__main__",
)
