# Local advisor API

Start `PORT=8770 node serve.mjs` (PowerShell: `$env:PORT='8770'; node serve.mjs`). The service binds to `127.0.0.1`. Local LLM defaults to `http://127.0.0.1:8767/v1`; override with `LINE_LENS_LLM_URL` and `LINE_LENS_LLM_MODEL`. The endpoint must be HTTP loopback. A loaded OpenAI-compatible model exposing `/models` and `/chat/completions`, including llama.cpp, is required. The default model alias is `Qwen3-4B-Q4_K_M`; `/models` supplies the actual loaded alias if different.

Requests have a 16KB body limit and use `Content-Type: application/json`. Browser origins must be this localhost service. Supported routes only:

* `GET /api/advisor/status`: `{reachable,llmStatus,llmModel,endpoint,error?}`. Connection detection uses the actual `/models` response; it does not imply a completed inference.
* `POST /api/advisor/interpret`: `{text,currentConfig}`. This makes a real local LLM structured-JSON request. Returns `interpretation` string, `questions` strings, `requestedGoal`, `defaultsApplied:[{field,value,reason}]`, `goal`, `requiresConfirmation:true`, `unsupported`, `llmModel`, `llmInterpretMs`, `llmStatus`. Missing user constraints remain null in `requestedGoal`; the separately identified demo defaults are target good pairs 1000, minimum good percentage 95, maximum changed production factors 3, maximum fictional fatigue score 40, maximum workload indicator 90, human changes allowed, and no locked production factors. These human limits are adjustable comparison assumptions, not safety standards. Vague goals, including reducing worker burden without a production target, require clarification and editable confirmation; unsupported goals such as actual accident probability return `goal:null`.
* `POST /api/advisor/recommend`: `{goal,currentConfig,text?}`. `goal.confirmed` must be true. Returns the deterministic engine report and actual LLM comparison `explanation:{recommendedId,reasons:[{candidateId,text}],questions}`, `llmModel`, `llmExplainMs`, `llmStatus`. A LLM outage or malformed/out-of-list candidate ID is an explicit error, never a fabricated successful explanation. No-feasible reports have empty candidates, explanation null, `llmStatus:'not_needed'`, and a constraint message.

```json
{
  "goal": {
    "confirmed": true,
    "objective": "reach_target",
    "targetGoodPairs": 1000,
    "minQualityPct": 95,
    "maxChangedFactors": 3,
    "maxFatigueScore": 40,
    "maxWorkloadPct": 90,
    "allowHumanChanges": true,
    "locks": {"materialReduction": false,"balanceReduction": false,"qualityGuard": false}
  },
  "currentConfig": {"seed":20261007,"model":"FLEX","materialReduction":0,"balanceReduction":0,"qualityGuard":false,"humanEnabled":true,"manualWorkers":2,"pacePercent":100,"breakEveryMinutes":90,"breakMinutes":5}
}
```

The alternative objective is `maximize_good`, with `targetGoodPairs:null`. Locks retain current production values. Each run evaluates 126 production configurations for the selected product and seed: material 0..80 by 10, balance 0..30 by 5, quality false/true. With `humanEnabled:true` and `allowHumanChanges:true`, these are combined with up to four distinct human profiles: current settings; manual workers +1 capped at 3; pace −10 points floored at 90; rest +5 minutes capped at 10 and interval capped at 90. Entire duplicate profiles are removed. `humanProfilesEvaluated` is 1..4 and `evaluated` is 126 times that count, never a hard-coded 504. Human changes disabled means exactly the current profile and 126 runs; the human model disabled also means 126. This bounded search is not an exhaustive staffing/rest optimizer.

`eligible` counts configurations satisfying quality, human limits when enabled, production locks, maximum changed production factors, and target reachability. `qualityFiltered` and `safetyFiltered` independently count quality failures and fictional fatigue/workload-limit failures among all evaluated configurations. The counts can overlap and must not be added as mutually exclusive exclusions. Despite the legacy API name `safetyFiltered`, it is a workload-assumption filter, not an actual safety judgment. No fatigue/workload filtering occurs with the human model off. The advisor baseline is the supplied current configuration, which may be outside the grid. Unlike the advisor baseline, `runComparison` preserves product, seed and human-enabled state but resets both production and human controls to default settings for its reference line.

Each candidate contains authoritative `id`, `category`, `config`, `minutesToTarget`, `total`, `good`, `qualityPct`, `wip`, `changedFactors` (production field names), `changeMagnitude`, `humanChangedFactors` (human field names), `humanChangeMagnitude`, the `human` group below, scalar `maxFatigueScore`, `avgFatigueScore`, `maxWorkloadPct`, `congestionPct`, `fatigueExposureMinutes`, `workers`, `goodPairsPerPersonHour`, and `delta` with all scalar metric field names. Target arrival is observed at one-minute frame resolution and null if unreachable. Delta minutes is candidate minus baseline (negative is sooner); null means either did not reach target. IDs retain their previous form when the human model is off and append `-H{workersPerManualStation}-P{pace}-E{restInterval}-R{restDuration}` when on. No numbers in LLM prose are accepted; frontend metric displays use the engine fields.

