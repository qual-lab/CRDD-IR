using UnrealBuildTool;

public class CrddCompilerFixtureTarget : TargetRules
{
    public CrddCompilerFixtureTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
        ExtraModuleNames.Add("CrddCompilerFixture");
    }
}
