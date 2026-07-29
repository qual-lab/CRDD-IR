using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;

public static class CrddFixture
{
    public static void BuildPlayer()
    {
        var output = GetArgument("-crddBuildPath");
        if (string.IsNullOrWhiteSpace(output))
            throw new ArgumentException("Missing -crddBuildPath");

        Directory.CreateDirectory(Path.GetDirectoryName(output) ?? ".");
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        const string scenePath = "Assets/CRDD/Fixture.unity";
        if (!EditorSceneManager.SaveScene(scene, scenePath))
            throw new InvalidOperationException("Failed to save fixture scene");

        PlayerSettings.SetScriptingBackend(
            NamedBuildTarget.Standalone,
            ScriptingImplementation.IL2CPP);
        PlayerSettings.SetApiCompatibilityLevel(
            NamedBuildTarget.Standalone,
            ApiCompatibilityLevel.NET_Standard);

        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = new[] { scenePath },
            locationPathName = output,
            target = BuildTarget.StandaloneWindows64,
            options = BuildOptions.None
        });
        if (report.summary.result != BuildResult.Succeeded)
            throw new InvalidOperationException(
                $"Unity IL2CPP build failed: {report.summary.result}, " +
                $"errors={report.summary.totalErrors}");
    }

    private static string GetArgument(string name)
    {
        var args = Environment.GetCommandLineArgs();
        for (var index = 0; index + 1 < args.Length; index++)
        {
            if (string.Equals(args[index], name, StringComparison.Ordinal))
                return args[index + 1];
        }
        return "";
    }
}
