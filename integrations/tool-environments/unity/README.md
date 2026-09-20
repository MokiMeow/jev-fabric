# Unity contract

Bind each action to a known, project-side Editor command or version-pinned batch
job. Do not allow a decision to choose an arbitrary `-executeMethod`, C# source,
or command-line argument. Use asset database batch scopes correctly: Unity
documents that `StartAssetEditing` must be balanced with `StopAssetEditing`,
preferably in `try`/`finally`:
[reference](https://docs.unity3d.com/ScriptReference/AssetDatabase.StartAssetEditing.html).

The adapter must retain project identity, asset scope, output location, and build
preset privately and revalidate them before its own native operation.
