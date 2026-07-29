#if WITH_DEV_AUTOMATION_TESTS

#include "Generated/ApplyRecord.generated.h"

#include "Dom/JsonObject.h"
#include "HAL/FileManager.h"
#include "Engine/StaticMesh.h"
#include "Components/StaticMeshComponent.h"
#include "EngineUtils.h"
#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "PhysicsEngine/BodySetup.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Tests/AutomationEditorCommon.h"
#include "Editor.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCrddApplyRecordConformanceTest,
    "CRDD.ApplyRecord.Conformance",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter
)

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCrddGeneratedPreviewLevelsTest,
    "CRDD.Assets.GeneratedPreviewLevels",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter
)

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCrddGeneratedMeshesTest,
    "CRDD.Assets.GeneratedMeshes",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter
)

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCrddGeneratedSceneTest,
    "CRDD.Assets.GeneratedScene",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter
)

namespace
{
struct FCrddAssetExpectation
{
    FString Id;
    FString Destination;
    FString PreviewLevel;
    FVector DimensionsCm;
    FVector LocationCm;
    FRotator RotationDeg;
    FString LodGroup;
};

FString UnrealLodGroup(const FString& Policy)
{
    if (Policy == TEXT("none")) return TEXT("None");
    if (Policy == TEXT("small")) return TEXT("SmallProp");
    if (Policy == TEXT("large")) return TEXT("LargeProp");
    if (Policy == TEXT("architectural")) return TEXT("LevelArchitecture");
    return TEXT("");
}

bool ReadBundle(
    FAutomationTestBase& Test,
    TSharedPtr<FJsonObject>& OutBundle
)
{
    const FString BundlePath = FPaths::ConvertRelativePathToFull(
        FPaths::Combine(
            FPaths::ProjectDir(),
            TEXT("../../../generated/apply-record.conformance.json")
        )
    );

    FString Source;
    if (!FFileHelper::LoadFileToString(Source, *BundlePath))
    {
        Test.AddError(FString::Printf(TEXT("Cannot read conformance bundle: %s"), *BundlePath));
        return false;
    }

    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Source);
    if (!FJsonSerializer::Deserialize(Reader, OutBundle) || !OutBundle.IsValid())
    {
        Test.AddError(FString::Printf(TEXT("Invalid conformance bundle JSON: %s"), *BundlePath));
        return false;
    }

    return true;
}

bool ReadAssetManifest(
    FAutomationTestBase& Test,
    TArray<FCrddAssetExpectation>& OutAssets,
    FString* OutScene = nullptr
)
{
    const FString ManifestPath = FPaths::ConvertRelativePathToFull(
        FPaths::Combine(FPaths::ProjectDir(), TEXT("../../../generated/assets/assets.manifest.json"))
    );
    FString Source;
    if (!FFileHelper::LoadFileToString(Source, *ManifestPath))
    {
        Test.AddError(FString::Printf(TEXT("Cannot read asset manifest: %s"), *ManifestPath));
        return false;
    }

    TSharedPtr<FJsonObject> Manifest;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Source);
    if (!FJsonSerializer::Deserialize(Reader, Manifest) || !Manifest.IsValid())
    {
        Test.AddError(FString::Printf(TEXT("Invalid asset manifest JSON: %s"), *ManifestPath));
        return false;
    }
    if (Manifest->GetStringField(TEXT("protocol")) != TEXT("crdd-ir/assets-v0.2"))
    {
        Test.AddError(TEXT("Unsupported asset manifest protocol"));
        return false;
    }
    if (OutScene)
    {
        *OutScene = FString::Printf(
            TEXT("/Game/CRDD/Generated/%s"),
            *Manifest->GetObjectField(TEXT("scene"))->GetStringField(TEXT("id"))
        );
    }

    for (const TSharedPtr<FJsonValue>& Value : Manifest->GetArrayField(TEXT("assets")))
    {
        const TSharedPtr<FJsonObject> Asset = Value->AsObject();
        const TSharedPtr<FJsonObject> Dimensions = Asset->GetObjectField(TEXT("dimensions"));
        const TSharedPtr<FJsonObject> Placement = Asset->GetObjectField(TEXT("placement"));
        const TSharedPtr<FJsonObject> Location = Placement->GetObjectField(TEXT("location"));
        const TSharedPtr<FJsonObject> Rotation = Placement->GetObjectField(TEXT("rotation"));
        OutAssets.Add({
            Asset->GetStringField(TEXT("id")),
            TEXT("/Game/CRDD/Generated"),
            FString::Printf(
                TEXT("/Game/CRDD/Generated/%s"),
                *Asset->GetStringField(TEXT("previewScene"))
            ),
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
            UnrealLodGroup(
                Asset->GetObjectField(TEXT("lod"))->GetStringField(TEXT("policy"))
            ),
        });
    }
    return Test.TestTrue(TEXT("Asset manifest contains assets"), OutAssets.Num() > 0);
}