Candidate categories are `fast` (best confirmed objective), `small-change` (fewest total changed production and human fields, then smallest summed magnitude among candidates strictly improving baseline target time or good pairs), and, when enabled, `low-load` (lowest historical peak fatigue, then workload and fatigue exposure). Low-load first uses candidates improving at least one burden indicator; if none improve it uses all feasible candidates. When disabled, the third category remains `quality` (highest good percentage). Small-change falls back to all feasible candidates only when no objective improvement exists. Each category chooses its global best candidate in that pool. If categories choose the same ID, that configuration appears once; the engine does not invent a second-best variant just to fill three cards. Objective ties prefer fewer production factors and magnitude, fewer human factors and magnitude, then good pairs, good percentage, lower WIP, stable ID. Production magnitude is absolute material change/80 + balance change/30 + quality toggle (0/1). Human magnitude is absolute workers change + pace change/30 + rest-interval change/60 + rest-duration change/10. Neither is a monetary cost. `maxChangedFactors` always limits production factors only.

## Human model configuration and metrics

Flat config fields and defaults: `humanEnabled:false` (legacy compatibility; the UI starts on), `manualWorkers:2` (integer 1..3 per manual station), `pacePercent:100` (integer 90..120), `breakEveryMinutes:90` (60, 90 or 120), `breakMinutes:5` (0, 5 or 10). All fields are validated even when disabled. Optional goal fields default as above; fatigue limit accepts 0..100 and workload limit 0..120. Old goal clients can omit these fields. Total staffing is `6 + 3 × manualWorkers` when on and 12 when off. All displayed productivity denominators use actual total staffing and elapsed shift hours, including scheduled rest.

Every full frame and its `final` frame contain `human:{enabled,workers,maxFatigueScore,avgFatigueScore,maxWorkloadPct,congestionPct,fatigueExposureMinutes,stations}`. Each station has `human` referencing its corresponding frozen station data: `{id,name,manual,assignedWorkers,fatigueScore,workloadPct,onBreak,activeMinutes,breakMinutes}`. Manual stations are `upper`, `bonding`, `inspect`; `kit`, `lasting`, `press` each retain 2 workers. During scheduled manual rest the station status is `resting`, progress pauses and fatigue recovers; other stations continue using existing FIFO/capacity constraints. Rest starts after the first full configured interval, repeating on the shift clock, and no new rest starts at the completed shift endpoint. All manual stations rest together without substitute workers.

Fictional manual fractions `f` are 0.8/0.6/0.7, nominal staffing 2. For current fatigue `F`, worker count `n`, and pace percentage `p`, processing-time multiplier is `(1-f)+f*(2/n)*(100/p)*(1+0.25*F/100)`. Each actual busy second advances nominal remaining work by `1/multiplier`; a break advances none. The nonmanual fraction is unaffected by worker count/pace. `cycleMinutes` displays instantaneous effective cycle duration using current fatigue; progress is fraction of nominal work completed. Per-minute fatigue change is `+0.10*f*(p/100)^2*(2/n)` during actual service, `−0.06` during idle, stoppage or blocking, and `−0.60` during rest; every second is clamped to 0..100. All coefficients are invented educational assumptions. Quality draws remain unchanged; there is no fatigue-to-defect or accident equation.

`maxFatigueScore` is the historical peak observed across manual stations up to the frame, not merely the ending score. `avgFatigueScore` is the current mean manual score. Station workload is cumulative actual busy seconds divided by elapsed seconds minus scheduled rest seconds, times pace percentage (100 for nonmanual stations); it is 0 before an available denominator. `maxWorkloadPct` is the current maximum of the three manual workload values, and can exceed 100 when pace exceeds 100. This is a speed-weighted utilization surrogate, not a safety percentage. `fatigueExposureMinutes` sums the per-second integral of `F/100` across the three manual teams: its unit is fictional station-minutes, not minutes exceeding a threshold or a measured personal health exposure. `congestionPct` is the time mean of all six FIFO buffer occupancies divided by their total capacity 18 batches, expressed as a percentage: label it 재공품 적체, not pedestrian collision risk. Disabled mode has zero burden metrics and reproduces prior production output.

The local LLM selects candidate IDs and corresponding permitted, engine-grounded reason sentences. Exactly one grounded reason per returned engine candidate is required. Candidate/sentence pairs are validated; unconstrained generated causal claims are not displayed. `llmRole:'constrained-candidate-and-reason-selection'` and `explanationSource:'engine-grounded-sentences-selected-by-local-llm'` state this boundary. Reason choices describe verified timing/quality/change and burden tradeoffs, including extra staffing and per-person productivity. Goal interpretation still uses actual model extraction, with `groundingWarnings` when model-extracted numbers, including human thresholds, cannot be directly matched to literal user numbers or locks/change permissions lack explicit language. Such extracted values remain null in requestedGoal and are never relabeled as explicit user requests. Korean number words require confirmation if they cannot be matched directly.

