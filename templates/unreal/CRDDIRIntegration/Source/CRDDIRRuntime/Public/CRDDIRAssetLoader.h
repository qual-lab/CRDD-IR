#pragma once

#include "CoreMinimal.h"
#include "Engine/AssetManagerTypes.h"
#include "Templates/Function.h"

struct FStreamableHandle;
class UObject;

/**
 * Asset Manager boundary for runtime CRDD adapters.
 *
 * The callback is dispatched by Asset Manager on the Game Thread and is
 * suppressed when Owner has been destroyed. Holding the returned handle keeps
 * the load alive; releasing or cancelling it is the caller's responsibility.
 */
class CRDDIRRUNTIME_API FCRDDIRAssetLoader
{
public:
    static TSharedPtr<FStreamableHandle> LoadPrimaryAsset(
        UObject* Owner,
        const FPrimaryAssetId& AssetId,
        const TArray<FName>& Bundles,
        TFunction<void(UObject*)> OnLoaded
    );
};
