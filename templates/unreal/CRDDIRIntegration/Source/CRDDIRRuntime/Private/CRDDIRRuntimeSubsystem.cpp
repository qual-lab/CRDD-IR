#include "CRDDIRRuntimeSubsystem.h"

FCRDDIRAsyncHandle UCRDDIRRuntimeSubsystem::RunAsync(
    TUniqueFunction<void()> Work,
    TUniqueFunction<void()> ApplyOnGameThread
)
{
    ActiveOperations.RemoveAll(
        [](const FCRDDIRAsyncHandle& Handle)
        {
            return Handle.IsComplete();
        }
    );
    FCRDDIRAsyncHandle Handle = FCRDDIRRuntime::RunAsync(
        this,
        MoveTemp(Work),
        MoveTemp(ApplyOnGameThread)
    );
    ActiveOperations.Add(Handle);
    return Handle;
}

void UCRDDIRRuntimeSubsystem::Deinitialize()
{
    for (const FCRDDIRAsyncHandle& Handle : ActiveOperations)
    {
        Handle.Cancel();
    }
    ActiveOperations.Reset();
    Super::Deinitialize();
}