`computationMs` measures actual engine work including baseline simulation, grid retrieval/calculation, filtering and ranking. `cacheHit` identifies reuse of an identical product+seed+human-enabled-state+complete-human-profiles grid (maximum four cached grids). `evaluated` counts compared configurations even on reuse; cache hits must not be described as new simulations. The advisor retains only compact metrics and 481 minute-output observations per configuration; public full simulation frames remain deeply immutable. `timeResolutionMinutes:1`, `engine:'rule-based-simulation'` explicitly identifies calculation provenance. The standalone `evaluateRecommendations` export makes no LLM call.

Error shape: `{error:{code,message},llmStatus,llmModel,llmInterpretMs,llmExplainMs}`. HTTP 400 invalid goal/config/JSON or missing confirmation; 413 body too large; 415 incorrect content type; 403 foreign origin/host; 502 invalid LLM response; 503 local LLM unavailable. Inference uses temperature zero, structured JSON schema, a 300 output-token maximum for interpretation and 500 for comparison, and a 120-second request timeout. Comparison allows the longer human-profile IDs and one reason per candidate. Text is treated as untrusted goal content and cannot execute code, access files, or call arbitrary URLs.

These are fictional educational model results, not measured company operations, savings, or guarantees.

## Verified legacy local run — 2026-10-09, human model disabled

Actual CPU inference against `http://127.0.0.1:8767/v1`, reported model `Qwen3-4B-Q4_K_M` (llama.cpp). No mock or canned fallback was used for these checks.

* Vague Korean input `더 빨리 만들고 싶어`: returned Korean interpretation, requested target/minimum quality/changed-factor count all null, proposed demo defaults 1000/95/3, `confirmed:false`, `requiresConfirmation:true`; interpretation inference 15203.6871ms. The model's implicit lock flags were removed by source-grounding checks and identified in groundingWarnings.
* Final confirmed demo goal: baseline target arrival 405min, good 1191, quality 95.28%. Compared 126 and eligible 126, `cacheHit:false`, actual engine computation 995.0083ms. Fast candidate `FLEX-20261007-M40-B20-Q1`: 347min, good 1388, quality 97.74647887323944%. Small-change `FLEX-20261007-M0-B5-Q0`: 389min, one changed factor, good 1256, quality 95.15151515151516%. Quality `FLEX-20261007-M0-B0-Q1`: 396min, good 1225, quality 98%.
* Final actual LLM comparison 30632.0359ms; `llmStatus:'ready'`, `llmRole:'constrained-candidate-and-reason-selection'`. Its returned explanation object is preserved below. All IDs and candidate/sentence pairs passed validation.
* Live HTTP checks on localhost service port 8770: foreign origin 403, incorrect content type 415, malformed JSON 400, oversized 17KB body 413.

Actual returned explanation:

```json
{
  "recommendedId": "FLEX-20261007-M40-B20-Q1",
  "reasons": [
    {"candidateId":"FLEX-20261007-M40-B20-Q1","text":"확인한 목표의 계산 순위가 가장 높지만 현재 설정에서 요인을 변경해야 합니다."},
    {"candidateId":"FLEX-20261007-M0-B5-Q0","text":"변경할 요인과 변경 폭을 줄이지만 빠른 후보보다 목표 도달이 늦습니다."},
    {"candidateId":"FLEX-20261007-M0-B0-Q1","text":"양품률을 가장 우선하지만 빠른 후보보다 목표 도달이 늦습니다."}
  ],
  "questions": []
}
```

These measured timings are one local CPU run, not guaranteed latency. An earlier unconstrained prose test produced false quality claims despite valid candidate IDs; this is why final comparison uses engine-grounded reason selection and candidate/sentence validation.

## Human engine verification — 2026-10-09

Fresh deterministic engine calculation with FLEX/default seed and enabled default staffing/rest evaluated 504, eligible 288, burden-filtered 216, approximately 2.97 seconds on this CPU. This timing excludes LLM inference. Default human configuration produced 1250 total / 1191 good pairs, peak fatigue 13.633 and maximum workload 85.952. Increasing manual staffing to 3 produced 1260/1201, fatigue 1.340, workload 68.729 and staffing 15; good pairs per person-hour decreased from 12.406 to 10.008. Pace 90 produced 1240/1181, fatigue 12.011, workload 83.608. Ten-minute rest produced 1230/1171, fatigue 5.696, workload 89.659. The workload ratio can increase when longer breaks reduce the available-time denominator. Stress settings of one manual worker, pace 120 and no break produced 930/889, fatigue 100 and workload 119.325. These are repeatable fictional model outcomes, not measured operations or health effects. Actual human-mode LLM validation is recorded separately by the root verification.
