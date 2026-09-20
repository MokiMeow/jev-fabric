# Godot contract

Map declared operations to registered EditorPlugin actions or known version-pinned
headless scripts/export presets. Godot documents headless execution, export, and
command-line scripts in its [command-line tutorial](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html).

Do not expose arbitrary GDScript, file paths, scenes, export preset names, or
arguments. Missing plugin capability, recovery mode, stale project state, or a
changed export preset must cause the adapter to reject or abstain.
