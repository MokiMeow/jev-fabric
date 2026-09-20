# Blender contract

Declare add-on-owned, reviewable operations such as inspecting a named property,
applying one enumerated render preset, or exporting through a project policy.
The adapter must snapshot and re-check Blender mode, selection, active object,
data-block identity, and operator `poll()` context before a native call. See
Blender's [operator guidance](https://docs.blender.org/api/main/info_gotchas_operators.html).

Do not expose arbitrary `bpy` expressions, Python text, file paths, operators
derived from a prompt, or UI coordinates.
