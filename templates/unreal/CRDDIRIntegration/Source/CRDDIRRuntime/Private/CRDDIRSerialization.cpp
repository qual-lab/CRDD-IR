#include "CRDDIRSerialization.h"

#include "CRDDIRAsync.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "ProfilingDebugging/CpuProfilerTrace.h"

FCRDDIRAsyncHandle FCRDDIRSerialization::SaveAsync(
    UObject* Owner,
    const FString& Path,
    TArray<uint8> Payload,
    FCRDDIRSerializationPolicy Policy,
    TSharedPtr<ICRDDIRPayloadTransform, ESPMode::ThreadSafe> Transform,
    TFunction<void(bool)> OnComplete
)
{
    struct FResult { bool bSuccess = false; };
    const TSharedRef<FResult, ESPMode::ThreadSafe> Result =
        MakeShared<FResult, ESPMode::ThreadSafe>();
    return FCRDDIRRuntime::RunAsync(
        Owner,
        [
            Path,
            Payload = MoveTemp(Payload),
            Policy,
            Transform,
            Result
        ]() mutable
        {
            TRACE_CPUPROFILER_EVENT_SCOPE(CRDDIR_Save);
            if (!Policy.bAtomicWrite || Payload.Num() > Policy.MaxPayloadBytes)
            {
                return;
            }
            TArray<uint8> Encoded;
            if (Transform.IsValid())
            {
                if (!Transform->Encode(Payload, Encoded)) return;
            }
            else
            {
                Encoded = MoveTemp(Payload);
            }
            const FString Temporary = Path + TEXT(".crdd-tmp");
            if (!FFileHelper::SaveArrayToFile(Encoded, *Temporary)) return;
            Result->bSuccess = IFileManager::Get().Move(
                *Path,
                *Temporary,
                true,
                true,
                false,
                true
            );
            if (!Result->bSuccess) IFileManager::Get().Delete(*Temporary);
        },
        [Result, OnComplete]() { OnComplete(Result->bSuccess); }
    );
}

FCRDDIRAsyncHandle FCRDDIRSerialization::LoadAsync(
    UObject* Owner,
    const FString& Path,
    FCRDDIRSerializationPolicy Policy,
    TSharedPtr<ICRDDIRPayloadTransform, ESPMode::ThreadSafe> Transform,
    TFunction<void(bool, TArray<uint8>)> OnComplete
)
{
    struct FResult
    {
        bool bSuccess = false;
        TArray<uint8> Payload;
    };
    const TSharedRef<FResult, ESPMode::ThreadSafe> Result =
        MakeShared<FResult, ESPMode::ThreadSafe>();
    return FCRDDIRRuntime::RunAsync(
        Owner,
        [Path, Policy, Transform, Result]()
        {
            TRACE_CPUPROFILER_EVENT_SCOPE(CRDDIR_Load);
            TArray<uint8> Encoded;
            if (!FFileHelper::LoadFileToArray(Encoded, *Path) ||
                Encoded.Num() > Policy.MaxPayloadBytes)
            {
                return;
            }
            if (Transform.IsValid())
            {
                Result->bSuccess = Transform->Decode(Encoded, Result->Payload);
            }
            else
            {
                Result->Payload = MoveTemp(Encoded);
                Result->bSuccess = true;
            }
        },
        [Result, OnComplete]()
        {
            OnComplete(Result->bSuccess, MoveTemp(Result->Payload));
        }
    );
}
