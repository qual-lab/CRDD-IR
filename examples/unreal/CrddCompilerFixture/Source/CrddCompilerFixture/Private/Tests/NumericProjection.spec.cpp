#if WITH_DEV_AUTOMATION_TESTS

#include "Generated/CreateWall.generated.h"

#include "Misc/AutomationTest.h"
#include <limits>

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCrddNumericProjectionTest,
    "CRDD.NumericProjection.CheckedArithmeticAndSerialization",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter
)

bool FCrddNumericProjectionTest::RunTest(const FString& Parameters)
{
    FCrddCreateWallInput Input;
    Input.WallId = TEXT("wall-overflow");
    Input.Length = std::numeric_limits<int64>::max();
    Input.Height = 300;
    Input.Thickness = 10;
    Input.OpeningOffset = std::numeric_limits<int64>::max();
    Input.OpeningWidth = 1;

    const FCrddCreateWallResult Overflow =
        FCrddCreateWallOperation::Execute(Input, FCrddCreateWallState{});
    TestFalse(TEXT("Overflow must not satisfy the width requirement"), Overflow.bSucceeded);
    TestEqual(
        TEXT("Overflow maps to the requirement error"),
        FCrddCreateWallOperation::ErrorCode(Overflow.Error),
        FString(TEXT("OPENING_TOO_WIDE"))
    );
    TestEqual(
        TEXT("Overflow identifies its requirement"),
        Overflow.FailedRequirement,
        FString(TEXT("opening-fits-width"))
    );

    int64 Parsed = 0;
    TestTrue(
        TEXT("Maximum int64 decimal string parses"),
        FCrddCreateWallOperation::TryParseProjectedInt64(
            TEXT("9223372036854775807"),
            Parsed
        )
    );
    TestEqual(TEXT("Maximum int64 is preserved"), Parsed, std::numeric_limits<int64>::max());
    TestEqual(
        TEXT("Maximum int64 round trips as a decimal string"),
        FCrddCreateWallOperation::SerializeProjectedInt64(Parsed),
        FString(TEXT("9223372036854775807"))
    );
    TestFalse(
        TEXT("Overflowing decimal string is rejected"),
        FCrddCreateWallOperation::TryParseProjectedInt64(
            TEXT("9223372036854775808"),
            Parsed
        )
    );
    TestFalse(
        TEXT("Lossy decimal value is rejected"),
        FCrddCreateWallOperation::TryParseProjectedInt64(TEXT("1.5"), Parsed)
    );
    TestFalse(
        TEXT("Whitespace is rejected for canonical serialization"),
        FCrddCreateWallOperation::TryParseProjectedInt64(TEXT(" 1"), Parsed)
    );
    return true;
}

#endif
