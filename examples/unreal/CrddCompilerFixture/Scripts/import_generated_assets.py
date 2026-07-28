import os
import json
import unreal


project_dir = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
source_dir = os.path.normpath(os.path.join(project_dir, "../../../generated/assets"))
manifest_path = os.path.join(source_dir, "assets.manifest.json")
if not os.path.isfile(manifest_path):
    raise RuntimeError(f"Generated asset manifest not found: {manifest_path}")

with open(manifest_path, encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)
if manifest.get("protocol") != "crdd-ir/assets-v0.1":
    raise RuntimeError(f"Unsupported generated asset manifest: {manifest.get('protocol')}")

level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
imported_assets = []
asset_definitions = manifest.get("assets", [])
generated_owner_tag = unreal.Name("CRDD_GENERATED")


def tag_generated_actor(actor, asset_id):
    actor.set_editor_property(
        "tags",
        [generated_owner_tag, unreal.Name(f"CRDD_ASSET_{asset_id}")],
    )

for asset_definition in asset_definitions:
    asset_id = asset_definition["id"]
    destination_path = asset_definition["unrealDestination"]
    source_path = os.path.normpath(os.path.join(source_dir, asset_definition["source"]))
    asset_path = f"{destination_path}/{asset_id}"
    level_path = asset_definition["previewLevel"]
    actor_label = f"CRDD_{asset_id}"
    placement = asset_definition["placement"]
    location = placement["locationCm"]
    rotation = placement["rotationDeg"]

    if not os.path.isfile(source_path):
        raise RuntimeError(f"Generated asset source not found: {source_path}")

    task = unreal.AssetImportTask()
    task.filename = source_path
    task.destination_path = destination_path
    task.destination_name = asset_id
    task.automated = True
    task.replace_existing = True
    task.replace_existing_settings = True
    task.save = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])

    if not unreal.EditorAssetLibrary.does_asset_exist(asset_path):
        raise RuntimeError(f"Unreal asset import failed: {asset_path}")
    unreal.EditorAssetLibrary.save_asset(asset_path, only_if_is_dirty=False)

    if unreal.EditorAssetLibrary.does_asset_exist(level_path):
        if not level_subsystem.load_level(level_path):
            raise RuntimeError(f"Failed to load generated level: {level_path}")
    elif not level_subsystem.new_level(level_path, False):
        raise RuntimeError(f"Failed to create generated level: {level_path}")

    # Reconcile generated actors in place. Deleting a loaded map package and
    # immediately recreating the same package name leaves deferred package state.
    for existing_actor in actor_subsystem.get_all_level_actors():
        if existing_actor.get_actor_label() == actor_label:
            if not actor_subsystem.destroy_actor(existing_actor):
                raise RuntimeError(
                    f"Failed to remove previous generated actor: {existing_actor.get_path_name()}"
                )

    mesh = unreal.EditorAssetLibrary.load_asset(asset_path)
    actor = actor_subsystem.spawn_actor_from_object(
        mesh,
        unreal.Vector(location["x"], location["y"], location["z"]),
        unreal.Rotator(rotation["roll"], rotation["pitch"], rotation["yaw"]),
        False,
    )
    if actor is None:
        raise RuntimeError(f"Failed to place generated mesh in level: {asset_path}")
    actor.set_actor_label(actor_label)
    tag_generated_actor(actor, asset_id)
    if not level_subsystem.save_current_level():
        raise RuntimeError(f"Failed to save generated level: {level_path}")

    imported_assets.append(
        {"asset": asset_path, "level": level_path, "actor": actor_label}
    )
    unreal.log(
        f"CRDD generated preview level: {level_path}; "
        f"actor={actor.get_path_name()}; level={actor.get_level().get_path_name()}"
    )

scene_path = manifest["scene"]["unrealLevel"]
if unreal.EditorAssetLibrary.does_asset_exist(scene_path):
    if not level_subsystem.load_level(scene_path):
        raise RuntimeError(f"Failed to load generated scene: {scene_path}")
elif not level_subsystem.new_level(scene_path, False):
    raise RuntimeError(f"Failed to create generated scene: {scene_path}")

generated_labels = {f"CRDD_{asset['id']}" for asset in asset_definitions}
for existing_actor in actor_subsystem.get_all_level_actors():
    is_owned = generated_owner_tag in existing_actor.get_editor_property("tags")
    is_legacy_generated = existing_actor.get_actor_label() in generated_labels
    if is_owned or is_legacy_generated:
        if not actor_subsystem.destroy_actor(existing_actor):
            raise RuntimeError(
                f"Failed to remove previous scene actor: {existing_actor.get_path_name()}"
            )

for asset_definition in asset_definitions:
    asset_id = asset_definition["id"]
    destination_path = asset_definition["unrealDestination"]
    asset_path = f"{destination_path}/{asset_id}"
    placement = asset_definition["placement"]
    location = placement["locationCm"]
    rotation = placement["rotationDeg"]
    actor = actor_subsystem.spawn_actor_from_object(
        unreal.EditorAssetLibrary.load_asset(asset_path),
        unreal.Vector(location["x"], location["y"], location["z"]),
        unreal.Rotator(rotation["roll"], rotation["pitch"], rotation["yaw"]),
        False,
    )
    if actor is None:
        raise RuntimeError(f"Failed to place generated scene mesh: {asset_path}")
    actor.set_actor_label(f"CRDD_{asset_id}")
    tag_generated_actor(actor, asset_id)

if not level_subsystem.save_current_level():
    raise RuntimeError(f"Failed to save generated scene: {scene_path}")
unreal.log(
    f"CRDD generated scene: {scene_path}; actors={len(asset_definitions)}"
)

marker_path = os.environ.get("CRDD_ASSET_IMPORT_MARKER")
if not marker_path:
    raise RuntimeError("CRDD_ASSET_IMPORT_MARKER is not set")

with open(marker_path, "w", encoding="utf-8") as marker:
    json.dump(
        {
            "protocol": "crdd-ir/unreal-asset-import-v0.1",
            "scene": scene_path,
            "assets": imported_assets,
        },
        marker,
        ensure_ascii=False,
        indent=2,
    )
    marker.write("\n")
