using UnrealBuildTool;

public class CRDDIRIntegration : ModuleRules
{
    public CRDDIRIntegration(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PrivateDependencyModuleNames.AddRange(
            new[] { "Core", "CoreUObject", "Engine", "Json", "UnrealEd" }
        );
    }
}
