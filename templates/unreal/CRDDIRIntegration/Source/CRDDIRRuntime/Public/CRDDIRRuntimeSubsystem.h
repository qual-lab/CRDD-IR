#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "CRDDIRAsync.h"
#include "CRDDIRRuntimeSubsystem.generated.h"

DECLARE_MULTICAST_DELEGATE_OneParam(FCRDDIRApplied, uint64);

/**
 * Game-instance lifetime boundary for asynchronous CRDD operations.
 * Registered work is cancelled when the game instance shuts down.
 */
UCLASS()
class CRDDIRRUNTIME_API UCRDDIRRuntimeSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    virtual void Deinitialize() override;

    FCRDDIRAsyncHandle RunAsync(
        TUniqueFunction<void()> Work,
        TUniqueFunction<void()> ApplyOnGameThread
    );

    UFUNCTION(BlueprintPure, Category = "CRDD")
    bool IsRuntimeReady() const { return true; }

    FCRDDIRApplied& OnApplied() { return Applied; }
    void NotifyApplied(uint64 Revision) { Applied.Broadcast(Revision); }

private:
    TArray<FCRDDIRAsyncHandle> ActiveOperations;
    FCRDDIRApplied Applied;
};
