using UnrealBuildTool;

public class CrddCompilerFixtureEditorTarget : TargetRules
{
    public CrddCompilerFixtureEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
        ExtraModuleNames.Add("CrddCompilerFixture");
    }
}
