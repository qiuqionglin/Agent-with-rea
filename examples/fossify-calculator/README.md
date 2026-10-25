# Fossify Calculator recipe

This project-authored recipe targets Fossify Calculator 1.4.0, pinned by its APK SHA-256. It reads the native display, enters a bounded calculation through observed resource IDs and confirms the result using fresh native UI hierarchies. It is a curated recipe, not an automatically generated adapter.

```bash
app2cli run examples/fossify-calculator --schema
app2cli run examples/fossify-calculator display
app2cli run examples/fossify-calculator calculate --a 15 --operator add --b 27
```

Actual calls require a ready, explicitly selected Android device in `APP2CLI_ANDROID_SERIAL`, an ADB executable in `REA_ADB_PATH` if not on PATH, and the exact analyzed APK. Installation and emulator debugging access remain user-controlled. Four arithmetic operators and bounded nonnegative integer operands are supported.

See the [repository walkthrough](../../README.md), [upstream notices](../../THIRD_PARTY_NOTICES.md) and [original acceptance summary](../../docs/cases/acceptance.json). The former `adapters/fossify-calculator` CLI path remains compatible. Adapter source and manifest bytes have not changed.