FCrddApplyRecordState ReadState(const TSharedPtr<FJsonObject>& StateObject)
{
    FCrddApplyRecordState State;
    State.CapacityRemainingCredit = static_cast<int64>(
        StateObject->GetObjectField(TEXT("capacity"))->GetNumberField(TEXT("remaining"))
    );

    const TArray<TSharedPtr<FJsonValue>>& Records = StateObject->GetArrayField(TEXT("records"));
    for (const TSharedPtr<FJsonValue>& RecordValue : Records)
    {
        const TSharedPtr<FJsonObject> Record = RecordValue->AsObject();
        State.Records.Add(
            {
                Record->GetNumberField(TEXT("length")),
                Record->GetNumberField(TEXT("amount"))
            }
        );
    }
    return State;
}

void CompareState(
    FAutomationTestBase& Test,
    const FString& CaseId,
    const FCrddApplyRecordState& Actual,
    const FCrddApplyRecordState& Expected
)
{
    Test.TestEqual(
        FString::Printf(TEXT("%s capacity"), *CaseId),
        Actual.CapacityRemainingCredit,
        Expected.CapacityRemainingCredit
    );
    Test.TestEqual(
        FString::Printf(TEXT("%s record count"), *CaseId),
        Actual.Records.Num(),
        Expected.Records.Num()
    );

    const int32 Count = FMath::Min(Actual.Records.Num(), Expected.Records.Num());
    for (int32 Index = 0; Index < Count; ++Index)
    {
        Test.TestEqual(
            FString::Printf(TEXT("%s record[%d] length"), *CaseId, Index),
            Actual.Records[Index].LengthUnit,
            Expected.Records[Index].LengthUnit
        );
        Test.TestEqual(
            FString::Printf(TEXT("%s record[%d] amount"), *CaseId, Index),
            Actual.Records[Index].AmountCredit,
            Expected.Records[Index].AmountCredit
        );
    }
}
}

bool FCrddApplyRecordConformanceTest::RunTest(const FString& Parameters)
{
    TSharedPtr<FJsonObject> Bundle;
    if (!ReadBundle(*this, Bundle))
    {
        return false;
    }

    TestEqual(
        TEXT("Protocol"),
        Bundle->GetStringField(TEXT("protocol")),
        FString(TEXT("crdd-ir/conformance-v0.1"))
    );
    TestEqual(
        TEXT("Operation"),
        Bundle->GetStringField(TEXT("operation")),
        FString(TEXT("ApplyRecord"))
    );

    const TArray<TSharedPtr<FJsonValue>>& Cases = Bundle->GetArrayField(TEXT("cases"));
    TestTrue(TEXT("Bundle contains cases"), Cases.Num() > 0);

    for (const TSharedPtr<FJsonValue>& CaseValue : Cases)
    {
        const TSharedPtr<FJsonObject> Case = CaseValue->AsObject();
        const FString CaseId = Case->GetStringField(TEXT("id"));
        const TSharedPtr<FJsonObject> Request = Case->GetObjectField(TEXT("request"));
        const TSharedPtr<FJsonObject> Input = Request->GetObjectField(TEXT("input"));
        const TSharedPtr<FJsonObject> Expected = Case->GetObjectField(TEXT("expected"));

        FCrddApplyRecordInput OperationInput;
        OperationInput.LengthUnit = Input->GetNumberField(TEXT("length"));
        OperationInput.AmountCredit = static_cast<int64>(Input->GetNumberField(TEXT("amount")));
        const FCrddApplyRecordResult Actual = FCrddApplyRecordOperation::Execute(
            OperationInput,
            ReadState(Request->GetObjectField(TEXT("state")))
        );

        TestEqual(
            FString::Printf(TEXT("%s success"), *CaseId),
            Actual.bSucceeded,
            Expected->GetBoolField(TEXT("ok"))
        );
        CompareState(
            *this,
            CaseId,
            Actual.State,
            ReadState(Expected->GetObjectField(TEXT("state")))
        );

        FString ExpectedError;
        Expected->TryGetStringField(TEXT("error"), ExpectedError);
        TestEqual(
            FString::Printf(TEXT("%s error"), *CaseId),
            FCrddApplyRecordOperation::ErrorCode(Actual.Error),
            ExpectedError
        );

        const TArray<TSharedPtr<FJsonValue>>& ExpectedTraces = Expected->GetArrayField(TEXT("traces"));
        for (const TSharedPtr<FJsonValue>& Trace : ExpectedTraces)
        {
            TestTrue(
                FString::Printf(TEXT("%s trace %s"), *CaseId, *Trace->AsString()),
                Actual.Traces.Contains(Trace->AsString())
            );
        }
    }

    return true;
}

