#if WITH_DEV_AUTOMATION_TESTS

#include "Components/StaticMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Editor.h"
#include "Engine/StaticMesh.h"
#include "EngineUtils.h"
#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "PhysicsEngine/BodySetup.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Tests/AutomationEditorCommon.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCrddInstalledAssetTest,
    "CRDD.Integration.GeneratedAssets",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter
)

namespace
{
struct FAssetExpectation
{
    FString Id;
    FString Destination;
    FVector DimensionsCm;
    FVector LocationCm;
    FRotator RotationDeg;
    FString LodGroup;
};

bool ReadManifest(
    FAutomationTestBase& Test,
    FString& OutScene,
    TArray<FAssetExpectation>& OutAssets
)
{
    const FString Path = FPaths::Combine(
        FPaths::ProjectSavedDir(), TEXT("CRDDIR/assets.manifest.json")
    );
    FString Source;
    if (!FFileHelper::LoadFileToString(Source, *Path))
    {
        Test.AddError(FString::Printf(TEXT("Cannot read CRDD asset manifest: %s"), *Path));
        return false;
    }

    TSharedPtr<FJsonObject> Root;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Source);
    if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
    {
        Test.AddError(TEXT("Invalid CRDD asset manifest JSON"));
        return false;
    }
    if (Root->GetStringField(TEXT("protocol")) != TEXT("crdd-ir/assets-v0.2"))
    {
        Test.AddError(TEXT("Unsupported CRDD asset manifest protocol"));
        return false;
    }

    OutScene = FString::Printf(
        TEXT("/Game/CRDD/Generated/%s"),
        *Root->GetObjectField(TEXT("scene"))->GetStringField(TEXT("id"))
    );
    for (const TSharedPtr<FJsonValue>& Value : Root->GetArrayField(TEXT("assets")))
    {
        const TSharedPtr<FJsonObject> Asset = Value->AsObject();
        const TSharedPtr<FJsonObject> Dimensions = Asset->GetObjectField(TEXT("dimensions"));
        const TSharedPtr<FJsonObject> Placement = Asset->GetObjectField(TEXT("placement"));
        const TSharedPtr<FJsonObject> Location = Placement->GetObjectField(TEXT("location"));
        const TSharedPtr<FJsonObject> Rotation = Placement->GetObjectField(TEXT("rotation"));
        OutAssets.Add({
            Asset->GetStringField(TEXT("id")),
            TEXT("/Game/CRDD/Generated"),
            FVector(
                Dimensions->GetNumberField(TEXT("length")),
                Dimensions->GetNumberField(TEXT("width")),
                Dimensions->GetNumberField(TEXT("height"))
            ),
            FVector(
                Location->GetNumberField(TEXT("x")),
                Location->GetNumberField(TEXT("y")),
                Location->GetNumberField(TEXT("z"))
            ),
            FRotator(
                Rotation->GetNumberField(TEXT("pitch")),
                Rotation->GetNumberField(TEXT("yaw")),
                Rotation->GetNumberField(TEXT("roll"))
            ),
            Asset->GetObjectField(TEXT("lod"))->GetStringField(TEXT("group"))
        });
    }
    return Test.TestTrue(TEXT("Manifest declares assets"), OutAssets.Num() > 0);
}
}

bool FCrddInstalledAssetTest::RunTest(const FString& Parameters)
{
    FString ScenePath;
    TArray<FAssetExpectation> Assets;
    if (!ReadManifest(*this, ScenePath, Assets))
    {
        return false;
    }

    for (const FAssetExpectation& Asset : Assets)
    {
        const FString MeshPath = FString::Printf(
            TEXT("%s/%s.%s"), *Asset.Destination, *Asset.Id, *Asset.Id
        );
        const UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, *MeshPath);
        if (TestNotNull(*FString::Printf(TEXT("%s mesh exists"), *Asset.Id), Mesh))
        {
            TestTrue(
                *FString::Printf(TEXT("%s dimensions match"), *Asset.Id),
                Mesh->GetBoundingBox().GetSize().Equals(Asset.DimensionsCm, 0.1)
            );
            const UBodySetup* BodySetup = Mesh->GetBodySetup();
            TestTrue(
                *FString::Printf(TEXT("%s collision persisted"), *Asset.Id),
                BodySetup && BodySetup->AggGeom.GetElementCount() > 0
            );
            TestEqual(
                *FString::Printf(TEXT("%s LOD group persisted"), *Asset.Id),
                Mesh->GetLODGroup(),
                FName(*Asset.LodGroup)
            );
        }
    }

    FAutomationEditorCommonUtils::LoadMap(ScenePath);
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (!TestNotNull(TEXT("Generated CRDD scene loads"), World))
    {
        return false;
    }

    int32 OwnedCount = 0;
    for (TActorIterator<AActor> It(World); It; ++It)
    {
        if (It->Tags.Contains(FName(TEXT("CRDD_GENERATED"))))
        {
            ++OwnedCount;
        }
    }
    TestEqual(TEXT("Generated actor count"), OwnedCount, Assets.Num());

    for (const FAssetExpectation& Asset : Assets)
    {
        const FString Label = FString::Printf(TEXT("CRDD_%s"), *Asset.Id);
        bool bFound = false;
        for (TActorIterator<AActor> It(World); It; ++It)
        {
            if (It->GetActorLabel() != Label)
            {
                continue;
            }
            bFound = true;
            TestTrue(
                *FString::Printf(TEXT("%s location matches"), *Asset.Id),
                It->GetActorLocation().Equals(Asset.LocationCm, 0.01)
            );
            TestTrue(
                *FString::Printf(TEXT("%s rotation matches"), *Asset.Id),
                It->GetActorRotation().Equals(Asset.RotationDeg, 0.01)
            );
            break;
        }
        TestTrue(*FString::Printf(TEXT("Scene contains %s"), *Asset.Id), bFound);
    }
    return true;
}

#endif
