# Health data — drop your real exports here

The whole `data/` directory is **gitignored** (see the repo root `.gitignore`) so your
real numbers never leave your machine. The files checked in here are realistic **sample
stand-ins** — fictional figures, one consistent ~30-day story — so the example boots before
you've dropped anything in. They're shaped to match a [`health-mcp`](https://github.com/lukaisailovic/health-mcp)
export (Whoop + Oura + labs), but any source with these columns works.

To make this dashboard yours, replace the sample files with exports of the same shape.
The manifest (`app/manifest.json`) and the SQL transforms (`models/transforms/`) bind to
the columns below — keep the column names and the dashboard keeps working. Run
`openislands validate apps/examples/health` after any change; a missing column fails the
build and names the island, so you find out immediately, not silently.

## Expected files

### `macros_daily.csv` — one row per day, oldest first
Drives the macro rings (`gauge.rings`, latest row) and the macro trend lines.

`date`, `kcal`, `kcal_goal_low` / `kcal_goal_high` (the goal band), `protein_g` /
`protein_goal_g`, `carb_g` / `carb_goal_g`, `fat_g` / `fat_goal_g`, `sat_fat_g` /
`sat_fat_limit_g` (an upper bound), `fiber_g` / `fiber_goal_g`, `sugar_g`, `hydration_ml` /
`hydration_goal_ml`.

### `meals.csv` — one row per logged meal
The Today timeline. New rows arrive via the `log_meal` action, not by hand-editing.

`meal_id`, `ts` (`YYYY-MM-DD HH:MM`), `meal_type` (breakfast / lunch / dinner / snack),
`name`, `kcal`, `protein_g`, `carb_g`, `fat_g`, `fiber_g`, `sugar_g`, `sat_fat_g`,
`sodium_mg`, `items`, `confidence`, `note`.

### `meal_components.csv` — one row per component inside a meal
Grouped by `meal_id` in the Nutrition log. Written via `log_meal_components`.

`meal_id`, `meal_name`, `meal_ts`, `component`, `kind` (food / recipe / batch), `ref_id`,
`grams`, `kcal`, `protein_g`, `carb_g`, `fat_g`, `fiber_g`, `sugar_g`, `sat_fat_g`,
`sodium_mg`, `estimated`, `note`. Component sums match their meal row.

### `weight.csv` — one row per weigh-in, oldest first
`date`, `kg`, `source` (whoop / scale / manual). Written via `log_weight`.

### `wearable_daily.csv` — one row per day, oldest first
Drives the recovery KPIs, the HRV/RHR line, and the sleep-stage stacked bar.

`date`, `sleep_score`, `recovery`, `hrv_rmssd`, `resting_hr`, `sleep_min`, `deep_min`,
`rem_min`, `light_min`, `awake_min`, `strain`.

### `panels.csv` — one row per blood draw
`panel_id`, `panel_name`, `draw_date`, `lab`, `note`. Written via `log_panel`.

### `biomarkers.csv` — one row per marker per draw
Historical long form. `models/transforms/biomarkers_status.sql` derives the latest value
per marker and the optimal / in range / out of range / unknown verdict from the range
columns — you don't export a status. Written via `log_biomarkers`.

`panel_id`, `panel_name`, `draw_date`, `name`, `category`, `value` (NULL when non-numeric),
`value_text` (the reported text, e.g. `>60`), `unit`, `ref_low` / `ref_high`,
`optimal_low` / `optimal_high` (bounds may be open-ended / NULL).

### `workouts.csv` — one row per activity
`ts`, `date`, `sport` (lift / zone2 / run / cycle / walk / other), `title`, `duration_min`,
`strain`, `avg_hr`, `max_hr`, `kcal`, `note`. Written via `log_workout`.
`models/transforms/training_weekly.sql` rolls these up weekly by sport.

### `batches.csv` — one row per cooked batch
`batch_id`, `name`, `cooked_date`, `total_g`, `kcal_total`, `protein_g_total`,
`carb_g_total`, `fat_g_total`, `status`. Remaining grams and macros are *derived* in
`models/transforms/batches_status.sql` from `meal_components` rows with `kind='batch'`.

### `protocol.csv` — supplements, targets, training, habits
`item`, `kind`, `dose`, `unit`, `timing`, `active`, `note` — your protocol as data instead
of a hardcoded note.

## Deriving extra contracts

`biomarkers_status`, `training_weekly`, `sleep_stages`, and
`batches_status` are **computed** by the SQL transforms in `models/transforms/` — you don't
export them. Keep data shaping in SQL there, never in the manifest. To add a derived
contract, add a `.sql` file and a `{ "sql": "…" }` dataset.