bool FCrddGeneratedMeshesTest::RunTest(const FString& Parameters)
{
    TArray<FCrddAssetExpectation> Assets;
    if (!ReadAssetManifest(*this, Assets))
    {
        return false;
    }

    for (const FCrddAssetExpectation& Asset : Assets)
    {
        const FString ObjectPath = FString::Printf(
            TEXT("%s/%s.%s"), *Asset.Destination, *Asset.Id, *Asset.Id
        );
        const UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, *ObjectPath);
        if (!TestNotNull(*FString::Printf(TEXT("%s StaticMesh exists"), *Asset.Id), Mesh))
        {
            continue;
        }

        const FVector Size = Mesh->GetBoundingBox().GetSize();
        TestTrue(
            *FString::Printf(TEXT("%s dimensions match manifest"), *Asset.Id),
            Size.Equals(Asset.DimensionsCm, 0.1)
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
    return true;
}

bool FCrddGeneratedPreviewLevelsTest::RunTest(const FString& Parameters)
{
    TArray<FCrddAssetExpectation> Assets;
    if (!ReadAssetManifest(*this, Assets))
    {
        return false;
    }

    for (const FCrddAssetExpectation& Asset : Assets)
    {
        FAutomationEditorCommonUtils::LoadMap(Asset.PreviewLevel);
        UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
        if (!TestNotNull(*FString::Printf(TEXT("%s level loads"), *Asset.Id), World))
        {
            continue;
        }

        const FString ExpectedLabel = FString::Printf(TEXT("CRDD_%s"), *Asset.Id);
        const FString ExpectedMesh = FString::Printf(
            TEXT("%s/%s.%s"), *Asset.Destination, *Asset.Id, *Asset.Id
        );
        bool bFoundPlacedAsset = false;
        for (TActorIterator<AActor> It(World); It; ++It)
        {
            const AActor* Actor = *It;
            if (!Actor || Actor->GetActorLabel() != ExpectedLabel)
            {
                continue;
            }

            const UStaticMeshComponent* Component =
                Actor->FindComponentByClass<UStaticMeshComponent>();
            const UStaticMesh* Mesh = Component ? Component->GetStaticMesh() : nullptr;
            bFoundPlacedAsset = true;
            TestTrue(
                *FString::Printf(TEXT("%s actor references generated mesh"), *Asset.Id),
                Mesh && Mesh->GetPathName() == ExpectedMesh
            );
            TestTrue(
                *FString::Printf(TEXT("%s actor location matches manifest"), *Asset.Id),
                Actor->GetActorLocation().Equals(Asset.LocationCm, 0.01)
            );
            TestTrue(
                *FString::Printf(TEXT("%s actor rotation matches manifest"), *Asset.Id),
                Actor->GetActorRotation().Equals(Asset.RotationDeg, 0.01)
            );
            TestTrue(
                *FString::Printf(TEXT("%s actor has generated owner tag"), *Asset.Id),
                Actor->Tags.Contains(FName(TEXT("CRDD_GENERATED")))
            );
            break;
        }
        TestTrue(
            *FString::Printf(TEXT("%s level contains generated actor"), *Asset.Id),
            bFoundPlacedAsset
        );
    }
    return true;
}

bool FCrddGeneratedSceneTest::RunTest(const FString& Parameters)
{
    TArray<FCrddAssetExpectation> Assets;
    FString ScenePath;
    if (!ReadAssetManifest(*this, Assets, &ScenePath))
    {
        return false;
    }

    FAutomationEditorCommonUtils::LoadMap(ScenePath);
    UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
    if (!TestNotNull(TEXT("Generated scene loads"), World))
    {
        return false;
    }

    int32 GeneratedActorCount = 0;
    for (TActorIterator<AActor> It(World); It; ++It)
    {
        const AActor* Actor = *It;
        if (Actor && Actor->Tags.Contains(FName(TEXT("CRDD_GENERATED"))))
        {
            ++GeneratedActorCount;
        }
    }
    TestEqual(
        TEXT("Scene contains exactly the manifest-owned actors"),
        GeneratedActorCount,
        Assets.Num()
    );

    for (const FCrddAssetExpectation& Asset : Assets)
    {
        const FString ExpectedLabel = FString::Printf(TEXT("CRDD_%s"), *Asset.Id);
        bool bFoundActor = false;
        for (TActorIterator<AActor> It(World); It; ++It)
        {
            const AActor* Actor = *It;
            if (!Actor || Actor->GetActorLabel() != ExpectedLabel)
            {
                continue;
            }
            bFoundActor = true;
            TestTrue(
                *FString::Printf(TEXT("%s scene location matches manifest"), *Asset.Id),
                Actor->GetActorLocation().Equals(Asset.LocationCm, 0.01)
            );
            TestTrue(
                *FString::Printf(TEXT("%s scene rotation matches manifest"), *Asset.Id),
                Actor->GetActorRotation().Equals(Asset.RotationDeg, 0.01)
            );
            TestTrue(
                *FString::Printf(TEXT("%s scene actor has generated owner tag"), *Asset.Id),
                Actor->Tags.Contains(FName(TEXT("CRDD_GENERATED")))
            );
            break;
        }
        TestTrue(
            *FString::Printf(TEXT("Scene contains %s"), *Asset.Id),
            bFoundActor
        );
    }
    return true;
}

#endif
