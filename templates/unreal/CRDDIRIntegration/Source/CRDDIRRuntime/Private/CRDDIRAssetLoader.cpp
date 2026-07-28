#include "CRDDIRAssetLoader.h"

#include "Engine/AssetManager.h"
#include "Engine/StreamableManager.h"
#include "UObject/WeakObjectPtr.h"

TSharedPtr<FStreamableHandle> FCRDDIRAssetLoader::LoadPrimaryAsset(
    UObject* Owner,
    const FPrimaryAssetId& AssetId,
    const TArray<FName>& Bundles,
    TFunction<void(UObject*)> OnLoaded
)
{
    check(IsInGameThread());
    check(Owner);
    check(AssetId.IsValid());

    const TWeakObjectPtr<UObject> WeakOwner(Owner);
    return UAssetManager::Get().LoadPrimaryAsset(
        AssetId,
        Bundles,
        FStreamableDelegate::CreateLambda(
            [
                WeakOwner,
                AssetId,
                OnLoaded
            ]() mutable
            {
                check(IsInGameThread());
                if (!WeakOwner.IsValid())
                {
                    return;
                }
                OnLoaded(UAssetManager::Get().GetPrimaryAssetObject(AssetId));
            }
        )
    );
}
