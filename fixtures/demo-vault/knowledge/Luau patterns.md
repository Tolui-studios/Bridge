# Luau patterns

Studio-wide conventions that apply to every game:

- One module per system under `src/shared/systems/`, returned as a table with `init()` and `step(dt)`
- Signals over BindableEvents; never poll in `RenderStepped` for gameplay logic
- All tunable numbers live in a `Config` module at the top of the system folder
