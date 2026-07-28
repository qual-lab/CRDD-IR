using UnrealBuildTool;

public class CrddCompilerFixture : ModuleRules
{
    public CrddCompilerFixture(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(
            new[]
            {
                "Core",
                "CoreUObject",
                "Engine",
                "Json"
            }
        );
    }
}
