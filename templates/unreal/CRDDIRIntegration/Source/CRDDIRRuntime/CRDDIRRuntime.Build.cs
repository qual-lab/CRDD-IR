using UnrealBuildTool;

public class CRDDIRRuntime : ModuleRules
{
    public CRDDIRRuntime(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(
            new[] { "Core", "CoreUObject", "Engine" }
        );
    }
}
