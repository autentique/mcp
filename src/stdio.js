export function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export async function readMessages(onMessage) {
  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += chunk.toString('utf8');
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) await onMessage(JSON.parse(line));
    }
  }
  if (buffer.trim()) await onMessage(JSON.parse(buffer));
}
