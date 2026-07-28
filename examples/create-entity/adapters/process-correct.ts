import correctAdapter from "./correct.adapter.ts";

type Envelope = {
  protocol: string;
  operation: string;
  request: {
    input: Record<string, unknown>;
    state: Record<string, unknown>;
  };
};

try {
  const source = await readStandardInput();
  const envelope = JSON.parse(source) as Envelope;
  if (envelope.protocol !== "crdd-ir/adapter-v0.1") throw new Error("unsupported protocol");
  if (envelope.operation !== "CreateEntity") throw new Error("unsupported operation");
  const result = await correctAdapter.execute(envelope.request);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
