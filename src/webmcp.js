const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false
};

function toolResult(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function requireBridge(getBridge) {
  const bridge = getBridge?.();
  if (!bridge) throw new Error("BugReel is still loading. Try the tool again in a moment.");
  return bridge;
}

export function createBugReelToolDefinitions(getBridge) {
  return [
    {
      name: "inspect_bugreel_workspace",
      title: "Inspect BugReel workspace",
      description: "Read the failure currently staged in BugReel, the active investigation, competing causes, queue state, and verification boundary. This does not start work or modify a repository.",
      inputSchema: EMPTY_OBJECT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => toolResult(requireBridge(getBridge).inspect())
    },
    {
      name: "start_failure_hunt",
      title: "Start a BugReel failure hunt",
      description: "Send an observed failure or stack trace into BugReel. BugReel reads bounded public source and starts a GLM investigation, but it never modifies the repository or marks a regression as passed.",
      inputSchema: {
        type: "object",
        properties: {
          repoUrl: { type: "string", description: "Public GitHub repository URL associated with the failure." },
          failure: { type: "string", description: "Observed failing test, assertion, stack trace, or error log." },
          expected: { type: "string", description: "Optional expected behavior." }
        },
        required: ["repoUrl", "failure"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input = {}) => toolResult(await requireBridge(getBridge).startHunt(input))
    },
    {
      name: "generate_failure_probe",
      title: "Generate a failure probe",
      description: "Ask BugReel for a source-cited test idea for a public repository. The result is explicitly synthetic until a human runs it and observes a failure.",
      inputSchema: {
        type: "object",
        properties: {
          repoUrl: { type: "string", description: "Public GitHub repository URL to inspect." },
          kind: {
            type: "string",
            enum: ["boundary", "state", "control", "concurrency", "data"],
            description: "Shape of bug to probe for."
          }
        },
        required: ["repoUrl", "kind"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input = {}) => toolResult(await requireBridge(getBridge).generateProbe(input))
    },
    {
      name: "show_investigation",
      title: "Show a BugReel investigation",
      description: "Open a queued BugReel investigation in the visible page and optionally focus one competing cause. This changes only the browser view.",
      inputSchema: {
        type: "object",
        properties: {
          jobId: { type: "string", description: "BugReel job identifier." },
          hypothesisId: { type: "string", description: "Optional competing-cause identifier to focus." }
        },
        required: ["jobId"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input = {}) => toolResult(requireBridge(getBridge).showInvestigation(input))
    },
    {
      name: "start_team_replay",
      title: "Start the BugReel team replay",
      description: "Load twenty deterministic patch and regression fixtures into Team View so the user can inspect queue behavior without consuming model calls.",
      inputSchema: EMPTY_OBJECT_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async () => toolResult(await requireBridge(getBridge).startTeamReplay())
    }
  ];
}

export function registerBugReelWebMcp({ getBridge, onStatus = () => {} }) {
  const modelContext = globalThis.document?.modelContext;
  if (!modelContext?.registerTool) {
    onStatus({ active: false, count: 0, message: "Browser preview" });
    return () => {};
  }

  const controller = new AbortController();
  const tools = createBugReelToolDefinitions(getBridge);
  let registered = 0;

  for (const tool of tools) {
    try {
      const registration = modelContext.registerTool(tool, { signal: controller.signal });
      if (registration?.catch) {
        registration.catch((error) => {
          if (error?.name !== "AbortError") {
            onStatus({ active: false, count: registered, message: error.message });
          }
        });
      }
      registered += 1;
    } catch (error) {
      onStatus({ active: false, count: registered, message: error.message });
      controller.abort();
      return () => {};
    }
  }

  onStatus({ active: true, count: registered, message: `${registered} agent tools active` });
  return () => controller.abort();
}
