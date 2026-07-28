#include "CRDDIRAsync.h"

#include "Async/Async.h"
#include "Async/TaskGraphInterfaces.h"
#include "UObject/WeakObjectPtr.h"

FCRDDIRAsyncHandle::FCRDDIRAsyncHandle()
    : Cancelled(MakeShared<TAtomic<bool>, ESPMode::ThreadSafe>(false))
    , Complete(MakeShared<TAtomic<bool>, ESPMode::ThreadSafe>(false))
{
}

FCRDDIRAsyncHandle::FCRDDIRAsyncHandle(
    TSharedRef<TAtomic<bool>, ESPMode::ThreadSafe> InCancelled,
    TSharedRef<TAtomic<bool>, ESPMode::ThreadSafe> InComplete
)
    : Cancelled(MoveTemp(InCancelled))
    , Complete(MoveTemp(InComplete))
{
}

void FCRDDIRAsyncHandle::Cancel() const
{
    Cancelled->Store(true);
}

bool FCRDDIRAsyncHandle::IsCancelled() const
{
    return Cancelled->Load();
}

bool FCRDDIRAsyncHandle::IsComplete() const
{
    return Complete->Load();
}

FCRDDIRAsyncHandle FCRDDIRRuntime::RunAsync(
    UObject* Owner,
    TUniqueFunction<void()> Work,
    TUniqueFunction<void()> ApplyOnGameThread
)
{
    check(IsInGameThread());
    check(Owner);

    const TWeakObjectPtr<UObject> WeakOwner(Owner);
    const TSharedRef<TAtomic<bool>, ESPMode::ThreadSafe> Cancelled =
        MakeShared<TAtomic<bool>, ESPMode::ThreadSafe>(false);
    const TSharedRef<TAtomic<bool>, ESPMode::ThreadSafe> Complete =
        MakeShared<TAtomic<bool>, ESPMode::ThreadSafe>(false);

    Async(
        EAsyncExecution::ThreadPool,
        [
            WeakOwner,
            Cancelled,
            Complete,
            Work = MoveTemp(Work),
            ApplyOnGameThread = MoveTemp(ApplyOnGameThread)
        ]() mutable
        {
            if (Cancelled->Load())
            {
                Complete->Store(true);
                return;
            }
            Work();
            AsyncTask(
                ENamedThreads::GameThread,
                [
                    WeakOwner,
                    Cancelled,
                    Complete,
                    ApplyOnGameThread = MoveTemp(ApplyOnGameThread)
                ]() mutable
                {
                    if (!Cancelled->Load() && WeakOwner.IsValid())
                    {
                        ApplyOnGameThread();
                    }
                    Complete->Store(true);
                }
            );
        }
    );

    return FCRDDIRAsyncHandle(Cancelled, Complete);
}

void FCRDDIRRuntime::DispatchToGameThread(
    UObject* Owner,
    TUniqueFunction<void()> ApplyOnGameThread
)
{
    check(Owner);
    const TWeakObjectPtr<UObject> WeakOwner(Owner);
    AsyncTask(
        ENamedThreads::GameThread,
        [WeakOwner, ApplyOnGameThread = MoveTemp(ApplyOnGameThread)]() mutable
        {
            if (WeakOwner.IsValid())
            {
                ApplyOnGameThread();
            }
        }
    );
}
