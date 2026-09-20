# Unreal Engine contract

Use a narrow, project-owned Remote Control Preset containing only reviewable
properties and functions. Bind each declared operation to that preset and check
project/session identity before dispatch. Unreal describes Remote Control as a
Beta HTTP/WebSocket surface with access comparable to exposed Blueprint/Python;
see the [Remote Control documentation](https://dev.epicgames.com/documentation/unreal-engine/remote-control-for-unreal-engine).

Keep the service local or on an appropriately secured network. Never expose a
generic object path, Blueprint/Python callable, or internet-facing Remote Control
endpoint as an advisory action.
