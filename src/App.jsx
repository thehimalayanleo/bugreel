import { useEffect, useMemo, useRef, useState } from "react";
import { sampleInvestigation, SAMPLE_FAILURE } from "./sample.js";
import { registerBugReelWebMcp } from "./webmcp.js";

const DEFAULT_REPO = "https://github.com/thehimalayanleo/relay";
const DEFAULT_EXPECTED = "";
const stageNode = [0, 1, 2, 4, 6];
const phaseStage = { repository: 0, retrieval: 1, investigator: 2, challenger: 2, resolver: 3, grounding: 4, partial: 4 };

export default function App() {
  const [repoUrl, setRepoUrl] = useState(DEFAULT_REPO);
  const [failure, setFailure] = useState(SAMPLE_FAILURE);
  const [expected, setExpected] = useState(DEFAULT_EXPECTED);
  const [investigation, setInvestigation] = useState(sampleInvestigation);
  const [selectedId, setSelectedId] = useState(sampleInvestigation.hypotheses[0].id);
  const [stage, setStage] = useState(4);
  const [replaying, setReplaying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [probeSubmitting, setProbeSubmitting] = useState(false);
  const [swarmStarting, setSwarmStarting] = useState(false);
  const [probeKind, setProbeKind] = useState("boundary");
  const [jobs, setJobs] = useState([]);
  const [manager, setManager] = useState({ modelConcurrency: 1, activeModels: 0, queuedModels: 0, activeWorkers: 0, verificationPassed: 0 });
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState("info");
  const [activeJobId, setActiveJobId] = useState("");
  const [autoCommand, setAutoCommand] = useState("npm test");
  const [health, setHealth] = useState({ liveModel: false, model: "opencode-go/glm-5.3-flash" });
  const [webmcpStatus, setWebmcpStatus] = useState({ active: false, count: 0, message: "Browser preview" });
  const [cliCopied, setCliCopied] = useState(false);
  const [agentReceipt, setAgentReceipt] = useState({
    actor: "DEMO",
    action: "Example investigation loaded",
    detail: sampleInvestigation.id
  });
  const replayedJobs = useRef(new Set());
  const webmcpBridge = useRef(null);
  const teamDetailsRef = useRef(null);
  const cliDetailsRef = useRef(null);
  const autoCaptureCommand = `npm run bugreel -- --repo . --run "${autoCommand.replaceAll('"', '\\"')}" --server http://127.0.0.1:8787`;

  const selectedBug = useMemo(
    () => investigation.hypotheses.find((item) => item.id === selectedId) || investigation.hypotheses[0],
    [investigation, selectedId]
  );
  const activeJob = useMemo(() => jobs.find((job) => job.id === activeJobId), [jobs, activeJobId]);
  const activeInvestigationRunning = activeJob?.type === "investigation" && ["queued", "running"].includes(activeJob.status);
  const activeInvestigationPartial = activeJob?.type === "investigation" && activeJob.status === "partial";
  const activeInvestigationFailed = activeJob?.type === "investigation" && activeJob.status === "error";
  const activeDemoRunning = jobs.some((job) => job.demo && ["queued", "running"].includes(job.status));
  const waitingForFirstPreview = activeInvestigationRunning && !activeJob.preview;
  const frameStatusLabel = investigation.status === "diagnosis_grounded"
    ? "LEADING DIAGNOSIS CITED"
    : activeInvestigationPartial
      ? "RESOLUTION INCOMPLETE"
      : activeInvestigationFailed
        ? "HUNT FAILED"
        : activeInvestigationRunning
          ? "HUNT IN PROGRESS"
          : investigation.status === "diagnosis_unverified"
            ? "CAPTURE WITHHELD"
            : "PROVISIONAL RESULT";
  const frameStatusClass = investigation.status === "diagnosis_grounded"
    ? "diagnosis_grounded"
    : activeInvestigationPartial
      ? "resolution_incomplete"
      : activeInvestigationFailed
        ? "hunt_failed"
        : "provisional_result";
  const frameIsProvisional = activeInvestigationRunning || activeInvestigationPartial || investigation.status !== "diagnosis_grounded";
  const diagnosisReady = investigation.status === "diagnosis_grounded";
  const patchApplied = Boolean(activeJob?.verification?.patchApplied || investigation.candidatePatch?.applied);
  const regressionPassed = Boolean(activeJob?.verification?.regressionPassed || investigation.candidatePatch?.regressionPassed);
  useEffect(() => {
    let active = true;
    const checkHealth = () => fetch("/api/health")
      .then((response) => response.json())
      .then((value) => { if (active) setHealth(value); })
      .catch(() => {});
    checkHealth();
    const timer = window.setInterval(checkHealth, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => registerBugReelWebMcp({
    getBridge: () => webmcpBridge.current,
    onStatus: setWebmcpStatus
  }), []);

  useEffect(() => {
    let active = true;
    const refreshJobs = () => fetch("/api/investigations")
      .then((response) => response.json())
      .then((value) => {
        if (!active) return;
        setJobs(value.jobs || []);
        setManager(value.manager || { modelConcurrency: 1, activeModels: 0, queuedModels: 0, activeWorkers: 0, verificationPassed: 0 });
      })
      .catch(() => {});
    refreshJobs();
    const intervalMs = activeInvestigationRunning || activeDemoRunning || swarmStarting ? 350 : 5_000;
    const timer = window.setInterval(refreshJobs, intervalMs);
    return () => { active = false; window.clearInterval(timer); };
  }, [activeInvestigationRunning, activeDemoRunning, swarmStarting]);

  function recordAgentActivity(action, detail = "Visible workspace updated") {
    setAgentReceipt({ actor: "CHATGPT", action, detail });
  }

  useEffect(() => {
    if (!activeJob) return;
    const elapsed = Number.isFinite(activeJob.elapsedMs) ? ` · ${Math.ceil(activeJob.elapsedMs / 1000)}s` : "";
    setNotice(`${activeJob.message}${elapsed}`);
    if (activeJob.status === "error") setNoticeKind("error");
    else if (activeJob.status === "partial") setNoticeKind("warning");
    else if (activeJob.status === "complete") setNoticeKind("success");
    else setNoticeKind("loading");

    if (activeJob.investigation) {
      setInvestigation(activeJob.investigation);
      setSelectedId(activeJob.investigation.hypotheses[0].id);
      if (!replayedJobs.current.has(activeJob.id)) {
        replayedJobs.current.add(activeJob.id);
        setStage(0);
        setReplaying(true);
      }
    } else if (activeJob.preview) {
      setInvestigation(activeJob.preview);
      setSelectedId((current) => activeJob.preview.hypotheses.some((item) => item.id === current)
        ? current
        : activeJob.preview.hypotheses[0].id);
      setStage(phaseStage[activeJob.phase] ?? 1);
      setReplaying(false);
    }
  }, [activeJob]);

  useEffect(() => {
    if (!replaying) return undefined;
    if (stage >= investigation.timeline.length - 1) {
      setReplaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setStage((value) => value + 1), 850);
    return () => window.clearTimeout(timer);
  }, [replaying, stage, investigation.timeline.length]);

  async function createHunt(input = {}, source = "human") {
    const nextRepoUrl = input.repoUrl ?? repoUrl;
    const nextFailure = input.failure ?? failure;
    const nextExpected = input.expected ?? expected;
    setRepoUrl(nextRepoUrl);
    setFailure(nextFailure);
    setExpected(nextExpected);
    setSubmitting(true);
    setNoticeKind("loading");
    setNotice("Securing this failure and releasing a background hunter.");
    try {
      const response = await fetch("/api/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: nextRepoUrl, failure: nextFailure, expected: nextExpected })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The hunt stopped unexpectedly.");
      setHealth((value) => ({ ...value, liveModel: true }));
      setActiveJobId(payload.id);
      setJobs((current) => [payload, ...current.filter((job) => job.id !== payload.id)]);
      setNotice(payload.message);
      if (source === "agent") recordAgentActivity(`Started investigation ${payload.id}`, "Observed failure handed to BugReel");
      return payload;
    } catch (error) {
      setNoticeKind("error");
      setNotice(error.message);
      setAgentReceipt({ actor: "SYSTEM", action: "Hunt could not start", detail: error.message });
      throw error;
    } finally {
      setSubmitting(false);
    }
  }

  async function startHunt(event) {
    event.preventDefault();
    try {
      await createHunt();
    } catch {
      // createHunt already exposes the error in the visible status region.
    }
  }

  async function generateFailureProbe(input = {}) {
    const nextRepoUrl = input.repoUrl ?? repoUrl;
    const nextProbeKind = input.kind ?? probeKind;
    setRepoUrl(nextRepoUrl);
    setProbeKind(nextProbeKind);
    setProbeSubmitting(true);
    setNoticeKind("loading");
    setNotice(`Asking GLM for a source-cited ${nextProbeKind} probe. This is not observed evidence.`);
    try {
      const response = await fetch("/api/failure-samples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: nextRepoUrl, kind: nextProbeKind })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The failure sampler stopped unexpectedly.");
      setHealth((value) => ({ ...value, liveModel: true }));
      setActiveJobId(payload.id);
      setJobs((current) => [payload, ...current.filter((job) => job.id !== payload.id)]);
      setNotice(payload.message);
      return payload;
    } catch (error) {
      setNoticeKind("error");
      setNotice(error.message);
      throw error;
    } finally {
      setProbeSubmitting(false);
    }
  }

  async function startDemoSwarm() {
    if (teamDetailsRef.current) teamDetailsRef.current.open = true;
    setSwarmStarting(true);
    setNoticeKind("loading");
    setNotice("Releasing twenty isolated patch and regression workers.");
    try {
      const response = await fetch("/api/demo-swarm", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The 20-bug replay could not start.");
      setJobs(payload.jobs || []);
      setManager(payload.manager || manager);
      setActiveJobId(payload.jobs?.[0]?.id || "");
      setNoticeKind("success");
      setNotice("Twenty trusted regression fixtures entered the queue. Watch them move through Hunt, Patch, Verify, and Ready.");
      window.setTimeout(() => teamDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      return payload;
    } catch (error) {
      setNoticeKind("error");
      setNotice(error.message);
      throw error;
    } finally {
      setSwarmStarting(false);
    }
  }

  function useGeneratedProbe(job, source = "human") {
    if (!job.sample) return;
    setActiveJobId("");
    setFailure(job.sample.failureEvidence);
    setExpected(job.sample.expectedBehavior);
    setNoticeKind("warning");
    setNotice(job.sample.boundary);
    if (source === "agent") {
      recordAgentActivity(`Staged synthetic probe ${job.id}`, "Waiting for a human to run it and report an observed failure");
    }
    document.querySelector(".intake-bar")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function selectBoardJob(jobId) {
    const job = jobs.find((item) => item.id === jobId);
    setActiveJobId(jobId);
    if (job?.type === "investigation") {
      window.setTimeout(() => document.querySelector(".detail-heading")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } else if (job?.demo) {
      window.setTimeout(() => document.querySelector(".ops-verification")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
    }
  }

  function showInvestigation({ jobId, hypothesisId } = {}) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) throw new Error(`Investigation ${jobId || "(missing id)"} is not in the current BugReel queue.`);
    if (job.type !== "investigation") throw new Error(`${jobId} is not an investigation job.`);
    setActiveJobId(jobId);
    if (hypothesisId) {
      const hypotheses = job.investigation?.hypotheses || job.preview?.hypotheses || [];
      if (!hypotheses.some((item) => item.id === hypothesisId)) {
        throw new Error(`Hypothesis ${hypothesisId} is not part of ${jobId}.`);
      }
      setSelectedId(hypothesisId);
    }
    window.setTimeout(() => document.querySelector(".detail-heading")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    recordAgentActivity(
      hypothesisId ? `Focused ${hypothesisId} in ${jobId}` : `Opened investigation ${jobId}`,
      "The same evidence is now visible to the human"
    );
    return { jobId, hypothesisId: hypothesisId || null, visible: true, status: job.status };
  }

  function inspectJob({ jobId } = {}) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) throw new Error(`Job ${jobId || "(missing id)"} is not in the current BugReel queue.`);
    const result = {
      id: job.id,
      type: job.type,
      repo: job.repo,
      label: job.label,
      status: job.status,
      phase: job.phase,
      message: job.message,
      queuePosition: job.queuePosition || 0,
      boardStage: job.boardStage,
      verification: job.verification || null
    };
    if (job.sample) {
      result.probe = {
        title: job.sample.title,
        kind: job.sample.kind,
        status: job.sample.status,
        synthetic: true,
        failureEvidence: job.sample.failureEvidence,
        expectedBehavior: job.sample.expectedBehavior,
        citation: { file: job.sample.file, lines: job.sample.lines },
        whyPlausible: job.sample.whyPlausible,
        probeCommand: job.sample.probeCommand,
        boundary: job.sample.boundary
      };
    }
    const jobInvestigation = job.investigation || job.preview;
    if (jobInvestigation) {
      result.investigation = {
        id: jobInvestigation.id,
        status: jobInvestigation.status,
        hypotheses: jobInvestigation.hypotheses.map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          citation: { file: item.file, lines: item.lines },
          evidence: item.evidence,
          counterevidence: item.counterevidence,
          nextProbe: item.nextProbe,
          confidence: item.confidence,
          confidenceBoundary: "Directional model ranking only. Not a calibrated probability."
        })),
        rootCause: jobInvestigation.rootCause || null,
        boundary: jobInvestigation.boundary
      };
    }
    return result;
  }

  function stageFailureProbe({ jobId } = {}) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) throw new Error(`Probe ${jobId || "(missing id)"} is not in the current BugReel queue.`);
    if (job.type !== "failure_sample") throw new Error(`${jobId} is not a synthetic failure-probe job.`);
    if (job.status !== "complete" || !job.sample) throw new Error(`${jobId} is not ready to stage. Inspect it again after the probe completes.`);
    useGeneratedProbe(job, "agent");
    return {
      jobId,
      staged: true,
      synthetic: true,
      visible: true,
      nextAction: "A human must run the proposed probe and replace this text with an observed failure before starting a diagnosis.",
      boundary: job.sample.boundary
    };
  }

  function loadExample() {
    setRepoUrl(DEFAULT_REPO);
    setFailure(SAMPLE_FAILURE);
    setExpected(DEFAULT_EXPECTED);
    setInvestigation(sampleInvestigation);
    setSelectedId(sampleInvestigation.hypotheses[0].id);
    setStage(4);
    setReplaying(false);
    setActiveJobId("");
    setNoticeKind("success");
    setNotice("Example restored. Click Run 1-bug demo to watch the evidence chase from the beginning.");
    setAgentReceipt({ actor: "DEMO", action: "Example investigation restored", detail: sampleInvestigation.id });
  }

  function runGuidedDemo() {
    setRepoUrl(DEFAULT_REPO);
    setFailure(SAMPLE_FAILURE);
    setExpected(DEFAULT_EXPECTED);
    setInvestigation(sampleInvestigation);
    setSelectedId(sampleInvestigation.hypotheses[0].id);
    setStage(0);
    setReplaying(true);
    setActiveJobId("");
    setNoticeKind("success");
    setNotice("Demo running. The hunter will move through five evidence stages. Every suspect and stage remains clickable.");
    setAgentReceipt({ actor: "YOU", action: "Started the clickable 1-bug demo", detail: "Follow the hunter or take control" });
    window.setTimeout(() => document.querySelector(".detail-heading")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function advanceHunt() {
    setReplaying(false);
    setStage((current) => Math.min(current + 1, investigation.timeline.length - 1));
  }

  function openCliSetup() {
    if (cliDetailsRef.current) cliDetailsRef.current.open = true;
    window.setTimeout(() => cliDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function copyCli() {
    try {
      await navigator.clipboard.writeText(autoCaptureCommand);
      setCliCopied(true);
      setNoticeKind("success");
      setNotice("Automatic capture command copied. Run it from the repository checkout.");
      window.setTimeout(() => setCliCopied(false), 2_000);
    } catch {
      setCliCopied(false);
      setNoticeKind("error");
      setNotice("Clipboard access failed. Copy the command from the terminal preview instead.");
    }
  }

  webmcpBridge.current = {
    inspect: () => ({
      product: "BugReel",
      mode: health.liveModel ? "GLM route available" : "fixture mode",
      stagedFailure: { repoUrl, failure, expected: expected || null },
      activeJob: activeJob ? {
        id: activeJob.id,
        type: activeJob.type,
        status: activeJob.status,
        phase: activeJob.phase,
        message: activeJob.message
      } : null,
      investigation: {
        id: investigation.id,
        status: investigation.status,
        competingCauses: investigation.hypotheses.map((item) => ({
          id: item.id,
          title: item.title,
          state: item.status,
          confidence: item.confidence,
          confidenceBoundary: "Model ranking only. Not a calibrated probability.",
          selected: item.id === selectedId
        })),
        verification: {
          diagnosisGrounded: investigation.status === "diagnosis_grounded",
          patchApplied: Boolean(activeJob?.verification?.patchApplied),
          regressionPassed: Boolean(activeJob?.verification?.regressionPassed)
        }
      },
      queue: {
        jobs: jobs.length,
        activeModels: manager.activeModels,
        queuedModels: manager.queuedModels,
        activeWorkers: manager.activeWorkers,
        verificationPassed: manager.verificationPassed
      },
      claimBoundary: "Agent diagnosis is advisory. Only a trusted checkout can apply the patch and pass the regression gate."
    }),
    startHunt: (input) => createHunt(input, "agent"),
    generateProbe: generateFailureProbe,
    inspectJob,
    stageProbe: stageFailureProbe,
    showInvestigation,
    startTeamReplay: async () => {
      const payload = await startDemoSwarm();
      recordAgentActivity("Started the trusted team replay", `${payload.jobs?.length || 0} deterministic fixtures loaded`);
      return {
        started: payload.jobs?.length || 0,
        view: "team",
        jobIds: (payload.jobs || []).map((job) => job.id),
        modelConcurrency: payload.manager?.modelConcurrency || 1,
        boundary: "Deterministic trusted fixtures only. No model calls are consumed by this replay."
      };
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">Skip to investigation</a>
      <header className="topbar" id="top">
        <a className="brand" href="#top" aria-label="BugReel home">
          <span className="brand-glyph" aria-hidden="true">BR</span>
          <span>BUGREEL</span>
        </a>
        <p className="product-rule">ONE FAILURE · ONE CHASE · ONE GATE</p>
        <div className="route-states" aria-label="Runtime status">
          <span className="model-state"><span className={health.liveModel ? "signal live" : "signal"} />{health.liveModel ? "GLM ROUTE" : "FIXTURE"}</span>
          <span className={webmcpStatus.active ? "webmcp-state live" : "webmcp-state"}><span className={webmcpStatus.active ? "signal live" : "signal"} />{webmcpStatus.active ? `${webmcpStatus.count} TOOLS` : "WEBMCP READY"}</span>
        </div>
      </header>

      <main className="primary-stage" id="workspace">
        <section className="intake-column" aria-labelledby="product-heading">
          <p className="overline">VISUAL DEBUGGING FOR HUMANS + AGENTS</p>
          <h1 id="product-heading">Turn a failing test into an evidence chase.</h1>
          <p className="product-lede">See where the agent looked, compare three causes, and keep the bug open until a trusted regression passes.</p>

          <div className="demo-launcher" aria-label="Clickable BugReel demos">
            <p><b>NO SETUP NEEDED</b> Start here, then take control of the chase.</p>
            <button className="demo-button primary" type="button" onClick={runGuidedDemo}><span>▶</span> RUN 1-BUG DEMO</button>
            <button className="demo-button" type="button" onClick={() => startDemoSwarm().catch(() => {})} disabled={swarmStarting}>
              <span>20×</span> {swarmStarting ? "STARTING WORKERS..." : activeDemoRunning ? "WATCH WORKERS MOVE" : "RUN 20-BUG REPLAY"}
            </button>
          </div>

          <form className="intake-bar" onSubmit={startHunt}>
            <div className="form-heading"><span>OR USE A REAL FAILURE</span><small>Public source only</small></div>
            <label className="repo-field">
              <span>PUBLIC GITHUB REPOSITORY</span>
              <input aria-label="Public GitHub repository" type="url" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} required />
            </label>
            <label className="failure-field">
              <span>OBSERVED FAILURE</span>
              <textarea aria-label="Observed failure evidence" value={failure} onChange={(event) => setFailure(event.target.value)} rows="7" required />
              <small>Failing test, assertion, stack trace, or error log. A repository alone cannot prove a bug.</small>
            </label>
            <details className="expected-details">
              <summary>Add expected behavior</summary>
              <label className="expected-field">
                <span>EXPECTED BEHAVIOR</span>
                <input aria-label="Expected behavior, optional" placeholder="Optional" value={expected} onChange={(event) => setExpected(event.target.value)} />
              </label>
            </details>
            <div className="intake-actions">
              <button className="start-button" type="submit" disabled={submitting}>
                <span>{submitting ? "STARTING HUNT..." : "START EVIDENCE CHASE"}</span><b aria-hidden="true">→</b>
              </button>
              <button className="text-button" type="button" onClick={loadExample}>USE EXAMPLE</button>
            </div>
            <p className="input-boundary">Reads bounded public source. Never executes or modifies the repository.</p>
            {notice && <p className={`notice ${noticeKind}`} role={noticeKind === "error" ? "alert" : "status"} aria-live="polite">{activeJobId && <code>{activeJobId}</code>}{notice}</p>}
          </form>
        </section>

        <section className="chase-column detail-heading" aria-labelledby="chase-heading">
          <header className="agent-receipt" aria-live="polite">
            <span>{agentReceipt.actor}</span>
            <strong>{agentReceipt.action}</strong>
            <small>{agentReceipt.detail}</small>
          </header>

          {waitingForFirstPreview ? <SuspectIncubator jobId={activeJobId} message={notice} /> : (
            <div className={`investigation-frame ${frameIsProvisional ? "provisional" : ""}`}>
              <header className="frame-header">
                <div><span className="frame-id">{investigation.id}</span><strong id="chase-heading">{investigation.incident.title}</strong></div>
                <div className="frame-status"><span className={`status-badge ${frameStatusClass}`}>{frameStatusLabel}</span></div>
              </header>

              <div className="frame-grid">
                <aside className="suspect-rail" aria-label="Competing causes">
                  <div className="rail-label"><span>COMPETING CAUSES</span><b>{investigation.hypotheses.length}</b></div>
                  {investigation.hypotheses.slice(0, 3).map((bug) => (
                    <button className={`suspect ${selectedBug.id === bug.id ? "selected" : ""}`} key={bug.id} type="button" aria-pressed={selectedBug.id === bug.id} onClick={() => setSelectedId(bug.id)}>
                      <BugAvatar bug={bug} size="small" />
                      <span><strong>{bug.title}</strong><small>{bug.avatar.name} · {bug.kind}</small></span>
                      <i className={`bug-state ${bug.status}`}>{bug.status}</i>
                    </button>
                  ))}
                  <p className="model-score-boundary">Model ranking is directional, not a calibrated probability.</p>
                </aside>

                <MazeBoard investigation={investigation} stage={stage} activeBug={selectedBug} onSelectBug={setSelectedId} />

                <aside className="bug-inspector" aria-label="Selected cause evidence">
                  <div className="inspector-avatar"><BugAvatar bug={selectedBug} size="large" /><span>{selectedBug.id}</span></div>
                  <p className="inspector-label">LEADING DIAGNOSIS</p>
                  <h2>{selectedBug.title}</h2>
                  <p className="cause">{selectedBug.cause}</p>
                  <dl>
                    <div><dt>FILE + LINE CHECKED</dt><dd>{selectedBug.file}{selectedBug.lines ? `:${selectedBug.lines[0]}-${selectedBug.lines[1]}` : ""}</dd></div>
                    <div><dt>NEXT DISCRIMINATING TEST</dt><dd>{selectedBug.nextProbe}</dd></div>
                  </dl>
                </aside>
              </div>

              <footer className="hunt-timeline" aria-label="Investigation stages">
                {investigation.timeline.map((item, index) => (
                  <button type="button" className={`${index <= stage ? "reached" : ""} ${index === stage ? "current" : ""}`} aria-current={index === stage ? "step" : undefined} key={item.id} onClick={() => { setReplaying(false); setStage(index); }}>
                    <span>0{index + 1}</span><strong>{item.label.replace("captured", "cited")}</strong>
                  </button>
                ))}
              </footer>
              <div className="frame-actions">
                <div>
                  <span>YOUR NEXT CLICK</span>
                  <strong>{stage < investigation.timeline.length - 1 ? investigation.timeline[stage + 1].label : "See the same workflow at team scale"}</strong>
                </div>
                {stage < investigation.timeline.length - 1 ? (
                  <button type="button" onClick={advanceHunt}>NEXT STAGE <b>→</b></button>
                ) : (
                  <button type="button" onClick={() => startDemoSwarm().catch(() => {})} disabled={swarmStarting}>RUN 20-BUG REPLAY <b>↓</b></button>
                )}
              </div>
            </div>
          )}

          <section className="verification-rail" aria-label="Verification gate">
            <article className={diagnosisReady ? "passed" : "pending"}><span>{diagnosisReady ? "✓" : "○"}</span><div><strong>File and line checked</strong><small>{diagnosisReady ? "Citation exists in bounded source" : "Still investigating"}</small></div></article>
            <article className={patchApplied ? "passed" : "pending"}><span>{patchApplied ? "✓" : "○"}</span><div><strong>Patch applied</strong><small>{patchApplied ? "Trusted copy changed" : "Candidate only"}</small></div></article>
            <article className={regressionPassed ? "passed" : "pending"}><span>{regressionPassed ? "✓" : "○"}</span><div><strong>Regression passed</strong><small>{regressionPassed ? "Bug can close" : "Trusted test required"}</small></div></article>
          </section>
          <p className="claim-boundary"><b>CLAIM BOUNDARY</b>{investigation.boundary.replace("Root cause", "Leading diagnosis")}</p>
        </section>
      </main>

      <section className="secondary-section" aria-labelledby="secondary-heading">
        <header><p className="overline">AFTER THE FIRST BUG</p><h2 id="secondary-heading">Scale the same evidence object.</h2></header>
        <details ref={teamDetailsRef}>
          <summary><span>TEAM REPLAY</span><strong>Watch 20 trusted fixture regressions move through one queue.</strong><b>+</b></summary>
          <BugOpsBoard jobs={jobs} manager={manager} activeJobId={activeJobId} activeJob={activeJob} onSelect={selectBoardJob} onStartSwarm={startDemoSwarm} swarmStarting={swarmStarting} onUseProbe={useGeneratedProbe} />
        </details>
        <details id="cli" ref={cliDetailsRef}>
          <summary><span>TRUSTED LOCAL CAPTURE</span><strong>Run the failing test where the repository is allowed to execute.</strong><b>+</b></summary>
          <div className="cli-panel">
            <div className="cli-controls">
              <label><span>TEST COMMAND</span><input value={autoCommand} onChange={(event) => setAutoCommand(event.target.value)} /></label>
              <pre><code>{autoCaptureCommand}</code></pre>
              <button className="action primary" type="button" onClick={copyCli}>{cliCopied ? "COPIED ✓" : "COPY COMMAND"}</button>
              <p>The local runner can apply a patch and return the real regression result. The browser cannot.</p>
            </div>
            <CliPreview investigation={investigation} jobStatus={activeJob?.type === "investigation" ? activeJob.status : null} />
          </div>
        </details>
      </section>

      <footer className="footer">
        <div className="brand"><span className="brand-glyph" aria-hidden="true">BR</span><span>BUGREEL</span></div>
        <p>Failure in. Evidence trail out. Trusted test decides done.</p>
        <span>GLM-5.3 FLASH · OPENCODE GO</span>
      </footer>
      <nav className="quick-dock" aria-label="Demo shortcuts">
        <button type="button" onClick={runGuidedDemo}><span>1</span> ONE BUG</button>
        <button type="button" onClick={() => startDemoSwarm().catch(() => {})} disabled={swarmStarting}><span>20</span> TEAM REPLAY</button>
        <button type="button" onClick={openCliSetup}><span>&gt;_</span> CLI</button>
      </nav>
    </div>
  );
}

const OPS_COLUMNS = [
  ["intake", "INBOX", "Failures secured"],
  ["hunt", "HUNT", "Evidence and diagnosis"],
  ["patch", "PATCH", "Bounded change"],
  ["verify", "VERIFY", "Regression gate"],
  ["done", "READY", "Passed and reviewable"]
];

function BugOpsBoard({ jobs, manager, activeJobId, activeJob, onSelect, onStartSwarm, swarmStarting, onUseProbe }) {
  const columns = Object.fromEntries(OPS_COLUMNS.map(([id]) => [id, jobs.filter((job) => (job.boardStage || "intake") === id)]));
  const selectedDemo = activeJob?.demo ? activeJob : null;
  const demoJobs = jobs.filter((job) => job.demo);
  const replayComplete = demoJobs.length > 0 && demoJobs.every((job) => job.status === "complete");
  const replayProgress = demoJobs.length ? Math.round((demoJobs.filter((job) => job.status === "complete").length / demoJobs.length) * 100) : 0;
  return (
    <section className="ops-board" aria-labelledby="bug-ops-heading">
      <header className="ops-header">
        <div>
          <span id="bug-ops-heading">TEAM QUEUE</span>
          <strong>{jobs.length ? `${jobs.length} bugs under management` : "Ready for the 20-bug demo"}</strong>
          <small>Cards move live. Click any bug to inspect its patch and regression receipt.</small>
        </div>
        <div className="ops-metrics" aria-label={`${manager.activeWorkers || 0} active local workers and ${manager.activeModels} active GLM jobs`}>
          <span><b>{String(jobs.length).padStart(2, "0")}</b> BUGS</span>
          <span><b>{String(manager.activeWorkers || 0).padStart(2, "0")}</b> WORKERS</span>
          <span><b>{String(manager.verificationPassed || 0).padStart(2, "0")}</b> PASSED</span>
          <span><b>{manager.activeModels}/{manager.modelConcurrency}</b> GLM</span>
        </div>
        <button className="swarm-button" type="button" onClick={() => onStartSwarm().catch(() => {})} disabled={swarmStarting}>
          {swarmStarting ? "STARTING 20..." : replayComplete ? "REPLAY 20 BUGS" : demoJobs.length ? "RESTART REPLAY" : "RUN 20-BUG REPLAY"}
        </button>
      </header>
      <div className="ops-progress" aria-label={`${replayProgress}% of demo regressions passed`}><span style={{ width: `${replayProgress}%` }} /></div>
      {selectedDemo ? (
        <div className="ops-verification" aria-live="polite">
          <div><span>SELECTED WORKER {String(selectedDemo.worker).padStart(2, "0")}</span><strong>{selectedDemo.label}</strong><small>{selectedDemo.message}</small></div>
          <dl>
            <div><dt>STAGE</dt><dd>{(selectedDemo.boardStage || "intake").toUpperCase()}</dd></div>
            <div><dt>PATCH</dt><dd>{selectedDemo.verification?.patchApplied ? "APPLIED IN ISOLATED COPY" : "WAITING"}</dd></div>
            <div><dt>REGRESSION</dt><dd>{selectedDemo.verification?.regressionPassed ? `${selectedDemo.verification.testsPassed}/${selectedDemo.verification.testsTotal} PASSED` : selectedDemo.verification?.status?.toUpperCase()}</dd></div>
            <div><dt>DURATION</dt><dd>{selectedDemo.verification?.durationMs ? `${selectedDemo.verification.durationMs}ms` : "PENDING"}</dd></div>
          </dl>
        </div>
      ) : (
        <p className="ops-prompt">Start the replay, then click a moving card to inspect what its worker is doing.</p>
      )}
      <div className="ops-columns">
        {OPS_COLUMNS.map(([id, label, description]) => (
          <section className={`ops-column stage-${id}`} key={id} aria-label={`${label}: ${columns[id].length} bugs`}>
            <header><span>{label}</span><b>{String(columns[id].length).padStart(2, "0")}</b><small>{description}</small></header>
            <div className="ops-card-list">
              {columns[id].length === 0 && <p className="ops-empty">NO BUGS</p>}
              {columns[id].map((job) => {
                const avatar = job.avatar || job.investigation?.hypotheses?.[0]?.avatar || job.preview?.hypotheses?.[0]?.avatar || { name: "Unassigned Bug", hue: 44, eyes: 2, horns: 0, gait: "float", pattern: "plain" };
                return (
                  <article className={`ops-card ${activeJobId === job.id ? "selected" : ""} ${["queued", "running"].includes(job.status) ? "moving" : ""}`} key={job.id}>
                    <button type="button" onClick={() => onSelect(job.id)} aria-pressed={activeJobId === job.id}>
                      <BugAvatar bug={{ avatar }} size="small" />
                      <span className="ops-card-copy"><small>{job.id} · {job.repo}</small><strong>{job.label}</strong></span>
                      <span className={`ops-phase ${job.status}`}>{job.verification?.regressionPassed ? "1/1 PASS" : job.phase.replaceAll("_", " ")}</span>
                    </button>
                    {job.type === "failure_sample" && job.sample && <button className="use-probe" type="button" onClick={() => onUseProbe(job)}>LOAD PROBE</button>}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <p className="ops-boundary"><b>DEMO BOUNDARY</b> The 20-bug replay executes generated, trusted Python fixtures in isolated temporary folders. It proves concurrent orchestration and regression gating, not twenty simultaneous GLM calls or safe execution of arbitrary public repositories.</p>
    </section>
  );
}

function MazeBoard({ investigation, stage, activeBug, onSelectBug }) {
  const nodeIndex = stageNode[Math.min(stage, stageNode.length - 1)];
  const hunterNode = investigation.maze[Math.min(nodeIndex, investigation.maze.length - 1)] || { x: 8, y: 14 };
  const route = investigation.maze.map((node) => `${node.x},${node.y}`).join(" ");
  return (
    <section className="maze" aria-label={`Code maze. Current stage: ${investigation.timeline[stage]?.label}`}>
      <svg className="maze-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={route} />
      </svg>
      {investigation.maze.map((node, index) => (
        <div className={`maze-node ${index <= nodeIndex ? "visited" : ""}`} key={`${node.path}-${index}`} style={{ left: `${node.x}%`, top: `${node.y}%` }}>
          <i /><span>{node.path.split("/").pop()}</span>
        </div>
      ))}
      <div className="hunter-position" style={{ left: `${hunterNode.x}%`, top: `${hunterNode.y}%` }}><HunterAvatar compact /></div>
      {investigation.hypotheses.map((bug, index) => {
        const home = investigation.maze[Math.min(2 + index * 2, investigation.maze.length - 1)] || hunterNode;
        const captured = bug.status === "captured" && stage >= 4;
        return (
          <button
            className={`maze-bug ${activeBug.id === bug.id ? "active" : ""} ${captured ? "is-captured" : ""}`}
            type="button"
            aria-label={`${bug.avatar.name}, ${bug.status}`}
            key={bug.id}
            onClick={() => onSelectBug(bug.id)}
            style={{ left: `${home.x}%`, top: `${home.y}%` }}
          ><BugAvatar bug={bug} size="maze" /></button>
        );
      })}
      <div className="maze-caption"><span>STAGE 0{stage + 1}</span><strong>{investigation.timeline[stage]?.label}</strong><p>{investigation.timeline[stage]?.detail}</p></div>
    </section>
  );
}

function SuspectIncubator({ jobId, message }) {
  return (
    <section className="investigation-frame suspect-incubator" aria-label="Waiting for evidence-backed bug hypotheses" aria-live="polite">
      <header className="frame-header">
        <div><span className="frame-id">{jobId || "NEW JOB"}</span><strong>Securing the failure trail</strong></div>
        <div className="frame-status"><span className="status-badge">NO SUSPECTS YET</span></div>
      </header>
      <div className="incubator-stage">
        <HunterAvatar compact={false} />
        <div className="empty-suspects" aria-hidden="true"><i /><i /><i /></div>
        <p>{message}</p>
        <small>Bug figures appear only after GLM returns source-cited hypotheses.</small>
      </div>
    </section>
  );
}

function HunterAvatar({ compact }) {
  return (
    <svg className={`hunter-avatar ${compact ? "compact" : ""}`} viewBox="0 0 72 72" role="img" aria-label="BugReel hunter agent">
      <path className="scanner-ring" d="M36 5a31 31 0 1 0 24 11" />
      <path className="hunter-body" d="M11 36 30 12l28 7 3 29-25 14L12 51Z" />
      <circle className="hunter-eye" cx="37" cy="29" r="6" />
      <circle className="hunter-pupil" cx="39" cy="29" r="2" />
      <path className="hunter-beam" d="m54 34 15-6v12Z" />
    </svg>
  );
}

function BugAvatar({ bug, size }) {
  const { avatar } = bug;
  const eyes = Array.from({ length: avatar.eyes }, (_, index) => 23 + index * (18 / Math.max(1, avatar.eyes - 1)));
  return (
    <svg
      className={`bug-avatar ${size} gait-${avatar.gait} pattern-${avatar.pattern}`}
      style={{ "--bug-hue": avatar.hue }}
      viewBox="0 0 64 64"
      role="img"
      aria-label={`${avatar.name} bug avatar`}
    >
      {avatar.horns >= 1 && <path className="horn" d="M18 17 12 4l15 11" />}
      {avatar.horns >= 2 && <path className="horn" d="m43 15 10-11-5 16" />}
      <path className="bug-body" d="M11 30C11 15 20 8 32 8s21 7 21 22v24l-8-6-7 7-7-7-7 7-6-7-7 6Z" />
      {avatar.pattern === "stripes" && <path className="pattern-line" d="M17 35h30M19 44h26" />}
      {avatar.pattern === "spots" && <><circle className="pattern-spot" cx="20" cy="39" r="3" /><circle className="pattern-spot" cx="44" cy="43" r="4" /></>}
      {eyes.map((x, index) => <g className="bug-eye" key={x}><circle cx={x} cy="28" r="6" /><circle className="bug-pupil" cx={x + (index % 2 ? -1 : 1)} cy="29" r="2" /></g>)}
      <path className="bug-mouth" d="M26 40q6 5 12 0" />
    </svg>
  );
}

function CliPreview({ investigation, jobStatus }) {
  const primary = investigation.hypotheses[0];
  const terminalStatus = investigation.status === "diagnosis_grounded"
    ? "CITED"
    : jobStatus === "partial"
      ? "RESOLUTION INCOMPLETE"
      : jobStatus === "error"
        ? "HUNT FAILED"
        : investigation.status === "diagnosis_unverified"
          ? "CAPTURE WITHHELD"
          : "STILL HUNTING";
  return (
    <div className="terminal" aria-label="BugReel CLI preview">
      <div className="terminal-bar"><span /><span /><span /><b>bugreel / investigation</b></div>
      <pre><span className="cyan">BUGREEL // INVESTIGATION CONSOLE</span>{`\n`}
{investigation.id}  <span className="green">{terminalStatus}</span>{`\n`}
{investigation.incident.title}{`\n\n`}
HUNT  ● failure  · trail  · suspects  · challenge  ◎ citation{`\n\n`}
◎ <span className="magenta">{primary.avatar.name.padEnd(19)}</span>  {primary.status.toUpperCase()}{`\n`}
  {primary.file}:{primary.lines?.join("-")}{`\n`}
  {primary.cause}{`\n\n`}
<span className="dim">NEXT SAFE ACTION</span>{`\n`}
{investigation.candidatePatch.verification[0]}{`\n\n`}
<span className="dim">{investigation.boundary}</span></pre>
    </div>
  );
}
