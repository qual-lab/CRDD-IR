import os
import json
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

level_path = f"{destination_path}/WallPreviewLevel"
level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

if unreal.EditorAssetLibrary.does_asset_exist(level_path):
    if not level_subsystem.load_level(level_path):
        raise RuntimeError(f"Failed to load generated level: {level_path}")
else:
    if not level_subsystem.new_level(level_path, False):
        raise RuntimeError(f"Failed to create generated level: {level_path}")

# Reconcile the generated actor in place. Deleting a loaded map package and
# immediately recreating the same package name is not reliable in one editor
# process because package cleanup is deferred.
for existing_actor in actor_subsystem.get_all_level_actors():
    if existing_actor.get_actor_label() == "CRDD_WallPreview":
        if not actor_subsystem.destroy_actor(existing_actor):
            raise RuntimeError(
                f"Failed to remove previous generated actor: {existing_actor.get_path_name()}"
            )

mesh = unreal.EditorAssetLibrary.load_asset(asset_path)
actor = actor_subsystem.spawn_actor_from_object(
    mesh, unreal.Vector(0.0, 0.0, 0.0), unreal.Rotator(), False
)
if actor is None:
    raise RuntimeError(f"Failed to place generated mesh in level: {asset_path}")

actor.set_actor_label("CRDD_WallPreview")
if not level_subsystem.save_current_level():
    raise RuntimeError(f"Failed to save generated level: {level_path}")

unreal.log(
    f"CRDD generated preview level: {level_path}; "
    f"actor={actor.get_path_name()}; level={actor.get_level().get_path_name()}"
)

marker_path = os.environ.get("CRDD_ASSET_IMPORT_MARKER")
if not marker_path:
    raise RuntimeError("CRDD_ASSET_IMPORT_MARKER is not set")

with open(marker_path, "w", encoding="utf-8") as marker:
    json.dump(
        {
            "asset": asset_path,
            "level": level_path,
            "actor": actor.get_actor_label(),
        },
        marker,
        ensure_ascii=False,
        indent=2,
    )
    marker.write("\n")
