#pragma once

#include "CoreMinimal.h"
#include "Templates/Function.h"
#include "CRDDIRAsync.h"

class UObject;

struct CRDDIRRUNTIME_API FCRDDIRSerializationPolicy
{
    int32 SchemaVersion = 1;
    int64 MaxPayloadBytes = 1024 * 1024;
    bool bAtomicWrite = true;
};

class CRDDIRRUNTIME_API ICRDDIRPayloadTransform
{
public:
    virtual ~ICRDDIRPayloadTransform() = default;
    virtual bool Encode(const TArray<uint8>& Input, TArray<uint8>& Output) = 0;
    virtual bool Decode(const TArray<uint8>& Input, TArray<uint8>& Output) = 0;
};

class CRDDIRRUNTIME_API FCRDDIRSerialization
{
public:
    static FCRDDIRAsyncHandle SaveAsync(
        UObject* Owner,
        const FString& Path,
        TArray<uint8> Payload,
        FCRDDIRSerializationPolicy Policy,
        TSharedPtr<ICRDDIRPayloadTransform, ESPMode::ThreadSafe> Transform,
        TFunction<void(bool)> OnComplete
    );

    static FCRDDIRAsyncHandle LoadAsync(
        UObject* Owner,
        const FString& Path,
        FCRDDIRSerializationPolicy Policy,
        TSharedPtr<ICRDDIRPayloadTransform, ESPMode::ThreadSafe> Transform,
        TFunction<void(bool, TArray<uint8>)> OnComplete
    );
};
