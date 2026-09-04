export function text(data: unknown) {
  const outputData = data ?? null;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(outputData, null, 2) }],
    structuredContent: { data: outputData },
  };
}
