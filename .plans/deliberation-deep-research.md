# Deep research: branchable-memory deliberation system

**Research date:** 2026-07-23
**Source proposal:** [deliberation-initial.md](./deliberation-initial.md)
**Verdict:** promising as an auditable scenario-exploration product; not credible as a system that “lives out” real futures and selects the objectively winning one.

## Executive summary

The proposal combines several real and useful primitives, but makes a category error between **branching memory** and **simulating the world**. `agenticow` can cheaply create isolated copy-on-write views of vector memory. It cannot, by itself, clone an agent's complete execution state, predict external consequences, define human utility, or identify a winning future. Those are the hard parts, and their costs grow with the number and depth of rollouts even if snapshot creation is constant-time.

The strongest product is therefore a local-first **deliberation workbench**: it turns a consequential choice into explicit assumptions, constraints, scenarios, evidence, uncertainties, and reversible memory branches; runs diverse, bounded analyses; stress-tests recommendations; and presents the user with a decision brief. The MVP should use a central orchestrator and ordinary parallel workers, not Synaptic-Mesh. It should treat MCP as an integration boundary, agenticow as an optional branch store, and learned memory as retrieval/personalization—not as an unmonitored mechanism that rewrites the scoring function.

## Research scope

This investigation addressed seven questions:

1. What does each proposed dependency actually provide?
2. Does cheap memory branching make thousands of decision simulations practical?
3. What research supports search and parallel deliberation with language models?
4. What is required to score outcomes credibly?
5. What architecture is appropriate for an MVP versus later research?
6. What privacy, security, safety, and regulatory risks follow from personal decision data?
7. Where is the defensible product value, and how should it be validated?

The repository currently contains only the one-paragraph idea. Consequently, “codebase analysis” primarily consisted of dependency source, test, benchmark, package, and project-history inspection.

## 1. Dependency reality check

### agenticow

`agenticow` is a new MIT-licensed Node package (GitHub repository created 2026-06-28; npm version `0.2.4` at research time) built on `@ruvector/rvf-node`. A branch holds a pointer to its parent plus local edits/tombstones. Reads combine the lineage, child changes override parent entries, and promotion replays reviewed edits into a target.

What is supported:

- Constant-size creation of an initially empty branch, independent of base-vector count.
- Isolation, override, tombstone, diff/promote, rollback, persistence, and read-through behavior.
- A measured upstream benchmark claim of roughly 0.47–0.5 ms and 162 bytes for branch metadata on its stated hardware.
- Native cross-boundary ANN on `linux-x64-gnu`; other platforms use an exact JavaScript merge fallback.

What is not supported by that benchmark:

- Forking a model's KV cache, process state, tool state, environment state, knowledge graph, episodic log, or external systems.
- Performing a rollout for 162 bytes.
- Constant cost after a branch accumulates edits. Upstream documentation estimates branch delta storage as a function of edits (about 520 bytes per edited vector in its benchmark).
- Trustworthy selection of a branch.
- Distributed replication, trust, and merge policy. The package itself labels that layer as roadmap.

