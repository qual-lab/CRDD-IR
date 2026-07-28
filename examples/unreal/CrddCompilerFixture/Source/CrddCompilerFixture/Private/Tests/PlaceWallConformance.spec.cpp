#if WITH_DEV_AUTOMATION_TESTS

#include "Generated/PlaceWall.generated.h"

#include "Dom/JsonObject.h"
#include "HAL/FileManager.h"
#include "Engine/StaticMesh.h"
#include "Components/StaticMeshComponent.h"
#include "EngineUtils.h"
#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Tests/AutomationEditorCommon.h"
#include "Editor.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCrddPlaceWallConformanceTest,
    "CRDD.PlaceWall.Conformance",
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

namespace
{
struct FCrddAssetExpectation
{
    FString Id;
    FString Destination;
    FString PreviewLevel;
    FVector DimensionsCm;
};

bool ReadBundle(
    FAutomationTestBase& Test,
    TSharedPtr<FJsonObject>& OutBundle
)
{
    const FString BundlePath = FPaths::ConvertRelativePathToFull(
        FPaths::Combine(
            FPaths::ProjectDir(),
            TEXT("../../../generated/place-wall.conformance.json")
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
    TArray<FCrddAssetExpectation>& OutAssets
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
    if (Manifest->GetStringField(TEXT("protocol")) != TEXT("crdd-ir/assets-v0.1"))
    {
        Test.AddError(TEXT("Unsupported asset manifest protocol"));
        return false;
    }

    for (const TSharedPtr<FJsonValue>& Value : Manifest->GetArrayField(TEXT("assets")))
    {
        const TSharedPtr<FJsonObject> Asset = Value->AsObject();
        const TSharedPtr<FJsonObject> Dimensions = Asset->GetObjectField(TEXT("dimensionsCm"));
        OutAssets.Add({
            Asset->GetStringField(TEXT("id")),
            Asset->GetStringField(TEXT("unrealDestination")),
            Asset->GetStringField(TEXT("previewLevel")),
            FVector(
                Dimensions->GetNumberField(TEXT("length")),
                Dimensions->GetNumberField(TEXT("width")),
                Dimensions->GetNumberField(TEXT("height"))
            )
        });
    }
    return Test.TestTrue(TEXT("Asset manifest contains assets"), OutAssets.Num() > 0);
}

FCrddPlaceWallState ReadState(const TSharedPtr<FJsonObject>& StateObject)
{
    FCrddPlaceWallState State;
    State.BudgetRemainingJPY = static_cast<int64>(
        StateObject->GetObjectField(TEXT("budget"))->GetNumberField(TEXT("remaining"))
    );

    const TArray<TSharedPtr<FJsonValue>>& Walls = StateObject->GetArrayField(TEXT("walls"));
    for (const TSharedPtr<FJsonValue>& WallValue : Walls)
    {
        const TSharedPtr<FJsonObject> Wall = WallValue->AsObject();
        State.Walls.Add(
            {
                Wall->GetNumberField(TEXT("length")),
                static_cast<int64>(Wall->GetNumberField(TEXT("cost")))
            }
        );
    }
    return State;
}

void CompareState(
    FAutomationTestBase& Test,
    const FString& CaseId,
    const FCrddPlaceWallState& Actual,
    const FCrddPlaceWallState& Expected
)
{
    Test.TestEqual(
        FString::Printf(TEXT("%s budget"), *CaseId),
        Actual.BudgetRemainingJPY,
        Expected.BudgetRemainingJPY
    );
    Test.TestEqual(
        FString::Printf(TEXT("%s wall count"), *CaseId),
        Actual.Walls.Num(),
        Expected.Walls.Num()
    );

    const int32 Count = FMath::Min(Actual.Walls.Num(), Expected.Walls.Num());
    for (int32 Index = 0; Index < Count; ++Index)
    {
        Test.TestEqual(
            FString::Printf(TEXT("%s wall[%d] length"), *CaseId, Index),
            Actual.Walls[Index].LengthMeters,
            Expected.Walls[Index].LengthMeters
        );
        Test.TestEqual(
            FString::Printf(TEXT("%s wall[%d] cost"), *CaseId, Index),
            Actual.Walls[Index].CostJPY,
            Expected.Walls[Index].CostJPY
        );
    }
}
}

bool FCrddPlaceWallConformanceTest::RunTest(const FString& Parameters)
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
        FString(TEXT("PlaceWall"))
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

        FCrddPlaceWallInput OperationInput;
        OperationInput.LengthMeters = Input->GetNumberField(TEXT("length"));
        OperationInput.CostJPY = static_cast<int64>(Input->GetNumberField(TEXT("cost")));
        const FCrddPlaceWallResult Actual = FCrddPlaceWallOperation::Execute(
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
            FCrddPlaceWallOperation::ErrorCode(Actual.Error),
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
                *FString::Printf(TEXT("%s actor is at the origin"), *Asset.Id),
                Actor->GetActorLocation().Equals(FVector::ZeroVector, 0.01)
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

#endif
