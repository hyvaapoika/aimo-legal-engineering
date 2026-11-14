import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  elevenLabsClient,
  quotationAgentConfiguration,
} from "../apps/gateway/src/voice/elevenlabs.js";

const stateDirectory = new URL("../.local/", import.meta.url);
const stateFile = new URL("elevenlabs-agent.json", stateDirectory);
const agentState = z.object({ agentId: z.string().min(1) });

async function main() {
  const command = process.argv[2];
  if (command !== "setup" && command !== "check" && command !== "update") {
    throw new Error(
      "Usage: pnpm voice:setup, pnpm voice:check or pnpm voice:update",
    );
  }
  const client = elevenLabsClient();
  let saved: z.infer<typeof agentState> | undefined;
  try {
    saved = agentState.parse(JSON.parse(await readFile(stateFile, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (!saved) {
    if (command === "check") {
      throw new Error("No project agent is configured. Run pnpm voice:setup.");
    }
    // Create once and persist its ID. Never retry an ambiguous create failure.
    const created = await client.conversationalAi.agents.create(
      quotationAgentConfiguration,
    );
    saved = { agentId: created.agentId };
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(stateFile, JSON.stringify(saved, null, 2) + "\n", {
      mode: 0o600,
    });
  }

  if (command === "update")
    await client.conversationalAi.agents.update(
      saved.agentId,
      quotationAgentConfiguration,
    );

  const agent = await client.conversationalAi.agents.get(saved.agentId);
  console.log(
    JSON.stringify(
      {
        connected: true,
        agentId: saved.agentId,
        name: agent.name,
        language: agent.conversationConfig.agent?.language,
        authenticationRequired: agent.platformSettings?.auth?.enableAuth,
        dashboard: `https://elevenlabs.io/app/agents/agents/${saved.agentId}`,
        stateFile: fileURLToPath(stateFile),
        approvalIntegration: "browser_demo_two_step_confirmation",
        telephoneIntegration: "not_connected",
        callPlaced: false,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  // SDK errors can include request metadata. Report a safe summary only.
  const status =
    typeof error === "object" && error !== null && "statusCode" in error
      ? error.statusCode
      : undefined;
  const message =
    status !== undefined
      ? `ElevenLabs returned HTTP ${status}. Check account access and agent configuration.`
      : error instanceof Error
        ? error.message.replaceAll(
            process.env.ELEVENLABS_API_KEY || "\0",
            "[redacted]",
          )
        : "ElevenLabs setup failed.";
  console.error(message);
  if (typeof error === "object" && error !== null && "body" in error) {
    const detail = z
      .object({
        detail: z.union([
          z.string(),
          z.object({
            message: z.string().optional(),
            status: z.string().optional(),
          }),
        ]),
      })
      .safeParse(error.body);
    if (detail.success) {
      console.error(
        JSON.stringify(detail.data.detail).replaceAll(
          process.env.ELEVENLABS_API_KEY || "\0",
          "[redacted]",
        ),
      );
    }
  }
  process.exitCode = 1;
});
