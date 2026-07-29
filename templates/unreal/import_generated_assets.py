import os
import json
import unreal


project_dir = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
default_manifest_path = os.path.normpath(
    os.path.join(project_dir, "../../../generated/assets/assets.manifest.json")
)
manifest_path = os.environ.get("CRDD_ASSET_MANIFEST", default_manifest_path)
source_dir = os.path.dirname(manifest_path)
if not os.path.isfile(manifest_path):
    raise RuntimeError(f"Generated asset manifest not found: {manifest_path}")

with open(manifest_path, encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)
if manifest.get("protocol") != "crdd-ir/assets-v0.2":
    raise RuntimeError(f"Unsupported generated asset manifest: {manifest.get('protocol')}")
if manifest.get("units") != {"distance": "cm", "angle": "deg"}:
    raise RuntimeError(f"Unsupported generated asset units: {manifest.get('units')}")

level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
static_mesh_subsystem = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
imported_assets = []
asset_definitions = manifest.get("assets", [])
generated_owner_tag = unreal.Name("CRDD_GENERATED")
destination_path = "/Game/CRDD/Generated"


def scene_path(scene_id):
    return f"{destination_path}/{scene_id}"

previous_manifest_path = os.environ.get("CRDD_PREVIOUS_ASSET_MANIFEST")
if previous_manifest_path and os.path.isfile(previous_manifest_path):
    with open(previous_manifest_path, encoding="utf-8") as previous_file:
        previous_manifest = json.load(previous_file)
    current_ids = {asset["id"] for asset in asset_definitions}
    removed_assets = [
        asset
        for asset in previous_manifest.get("assets", [])
        if asset["id"] not in current_ids
    ]
    previous_scene_id = previous_manifest.get("scene", {}).get("id")
    current_scene_id = manifest.get("scene", {}).get("id")
    previous_scene = scene_path(previous_scene_id) if previous_scene_id else None
    current_scene = scene_path(current_scene_id) if current_scene_id else None
    stale_paths = []
    for removed in removed_assets:
        stale_paths.extend(
            [
                scene_path(removed["previewScene"]),
                f'{destination_path}/{removed["id"]}',
                f'{destination_path}/{removed["id"]}Material',
            ]
        )
    if previous_scene and previous_scene != current_scene:
        stale_paths.append(previous_scene)

    if stale_paths:
        unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
        for stale_path in stale_paths:
            if unreal.EditorAssetLibrary.does_asset_exist(stale_path):
                if not unreal.EditorAssetLibrary.delete_asset(stale_path):
                    raise RuntimeError(f"Failed to delete stale Unreal asset: {stale_path}")
                unreal.log(f"CRDD removed stale Unreal asset: {stale_path}")


def tag_generated_actor(actor, asset_id):
    actor.set_editor_property(
        "tags",
        [generated_owner_tag, unreal.Name(f"CRDD_ASSET_{asset_id}")],
    )


collision_shapes = {
    "box": unreal.ScriptCollisionShapeType.BOX,
    "capsule": unreal.ScriptCollisionShapeType.CAPSULE,
    "sphere": unreal.ScriptCollisionShapeType.SPHERE,
    "ndop26": unreal.ScriptCollisionShapeType.NDOP26,
}

for asset_definition in asset_definitions:
    asset_id = asset_definition["id"]
    source_path = os.path.normpath(os.path.join(source_dir, asset_definition["source"]))
    asset_path = f"{destination_path}/{asset_id}"
    level_path = scene_path(asset_definition["previewScene"])
    actor_label = f"CRDD_{asset_id}"
    placement = asset_definition["placement"]
    location = placement["location"]
    rotation = placement["rotation"]

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
    mesh = unreal.EditorAssetLibrary.load_asset(asset_path)
    collision_shape = asset_definition["collision"]["shape"]
    if collision_shape not in collision_shapes:
        raise RuntimeError(f"Unsupported collision shape: {collision_shape}")
    if not static_mesh_subsystem.remove_collisions(mesh):
        raise RuntimeError(f"Failed to reset collision for {asset_path}")
    collision_index = static_mesh_subsystem.add_simple_collisions(
        mesh, collision_shapes[collision_shape]
    )
    if collision_index < 0:
        raise RuntimeError(f"Failed to add {collision_shape} collision to {asset_path}")

    lod_group = asset_definition["lod"]["group"]
    if not static_mesh_subsystem.set_lod_group(mesh, unreal.Name(lod_group), True):
        raise RuntimeError(f"Failed to set LOD group {lod_group} on {asset_path}")
    unreal.EditorAssetLibrary.save_asset(asset_path, only_if_is_dirty=False)

    # Automation runs in a separate Editor process and proves package reload.
    collision_count = static_mesh_subsystem.get_simple_collision_count(mesh)
    persisted_lod_group = str(static_mesh_subsystem.get_lod_group(mesh))
    if collision_count < 1:
        raise RuntimeError(f"Collision did not persist after reload: {asset_path}")
    if persisted_lod_group != lod_group:
        raise RuntimeError(
            f"LOD group did not persist after reload: {asset_path}; "
            f"expected={lod_group}, actual={persisted_lod_group}"
        )

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
        {
            "asset": asset_path,
            "level": level_path,
            "actor": actor_label,
            "collisionShape": collision_shape,
            "simpleCollisionCount": collision_count,
            "lodGroup": persisted_lod_group,
        }
    )
    unreal.log(
        f"CRDD generated preview level: {level_path}; "
        f"actor={actor.get_path_name()}; level={actor.get_level().get_path_name()}"
    )

generated_scene_path = scene_path(manifest["scene"]["id"])
if unreal.EditorAssetLibrary.does_asset_exist(generated_scene_path):
    if not level_subsystem.load_level(generated_scene_path):
        raise RuntimeError(f"Failed to load generated scene: {generated_scene_path}")
elif not level_subsystem.new_level(generated_scene_path, False):
    raise RuntimeError(f"Failed to create generated scene: {generated_scene_path}")

for existing_actor in actor_subsystem.get_all_level_actors():
    is_owned = generated_owner_tag in existing_actor.get_editor_property("tags")
    if is_owned:
        if not actor_subsystem.destroy_actor(existing_actor):
            raise RuntimeError(
                f"Failed to remove previous scene actor: {existing_actor.get_path_name()}"
            )

for asset_definition in asset_definitions:
    asset_id = asset_definition["id"]
    asset_path = f"{destination_path}/{asset_id}"
    placement = asset_definition["placement"]
    location = placement["location"]
    rotation = placement["rotation"]
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
    raise RuntimeError(f"Failed to save generated scene: {generated_scene_path}")
unreal.log(
    f"CRDD generated scene: {generated_scene_path}; actors={len(asset_definitions)}"
)

marker_path = os.environ.get("CRDD_ASSET_IMPORT_MARKER")
if not marker_path:
    raise RuntimeError("CRDD_ASSET_IMPORT_MARKER is not set")

with open(marker_path, "w", encoding="utf-8") as marker:
    json.dump(
        {
            "protocol": "crdd-ir/unreal-asset-import-v0.1",
            "scene": generated_scene_path,
            "assets": imported_assets,
        },
        marker,
        ensure_ascii=False,
        indent=2,
    )
    marker.write("\n")
