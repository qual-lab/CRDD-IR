#include "PlaceWallDomain.h"

namespace
{
FCrddPlaceWallResult Failure(
    ECrddPlaceWallError Error,
    const TCHAR* FailedRequirement,
    const FCrddPlaceWallState& InitialState,
    const TCHAR* Trace
)
{
    FCrddPlaceWallResult Result;
    Result.Error = Error;
    Result.FailedRequirement = FailedRequirement;
    Result.State = InitialState;
    Result.Traces.Add(Trace);
    return Result;
}
}

FCrddPlaceWallResult FCrddPlaceWallOperation::Execute(
    double LengthMeters,
    int64 CostJPY,
    const FCrddPlaceWallState& InitialState
)
{
    if (LengthMeters < 0.3)
    {
        return Failure(
            ECrddPlaceWallError::WallTooShort,
            TEXT("minimum-wall-length"),
            InitialState,
            TEXT("REQ-WALL-001")
        );
    }

    if (InitialState.BudgetRemainingJPY < CostJPY)
    {
        return Failure(
            ECrddPlaceWallError::InsufficientBudget,
            TEXT("sufficient-budget"),
            InitialState,
            TEXT("DEC-WALL-003")
        );
    }

    FCrddPlaceWallResult Result;
    Result.bSucceeded = true;
    Result.State = InitialState;
    Result.State.Walls.Add({LengthMeters, CostJPY});
    Result.State.BudgetRemainingJPY -= CostJPY;
    Result.Traces = {TEXT("REQ-WALL-001"), TEXT("DEC-WALL-003")};
    return Result;
}

FString FCrddPlaceWallOperation::ErrorCode(ECrddPlaceWallError Error)
{
    switch (Error)
    {
    case ECrddPlaceWallError::None:
        return TEXT("");
    case ECrddPlaceWallError::WallTooShort:
        return TEXT("WALL_TOO_SHORT");
    case ECrddPlaceWallError::InsufficientBudget:
        return TEXT("INSUFFICIENT_BUDGET");
    default:
        return TEXT("UNKNOWN");
    }
}
