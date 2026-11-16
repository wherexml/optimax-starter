export async function bootstrapMagpieRelay(page) {
  const secret = await page.evaluate(async () => {
    const result = await api('caller-keys');
    const selected = result.keys.find(key => key.name === 'Magpie' && !key.off);
    if (!selected) throw new Error('Existing Magpie key unavailable');
    return (await api('caller-keys/copy-key', { key: selected.id })).secret;
  });
  const response = await fetch('http://127.0.0.1:38142/bootstrap', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: secret }),
  });
  if (!response.ok) throw new Error(`Magpie bootstrap failed (${response.status})`);
  return { ready: true, credentialStorage: 'process-memory-only' };
}
