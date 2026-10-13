/** Output resolver of the Note node: the ONLY way another node gets this node's data (design 06 section 4.4). */
export async function resolveText({ node, adapter }) {
  const full = await adapter.getNode(node.id)
  return { items: [{ id: node.id, text: full?.config?.text ?? '' }] }
}
