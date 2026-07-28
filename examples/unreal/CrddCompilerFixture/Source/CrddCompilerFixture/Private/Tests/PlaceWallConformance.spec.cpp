#if WITH_DEV_AUTOMATION_TESTS

#include "Generated/PlaceWall.generated.h"

#include "Dom/JsonObject.h"
#include "HAL/FileManager.h"
#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCrddPlaceWallConformanceTest,
    "CRDD.PlaceWall.Conformance",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter
)

namespace
{
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

#endif
