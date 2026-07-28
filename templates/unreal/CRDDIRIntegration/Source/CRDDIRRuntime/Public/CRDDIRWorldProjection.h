#pragma once

#include "CoreMinimal.h"

class UWorld;

enum class ECRDDIRProjectionChange : uint8
{
    Spawn,
    Update,
    Destroy
};

struct CRDDIRRUNTIME_API FCRDDIRProjectionChange
{
    FString DomainId;
    ECRDDIRProjectionChange Change = ECRDDIRProjectionChange::Update;
    uint64 Revision = 0;
};

/**
 * Product-owned Port for projecting a Domain Snapshot into a World.
 * Actors are never authoritative; implementations must be rebuildable.
 */
class CRDDIRRUNTIME_API ICRDDIRWorldProjection
{
public:
    virtual ~ICRDDIRWorldProjection() = default;
    virtual void Apply(UWorld& World, const TArray<FCRDDIRProjectionChange>& Changes) = 0;
    virtual void Rebuild(UWorld& World, uint64 Revision) = 0;
    virtual void Shutdown(UWorld& World) = 0;
};