The upstream project makes an especially important concession: its successful examples use **deterministic external verifiers**, and it says a cheap language-model judge was a negative selector. The examples demonstrate branch/verify/promote mechanics, not model intelligence. It also reports its underlying HNSW search at 1M vectors as about 6.3× slower than hnswlib at matched recall, a deliberate versioning-versus-throughput trade-off. See the [agenticow repository](https://github.com/ruvnet/agenticow).

Local verification on the research machine:

- `npm ci` completed with 0 reported vulnerabilities.
- All 11 package tests passed, covering isolation, tombstones, rollback, promotion, persistence, read-through, and native-ANN/fallback behavior.
- The acceptance run used 20,000 base vectors, 1,000 branches, 12 changes per branch, and reported a median 0.945 ms/fork on an AMD EPYC 7763. This confirms that the primitive works locally, but is not an independent reproduction of the 1M-vector, 162-byte end-to-end product claim.

**Assessment: medium confidence.** The narrow storage primitive is credible and testable. The project is extremely young, has a small maintainer/community footprint, limited tests relative to a database, and platform caveats. Pin versions and keep an adapter boundary.

### SAFLA

SAFLA presents a hybrid memory architecture (vector, episodic, semantic, and working memory), a metacognitive engine, delta evaluation, safety checks, CLI, and MCP servers. The repository is MIT licensed, was created in May 2025, and PyPI exposed version `0.1.3` at research time. Its repository is substantial and contains many tests and examples.

However, most performance and learning claims found during this research are self-reported by the project. “Self-learning” here should be understood as storing outcomes, retrieving patterns, updating strategy metadata, and adapting heuristics—not proof that a general personal agent becomes reliably better at predicting a user's life. The system also introduces a feedback risk: if model-generated outcomes train the evaluator, errors can become self-confirming.

Use only the bounded pieces initially:

- append-only episodes;
- provenance-aware retrieval;
- explicit user feedback;
- versioned preference models;
- offline evaluation before promotion.

Do not let an online loop silently rewrite safety rules, user values, or the production scorer. See the [SAFLA repository](https://github.com/ruvnet/SAFLA).

**Assessment: low-to-medium confidence for production learning claims; medium for reusable memory/orchestration components.**

### Synaptic-Mesh

Synaptic-Mesh describes Wasm micro-neural agents, peer discovery, encrypted DAG communication, distributed consensus, mutation, and swarm orchestration. This is far more infrastructure than a personal decision MVP needs. A mesh does not solve the epistemic problem of predicting outcomes; it adds deployment, identity, consistency, observability, data-governance, and adversarial-node problems.

The project may become useful when workloads genuinely span untrusted or edge-owned machines. Before that point, a job queue and isolated workers are cheaper to understand, benchmark, secure, and operate. The distributed trust/merge gap in agenticow further prevents treating the two systems as a ready-made integrated substrate. See the [Synaptic-Mesh repository](https://github.com/ruvnet/Synaptic-Mesh).

**Assessment: low confidence as an MVP dependency; research-only until a concrete distributed requirement exists.**

### MCP

MCP is a protocol and integration boundary, not an agent scheduler or consensus layer. Its official architecture is host/client/server, using JSON-RPC primitives such as tools, resources, prompts, and notifications over stdio or Streamable HTTP. It is appropriate for connecting the deliberation host to calendars, documents, simulations, databases, and specialist services, provided every server has least-privilege scopes and explicit approval policy. See the official [MCP architecture documentation](https://modelcontextprotocol.io/docs/learn/architecture) and [tools specification](https://modelcontextprotocol.io/specification/draft/server/tools).

**Assessment: high confidence as an interoperability layer.**

## 2. The central feasibility issue

The proposal implicitly assumes:

> cheap snapshot × many agents = cheap, accurate futures

The accurate model is:

> total cost ≈ branch setup + (number of rollouts × steps × model/tool/environment cost) + evaluation + aggregation

Only the first term is made nearly constant by copy-on-write memory. If 1,000 branches each execute 20 steps, the system still performs roughly 20,000 step transitions plus tool calls, retrieval, writes, and scoring. Branching thousands of near-identical agents can also create an illusion of evidence: correlated rollouts from the same model and prompt family are not 1,000 independent observations.

More fundamentally, a narrative generated by an LLM is not an observation sampled from the real world. Real decision simulation requires some combination of:

- a state representation;
- allowed actions and constraints;
- a transition/world model;
- uncertainty distributions;
- a utility model;
- terminal conditions;
- outcome observations for calibration.

Without those, “simulation” means structured counterfactual storytelling. That can be useful for finding considerations and assumptions, but its scores should not be presented as probabilities or expected outcomes.

## 3. What adjacent research establishes

Search-based inference is a legitimate foundation. [Tree of Thoughts](https://arxiv.org/abs/2305.10601) showed that generating, evaluating, and backtracking over multiple reasoning paths can greatly improve results on bounded tasks with verifiable structure. Language Agent Tree Search and later LLM/MCTS work similarly combine proposal, search, feedback, and value estimates. A recent [survey of task planning with LLMs](https://spj.science.org/doi/abs/10.34133/icomputing.0124) describes MCTS and LLM-as-world-model approaches.

But the evidence does not justify generalizing from puzzles, code tests, games, and formal planning environments to open-ended life decisions. Those research environments usually have:

- known rules or executable transitions;
- a compact action space;
- short horizons;
- observable terminal rewards;
- automatic verification.

Personal decisions often have hidden variables, strategic humans, irreversible effects, value conflict, and sparse delayed feedback. Adaptive planning remains difficult even in constructed benchmarks; the 2026 AdaPlanBench results reported a best accuracy of 67.75% under progressively revealed world and user constraints ([paper summary](https://huggingface.co/papers/2606.05622)).

The correct inference is:

- **High confidence:** explicit search can outperform a single linear response on some bounded tasks.
- **Medium confidence:** diverse roles and adversarial review can improve issue coverage.
- **Low confidence:** an LLM can accurately forecast long-horizon personal outcomes merely by generating more branches.

## 4. Scoring: the actual core product

A single “winning branch” is usually the wrong abstraction. Decisions are multi-objective and preference-sensitive. A useful system should return:

- Pareto-efficient options rather than one universal winner;
- a scorecard across user-declared dimensions;
- uncertainty intervals or qualitative confidence;
- assumptions with sensitivity analysis;
- robust choices that perform acceptably across plausible worlds;
- dominated options and the reason they were rejected;
- disagreement among evaluators;
- an explicit “insufficient evidence” state.

Recommended score dimensions include goal fit, financial impact, time, reversibility, downside severity, option value, effects on others, evidence strength, legal/ethical constraints, and regret under adverse scenarios. Weights must come from the user and remain editable. The interface should show whether changing a weight or assumption flips the recommendation.

Evaluation hierarchy, strongest first:

1. executable domain simulator or solver;
2. observed historical outcomes with causal caveats;
3. deterministic rules/tests/constraints;
4. independent expert or user review;
5. calibrated specialist model;
6. generic LLM judge.

An LLM judge can help organize evidence but should not be the only reward function. Generator and evaluator should not share a single unexamined context; use rubric-based scoring, blinded candidate order, heterogeneous models where affordable, and deterministic checks wherever possible.

## 5. Recommended product and architecture

### Product positioning

Position it as:

> “A private decision lab that explores alternatives, exposes assumptions, stress-tests trade-offs, and preserves an audit trail.”

Avoid:

> “Thousands of agents live out the future and merge the winner.”

The first claim is useful and testable. The second implies forecasting validity the components do not provide.

### MVP workflow

1. **Decision contract:** capture question, deadline, options, non-negotiable constraints, stakeholders, and what success means.
2. **Preference elicitation:** turn values into editable criteria, weights, vetoes, and acceptable-risk bounds.
3. **Evidence pack:** retrieve user-provided facts and connected sources; distinguish facts, estimates, assumptions, and generated hypotheses.
4. **Scenario generation:** produce a small diverse set—base case, upside, downside, adversarial, stakeholder, and unknown-unknown probes.
5. **Bounded rollouts:** explore perhaps 8–32 branches with depth and budget limits; expand only promising or uncertain nodes.
6. **Verification:** execute calculators, constraints, domain tools, and source checks.
7. **Aggregation:** calculate Pareto front, robustness, disagreement, and sensitivity.
8. **Decision brief:** show options, evidence, assumptions, risks, reversibility, next experiments, and dissent.
9. **Outcome follow-up:** ask what happened later; store observed outcomes separately from simulated ones.

### Minimal technical design

- **Host/orchestrator:** owns budgets, branch lifecycle, approvals, and audit log.
- **Canonical decision graph:** structured state in SQLite/Postgres; it is the source of truth.
- **Blob/evidence store:** encrypted documents and source snapshots with provenance.
- **Vector retrieval:** branchable adapter; agenticow is a candidate for memory overlays, not the canonical state database.
- **Worker pool:** stateless, sandboxed workers behind a queue; role prompts are configuration, not permanent autonomous identities.
- **Verifier registry:** deterministic calculators, policies, simulations, and human checkpoints.
- **MCP gateway:** allowlisted servers, per-tool scopes, timeouts, schema validation, and explicit write approval.
- **Evaluator:** multi-objective scorecards, uncertainty, sensitivity, and abstention.
- **Learning ledger:** append-only predicted-versus-observed outcomes; offline promotion of learned patterns.

Every artifact needs IDs for decision, branch, parent, model/prompt version, evidence, tool calls, assumptions, scores, and timestamps. Branch merge should merge **verified facts or user-approved deltas**, never a whole generated worldview.

### Why not use the full proposed stack initially?

The novel user value is disciplined deliberation and calibrated evaluation, not distributed neural infrastructure. Start with one process plus a queue. Introduce:

- agenticow when branch duplication is measured as a real bottleneck;
- SAFLA components after an outcome-feedback dataset exists;
- Synaptic-Mesh only when central scheduling demonstrably fails a deployment requirement;
- MCP immediately, but only behind policy controls.

## 6. Safety, privacy, and governance

Personal deliberation data can reveal health, finances, relationships, location, politics, employment, and vulnerabilities. Thousands of branches multiply derived sensitive data even if branch metadata is small.

Baseline controls:

- local-first or single-tenant encrypted storage;
- data minimization and per-decision retention;
- explicit deletion that also clears descendants, indexes, caches, backups, and learned artifacts;
- no training on user data by default;
- provenance and purpose tags on every memory;
- separation of raw facts, user beliefs, model inferences, and observed outcomes;
- capability-based tool credentials and egress controls;
- prompt-injection isolation for retrieved content;
- branch-level audit and reproducibility;
- no autonomous external actions in the MVP;
- heightened review or refusal for medical, legal, financial, employment, credit, or self-harm decisions.

NIST identifies confident confabulation as a characteristic risk of generative AI and specifically warns about its use in consequential decision-making; generated explanations can themselves be false ([NIST Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)). The wider [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework) recommends lifecycle risk management and testing/evaluation/verification/validation.

If the system becomes a tool used by organizations to make decisions **about people**, legal exposure changes materially. Data-protection regimes can require lawful basis, minimization, explanations, impact assessment, challenge rights, and meaningful human intervention. The UK ICO's [automated-decision guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/rights-related-to-automated-decision-making-including-profiling/) and [agentic-AI risk analysis](https://ico.org.uk/about-the-ico/research-reports-impact-and-evaluation/research-and-reports/technology-and-innovation/tech-horizons-and-ico-tech-futures-agentic-ai/data-protection-and-privacy-risks/) are useful design baselines. This report is not legal advice, and requirements vary by jurisdiction and use case.

## 7. Product differentiation and defensibility

“Multiple AI opinions” is easy to copy. Defensibility would come from:

- a rigorous decision schema and interaction design;
- calibrated predicted-versus-observed outcome data;
- domain-specific verifiers and simulators;
- trustworthy preference elicitation;
- privacy and auditability;
- clear uncertainty and dissent presentation;
- longitudinal evidence that users make better or more confident decisions without automation bias.

The most plausible initial wedge is a reversible, bounded domain with frequent feedback and measurable outcomes—for example engineering architecture choices, incident-response options, procurement comparisons, or project prioritization. Avoid beginning with health, relationships, investing, hiring, or credit: validity is harder, feedback is slower, and harms/regulatory stakes are higher.

## Evidence quality assessment

| Finding | Confidence | Basis and limitation |
|---|---|---|
| agenticow implements functional COW vector-memory branches | High | Source inspection plus 11 locally passing tests |
| Branch creation is independent of base size in the stated representation | High | Data structure and upstream benchmarks; hardware constants vary |
| The exact 0.5 ms / 162 B headline generalizes to production workloads | Medium-low | Self-reported benchmark; metadata does not include rollout/edit costs |
| Cheap branch creation makes thousands of futures cheap | Low / contradicted | Dominant inference, tools, writes, and evaluation remain linear or worse |
| Search over reasoning paths can help bounded, verifiable tasks | High | Peer-reviewed/open research and reproducible task results |
| More same-model branches yield well-calibrated real-life forecasts | Low | Correlated errors, weak world models, sparse ground truth |
| SAFLA provides usable memory/feedback components | Medium | Substantial repository; broad learning claims are mostly project-reported |
| Synaptic-Mesh is required for the MVP | Low / contradicted | Adds complexity without solving evaluation or forecasting |
| MCP is appropriate for tool integration | High | Official protocol architecture and broad ecosystem fit |
| A decision-workbench reframing is viable | Medium | Strong technical fit; customer demand still needs discovery and trials |

## Key contradictions resolved

- **“Fork entire memory for 162 bytes”** → fork a vector-store overlay for roughly that metadata size; not the entire cognitive/runtime state.
- **“Live out a decision path”** → generate or execute a model-based rollout; fidelity depends on a domain model and evidence.
- **“Score outcomes”** → only defensible when objectives, uncertainty, and verifiers are explicit.
- **“Merge the winner”** → promote verified deltas and lessons; never overwrite personal truth with a generated narrative.
- **“Distributed mesh improves intelligence”** → distribution improves placement/throughput/fault tolerance; it does not inherently improve epistemic quality.
- **“Self-learning improves over time”** → possible only with observed feedback, calibration, versioning, and controls against feedback loops.

## Open questions

1. Who is the first user, what repeated decision do they face, and what measurable harm does the current process cause?
2. Which first domain supplies executable rules or outcomes within weeks rather than years?
3. Does the user want recommendation, facilitation, documentation, or team consensus?
4. What is the ground-truth outcome and when can it be observed?
5. Which preferences may the system infer, and which must always be asked?
6. What constitutes meaningful branch diversity?
7. What error rate, abstention rate, latency, and cost are acceptable?
8. Is local-only inference a requirement, and which models fit the target hardware?
9. How are corrections and deletions propagated through descendant memories and learned patterns?
10. What empirical bottleneck would justify agenticow, SAFLA, or a distributed mesh?

## Recommended next steps

### Phase 0: falsify the product, 2–3 weeks

- Interview 12–20 people in one bounded domain.
- Collect 30–50 historical decisions with known outcomes.
- Define a decision schema and scoring rubric before building infrastructure.
- Establish baselines: unaided human, one strong LLM response, and a simple three-role critique.
- Success gate: users identify missing considerations and prefer the structured brief; retrospective rankings correlate with outcomes better than the single-response baseline.

### Phase 1: thin prototype, 3–5 weeks

- Build a local CLI or small web app with SQLite, a job queue, 8–16 branches, deterministic tools, and a Markdown/HTML decision brief.
- Store branch state canonically as structured JSON; optionally use agenticow behind a memory adapter.
- Implement provenance, cost limits, sensitivity analysis, dissent, and abstention from day one.
- Do not include autonomous external actions, mesh networking, or online self-modification.

### Phase 2: prospective evaluation, 6–10 weeks

- Run real decisions prospectively and capture forecasts before outcomes.
- Measure calibration (Brier score where probabilities are appropriate), regret, constraint violations, issue coverage, stability under paraphrase, diversity, latency, and cost.
- Red-team sycophancy, prompt injection, poisoned memory, preference drift, evaluator bias, correlated-agent consensus, and deletion failures.
- Compare 1, 4, 8, 16, and 32 branches to find diminishing returns.

### Phase 3: controlled learning and scale

- Add outcome-based retrieval and offline-tested policy updates.
- Promote patterns only when held-out evaluation improves and safety does not regress.
- Add domain simulators and specialist verifiers.
- Benchmark branch-store benefit against ordinary snapshot/delta tables.
- Consider distributed execution only after profiling proves central workers inadequate.

## Go/no-go criteria

Proceed if:

- a narrow user segment repeats consequential but bounded decisions;
- outcomes or strong verifiers are available;
- structured branching beats a single-model baseline at acceptable cost;
- users understand uncertainty and remain the decision-maker;
- the system can delete and reproduce deliberations reliably.

Stop or reposition if:

- value depends mainly on unverified future narratives;
- “consensus” comes from correlated instances of one model;
- no observable outcome can calibrate the scorer;
- users interpret scores as objective probabilities;
- the full infrastructure stack is required before demonstrating user value.

## Bottom line

The invention contains a sound systems primitive and a compelling interaction metaphor, but the original sentence overclaims what the stack can know. Build the **decision laboratory**, not the **future oracle**. The research priority is not making 1,000 forks; it is proving that a small, diverse, evidence-grounded set of branches plus transparent scoring produces better decisions than one good model response.
