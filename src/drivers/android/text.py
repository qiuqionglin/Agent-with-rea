"""Optional Unicode dispatch helper. Reads one JSON request; never selects an IME.

The Node caller independently reads Android's hierarchy after this process exits.
Requires uiautomator2==3.7.1 in a caller-selected Python environment.
"""
import contextlib
import importlib.metadata
import json
import sys


def main():
    request = json.load(sys.stdin)
    if importlib.metadata.version("uiautomator2") != "3.7.1":
        raise ValueError("Expected uiautomator2==3.7.1")
    keys = {"resource-id": "resourceId", "text": "text", "content-desc": "description",
            "class": "className", "package": "packageName"}
    mode = request.get("mode")
    if mode not in ("dump", "text"):
        raise ValueError("Unknown helper mode")
    result = {"ok": True, "level": "dispatch-only"}
    with contextlib.redirect_stdout(sys.stderr):
        import uiautomator2
        device = uiautomator2.connect(request["serial"])
        try:
            # Video feeds never become idle. This affects this temporary
            # instrumentation connection only, not app or Android settings.
            device.jsonrpc.setConfigurator({"waitForIdleTimeout": 0, "waitForSelectorTimeout": 0})
            if mode == "dump":
                result = {"ok": True, "level": "native-hierarchy", "xml": device.dump_hierarchy(compressed=True)}
            else:
                selector = request["selector"]
                if not selector or any(k not in keys or not isinstance(v, str) for k, v in selector.items()):
                    raise ValueError("Unsupported native selector")
                native = {keys[k]: v for k, v in selector.items()}
                native["packageName"] = request["package"]
                text = request["text"]
                if not isinstance(text, str) or len(text) > 8192:
                    raise ValueError("Invalid text length")
                element = device(**native)
                if element.count != 1:
                    raise ValueError("Native selector is ambiguous or missing")
                info = element.info
                if info.get("className") != "android.widget.EditText" or info.get("password") or not info.get("enabled"):
                    raise ValueError("Input is not an enabled non-password EditText")
                element.set_text(text)
        finally:
            device.stop_uiautomator()
    return result


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Exception as error:
        # Do not echo input text, device hierarchy, or arbitrary exception data.
        print(json.dumps({"ok": False, "error": type(error).__name__}))
        sys.exit(1)
