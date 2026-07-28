import os
import unreal


project_dir = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
source_path = os.path.normpath(
    os.path.join(project_dir, "../../../generated/assets/WallPreview.generated.obj")
)
destination_path = "/Game/CRDD/Generated"
asset_path = f"{destination_path}/WallPreview"

if not os.path.isfile(source_path):
    raise RuntimeError(f"Generated asset source not found: {source_path}")

task = unreal.AssetImportTask()
task.filename = source_path
task.destination_path = destination_path
task.destination_name = "WallPreview"
task.automated = True
task.replace_existing = True
task.replace_existing_settings = True
task.save = True

unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])

if not unreal.EditorAssetLibrary.does_asset_exist(asset_path):
    raise RuntimeError(f"Unreal asset import failed: {asset_path}")

unreal.EditorAssetLibrary.save_asset(asset_path, only_if_is_dirty=False)
unreal.log(f"CRDD imported generated asset: {asset_path}")
