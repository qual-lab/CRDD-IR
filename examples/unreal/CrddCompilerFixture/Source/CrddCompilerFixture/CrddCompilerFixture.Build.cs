using UnrealBuildTool;

public class CrddCompilerFixture : ModuleRules
{
    public CrddCompilerFixture(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicIncludePaths.Add(ModuleDirectory);

        PublicDependencyModuleNames.AddRange(
            new[]
            {
                "Core",
                "CoreUObject",
                "Engine",
                "Json"
            }
        );
        PrivateDependencyModuleNames.Add("CRDDIRRuntime");

        if (Target.bBuildEditor)
        {
            PrivateDependencyModuleNames.Add("UnrealEd");
        }
    }
}
