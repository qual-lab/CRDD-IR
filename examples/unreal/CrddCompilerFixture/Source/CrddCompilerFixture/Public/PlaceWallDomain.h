#pragma once

#include "CoreMinimal.h"

struct FCrddPlacedWall
{
    double LengthMeters = 0.0;
    int64 CostJPY = 0;
};

struct FCrddPlaceWallState
{
    int64 BudgetRemainingJPY = 0;
    TArray<FCrddPlacedWall> Walls;
};

enum class ECrddPlaceWallError : uint8
{
    None,
    WallTooShort,
    InsufficientBudget
};

struct FCrddPlaceWallResult
{
    bool bSucceeded = false;
    ECrddPlaceWallError Error = ECrddPlaceWallError::None;
    FString FailedRequirement;
    FCrddPlaceWallState State;
    TArray<FString> Traces;
};

class CRDDCOMPILERFIXTURE_API FCrddPlaceWallOperation
{
public:
    static FCrddPlaceWallResult Execute(
        double LengthMeters,
        int64 CostJPY,
        const FCrddPlaceWallState& InitialState
    );

    static FString ErrorCode(ECrddPlaceWallError Error);
};
