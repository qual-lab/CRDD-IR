#pragma once

#include "CoreMinimal.h"
#include "Templates/Function.h"

class UObject;

class CRDDIRRUNTIME_API FCRDDIRAsyncHandle
{
public:
    FCRDDIRAsyncHandle();

    void Cancel() const;
    bool IsCancelled() const;
    bool IsComplete() const;

private:
    FCRDDIRAsyncHandle(
        TSharedRef<TAtomic<bool>, ESPMode::ThreadSafe> InCancelled,
        TSharedRef<TAtomic<bool>, ESPMode::ThreadSafe> InComplete
    );

    TSharedRef<TAtomic<bool>, ESPMode::ThreadSafe> Cancelled;
    TSharedRef<TAtomic<bool>, ESPMode::ThreadSafe> Complete;

    friend class FCRDDIRRuntime;
};

/**
 * Runtime boundary for generated, pure C++ CRDD operations.
 *
 * Work runs on the thread pool and must not access UObjects, Actors, Worlds,
 * or other game-thread-only state. ApplyOnGameThread runs only when Owner is
 * still valid and the operation has not been cancelled.
 */
class CRDDIRRUNTIME_API FCRDDIRRuntime
{
public:
    static FCRDDIRAsyncHandle RunAsync(
        UObject* Owner,
        TUniqueFunction<void()> Work,
        TUniqueFunction<void()> ApplyOnGameThread
    );

    static void DispatchToGameThread(
        UObject* Owner,
        TUniqueFunction<void()> ApplyOnGameThread
    );
};
